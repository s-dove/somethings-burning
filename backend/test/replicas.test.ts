import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { readConfig } from "../src/env.js";
import { recordEvent } from "../src/issues.js";
import { LiveAlerts } from "../src/live.js";
import { claim } from "../src/notify/store.js";
import { createProject } from "../src/projects.js";
import { FakeSenders, pythonError, testAuth, testPgUrl } from "./helpers.js";

// Several servers on one Postgres. Run with BURNING_TEST_PG set.
describe.skipIf(!process.env.BURNING_TEST_PG)("several servers on Postgres", () => {
  it("makes one issue when two servers see a new error at once", async () => {
    const url = await testPgUrl();
    const [a, b] = [await openDb(url), await openDb(url)];
    const p = await createProject(a, "web");
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => recordEvent(i % 2 ? a : b, p.id, pythonError)));
    expect(new Set(results.map((r) => r.issueId)).size).toBe(1);
    expect(results.filter((r) => r.alert === "new")).toHaveLength(1);
    expect(await a.get("SELECT COUNT(*) AS n, MAX(count) AS c FROM issues")).toEqual({ n: 1, c: 10 });
    await Promise.all([a.close(), b.close()]);
  });

  it("sends each notification from one server only", async () => {
    const url = await testPgUrl();
    const [a, b] = [await openDb(url), await openDb(url)];
    const p = await createProject(a, "web");
    for (let i = 0; i < 30; i++) {
      await a.run(
        "INSERT INTO notifications (project_id, issue_id, kind, target, subject, text, json, next_at, created_at) VALUES (?, 1, 'email', ?, 's', 't', '{}', 0, 0)",
        p.id,
        `p${i}@example.com`,
      );
    }
    const [x, y] = await Promise.all([claim(a, Date.now(), 20), claim(b, Date.now(), 20)]);
    const ids = [...x, ...y].map((r) => r.id);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    // Claimed rows wait out their lease before another server may take them.
    expect(await claim(a, Date.now(), 20)).toEqual([]);
    expect(await claim(b, Date.now() + 3 * 60_000, 50)).toHaveLength(30);
    await Promise.all([a.close(), b.close()]);
  });

  it("tells the browsers on every server about an alert", async () => {
    const url = await testPgUrl();
    const [a, b] = [new LiveAlerts(), new LiveAlerts()];
    await a.listenPostgres(url);
    await b.listenPostgres(url);
    const heard: number[] = [];
    b.subscribe((id) => heard.push(id));
    a.publish(7);
    for (let i = 0; i < 100 && !heard.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(heard).toEqual([7]);
    await Promise.all([a.close(), b.close()]);
  });

  it("serves the API from either server", async () => {
    const url = await testPgUrl();
    const config = readConfig({});
    const [a, b] = [await openDb(url), await openDb(url)];
    const one = createApp(a, { auth: testAuth(), config, senders: new FakeSenders() });
    const two = createApp(b, { auth: testAuth(), config, senders: new FakeSenders() });
    const res = await one.app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "web" }) });
    expect(res.status).toBe(201);
    const seen = (await (await two.app.request("/api/projects")).json()) as { projects: { name: string }[] };
    expect(seen.projects.map((p) => p.name)).toEqual(["web"]);
    expect((await two.app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "WEB" }) })).status).toBe(409);
    await Promise.all([a.close(), b.close()]);
  });
});
