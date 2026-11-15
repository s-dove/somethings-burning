import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { board } from "../src/board.js";
import { openDb } from "../src/db.js";
import { readConfig } from "../src/env.js";
import { decode, MAX_BODY } from "../src/ingest.js";
import { getIssue, hoursByIssue, prune, recordEvent, releasesOf, resolve, STORE, storedEventCount } from "../src/issues.js";
import { createProject } from "../src/projects.js";
import { IngestQueue, TokenBucket } from "../src/queue.js";
import { pythonError, setup, testAuth } from "./helpers.js";

const HOUR = 3_600_000;
const saved = { ...STORE };
afterEach(() => Object.assign(STORE, saved));

describe("ingest limits", () => {
  it("tells SDKs to wait when over the rate", async () => {
    const db = await openDb(":memory:");
    const { app } = createApp(db, { auth: testAuth(), config: readConfig({ BURNING_RATE: "0", BURNING_BURST: "2" }) });
    const p = await createProject(db, "web");
    const post = () => app.request(`/api/${p.id}/store/?sentry_key=${p.publicKey}`, { method: "POST", body: JSON.stringify({ message: "hi" }) });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("10");
    expect(limited.headers.get("x-sentry-rate-limits")).toBe("10::organization");
  });

  it("refills the bucket over time", async () => {
    const b = new TokenBucket(1, 1);
    const t = Date.now();
    expect(b.allow(t)).toBe(true);
    expect(b.allow(t)).toBe(false);
    expect(b.allow(t + 1000)).toBe(true);
  });

  it("refuses when the write queue is full", async () => {
    const db = await openDb(":memory:");
    const p = await createProject(db, "web");
    const q = new IngestQueue(db, null, 1);
    const job = { project: p, event: { message: "x" }, received: Date.now(), baseURL: "" };
    expect(q.push(job)).toBe(true);
    expect(q.push(job)).toBe(false);
  });

  it("answers with the event id before the event is written, then writes it", async () => {
    const { app, project, queue, db } = await setup();
    const res = await app.request(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, { method: "POST", body: JSON.stringify({ message: "later" }) });
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    await queue.idle();
    expect((await db.get<{ event_id: string }>("SELECT event_id FROM events"))!.event_id).toBe(id);
  });

  it("rejects a body over the limit, and decodes zstd and raw deflate", async () => {
    const { app, project } = await setup();
    const big = await app.request(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, { method: "POST", body: Buffer.alloc(MAX_BODY + 1) });
    expect(big.status).toBe(413);
    const raw = Buffer.from('{"message":"hi"}');
    expect(decode(zstdCompressSync(raw), "zstd").toString()).toBe(raw.toString());
    expect(decode(deflateRawSync(raw), "deflate").toString()).toBe(raw.toString());
  });
});

describe("payload sampling and counts", () => {
  it("keeps the first payloads, then one a minute, and always an alerting one", async () => {
    Object.assign(STORE, { firstN: 3, everyMs: 60_000, max: 100 });
    const { db, project } = await setup();
    const t = Date.now();
    let issueId = 0;
    for (let i = 0; i < 10; i++) issueId = (await recordEvent(db, project.id, pythonError, t + i * 1000)).issueId;
    expect(await storedEventCount(db, issueId)).toBe(3);
    await recordEvent(db, project.id, pythonError, t + 63_000); // a minute after the last kept one (t + 2s)
    expect(await storedEventCount(db, issueId)).toBe(4);
    // Firing again alerts, so its payload is kept despite the minute.
    await resolve(db, project.id, issueId);
    await recordEvent(db, project.id, pythonError, t + 64_000);
    expect(await storedEventCount(db, issueId)).toBe(5);
    // Every event still counts.
    expect((await getIssue(db, project.id, issueId))!.eventCount).toBe(12);
    expect((await hoursByIssue(db, [issueId], t + 64_000)).get(issueId)!.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("drops the oldest payloads past the cap", async () => {
    Object.assign(STORE, { firstN: 100, everyMs: 0, max: 3 });
    const { db, project } = await setup();
    const t = Date.now();
    let issueId = 0;
    for (let i = 0; i < 5; i++) issueId = (await recordEvent(db, project.id, { ...pythonError, event_id: `e${i}` }, t + i)).issueId;
    const kept = (await db.all<{ event_id: string }>("SELECT event_id FROM events WHERE issue_id = ? ORDER BY id", issueId)).map((r) => r.event_id);
    expect(kept).toEqual(["e2", "e3", "e4"]);
  });

  it("counts every event per release and environment, and on the board", async () => {
    Object.assign(STORE, { firstN: 1, everyMs: 3_600_000, max: 10 });
    const { db, project } = await setup();
    const t = Date.now();
    for (let i = 0; i < 4; i++) await recordEvent(db, project.id, { ...pythonError, release: "web@1", environment: "prod" }, t + i);
    await recordEvent(db, project.id, { ...pythonError, release: "web@2", environment: "prod" }, t + 10);
    const { issueId } = await recordEvent(db, project.id, { ...pythonError, release: "web@2", environment: "prod" }, t + 11);
    expect((await releasesOf(db, issueId)).map((r) => [r.release, r.eventCount])).toEqual([
      ["web@2", 2],
      ["web@1", 4],
    ]);
    expect((await board(db, { sort: "hot", q: "" }, t + 20)).events).toEqual({ day: 6, hour: 6 });
  });

  it("prunes old payloads and hourly counts, keeping issues and totals", async () => {
    const { db, project } = await setup();
    const now = Date.now();
    const old = await recordEvent(db, project.id, pythonError, now - 40 * 24 * HOUR);
    await recordEvent(db, project.id, pythonError, now);
    expect(await prune(db, 30 * 24 * HOUR, now)).toBe(1);
    expect(await storedEventCount(db, old.issueId)).toBe(1);
    expect((await getIssue(db, project.id, old.issueId))!.eventCount).toBe(2);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM issue_hours"))!.n).toBe(1);
  });

  it("fills the counts of a database from before them", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "burning-")), "old.db");
    const db = await openDb(path);
    const p = await createProject(db, "web");
    await recordEvent(db, p.id, { ...pythonError, release: "web@1" });
    await recordEvent(db, p.id, { ...pythonError, release: "web@1" });
    for (const sql of ["DELETE FROM issue_hours", "DELETE FROM issue_releases", "UPDATE issues SET stored_count = 0, last_stored = 0"]) await db.run(sql);
    await db.close();
    const again = await openDb(path);
    expect(await again.get("SELECT SUM(event_count) AS n FROM issue_hours")).toEqual({ n: 2 });
    expect(await again.get("SELECT release, event_count FROM issue_releases")).toEqual({ release: "web@1", event_count: 2 });
    expect(await again.get("SELECT stored_count FROM issues")).toEqual({ stored_count: 2 });
  });
});
