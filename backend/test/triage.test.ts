import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { listActivity } from "../src/activity.js";
import { openDb } from "../src/db.js";
import { expireMutes, getIssue, mute, recordEvent, reopenByHand, resolve } from "../src/issues.js";
import { MUTE_OPTIONS } from "../src/triage.js";
import { as, json, pythonError, setup } from "./helpers.js";

const opt = (v: string) => MUTE_OPTIONS.find((o) => o.value === v)!;
const HOUR = 3_600_000;

describe("triage", () => {
  it("fires a resolved issue again on its next event", () => {
    const { db, project } = setup();
    const first = recordEvent(db, project.id, pythonError);
    expect(first.alert).toBe("new");
    expect(recordEvent(db, project.id, pythonError).alert).toBeNull();

    resolve(db, project.id, first.issueId, "ana@example.com");
    expect(getIssue(db, project.id, first.issueId)!.status).toBe("resolved");

    const again = recordEvent(db, project.id, { ...pythonError, release: "web@2.0.0", environment: "production" });
    expect(again).toMatchObject({ alert: "fired_again", reason: "A new event arrived in release web@2.0.0 (production) after it was resolved" });
    const issue = getIssue(db, project.id, first.issueId)!;
    expect(issue).toMatchObject({ status: "open", reopenReason: again.reason, eventCount: 3 });
    expect(listActivity(db, first.issueId).map((a) => [a.kind, a.actor])).toEqual([
      ["fired", ""],
      ["resolved", "ana@example.com"],
      ["created", ""],
    ]);
  });

  it("keeps a muted issue quiet until the mute ends, then alerts once", () => {
    const { db, project } = setup();
    const { issueId } = recordEvent(db, project.id, pythonError);
    mute(db, project.id, issueId, opt("1h"));
    expect(getIssue(db, project.id, issueId)).toMatchObject({ status: "muted", mute: { kind: "for" } });
    expect(recordEvent(db, project.id, pythonError).alert).toBeNull();

    expect(expireMutes(db, Date.now() + 2 * HOUR)).toBe(1);
    expect(getIssue(db, project.id, issueId)!.status).toBe("open");
    expect(recordEvent(db, project.id, pythonError)).toMatchObject({ alert: "unmuted", reason: "The first event since the mute ended" });
    expect(recordEvent(db, project.id, pythonError).alert).toBeNull();
  });

  it("ends a next-release mute on an event from a release newer than the mute", () => {
    const { db, project } = setup();
    const t0 = Date.now();
    const { issueId } = recordEvent(db, project.id, { ...pythonError, release: "web@1.0.0" }, t0);
    mute(db, project.id, issueId, opt("release"));
    // A release already running when it was muted does not end it.
    expect(recordEvent(db, project.id, { ...pythonError, release: "web@1.0.0" }, t0 + 1000).alert).toBeNull();
    const res = recordEvent(db, project.id, { ...pythonError, release: "web@1.1.0" }, Date.now() + 1000);
    expect(res).toMatchObject({ alert: "unmuted", reason: "An event arrived from release web@1.1.0, which is newer than the mute" });
    expect(getIssue(db, project.id, issueId)!.status).toBe("open");
  });

  it("alerts on the next event after an unmute by hand", () => {
    const { db, project } = setup();
    const { issueId } = recordEvent(db, project.id, pythonError);
    mute(db, project.id, issueId, opt("forever"));
    reopenByHand(db, project.id, issueId);
    expect(recordEvent(db, project.id, pythonError).alert).toBe("unmuted");
  });

  it("notifies when an issue fires again, and records who was told", async () => {
    const s = setup();
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    const post = () =>
      s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, { method: "POST", headers: { host: "burning.example.com" }, body: JSON.stringify(pythonError) });
    await post();
    resolve(s.db, s.project.id, 1);
    await post();
    await s.outbox.drain();
    expect(s.senders.sent.map((x) => x.m.subject)).toEqual([
      "New issue: ZeroDivisionError: division by zero",
      "Issue fired again: ZeroDivisionError: division by zero",
    ]);
    expect(s.senders.sent[1]!.m.text).toContain("A new event arrived after it was resolved.");
    expect(listActivity(s.db, 1).filter((a) => a.kind === "notified").map((a) => a.text)).toEqual([
      "Notified ana@example.com by the default route",
      "Notified ana@example.com by the default route",
    ]);
  });

  it("lets members triage over the API, not viewers", async () => {
    const s = setup({ auth: true });
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    setGrant(s.db, s.project.id, "user", "bo@example.com", "member");
    setGrant(s.db, s.project.id, "user", "cy@example.com", "viewer");
    const { issueId } = recordEvent(s.db, s.project.id, pythonError);
    const call = (who: string, what: string, body: object = {}) =>
      s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/${what}`, { method: "POST", ...json(body, as(who)) });

    expect((await call("cy@example.com", "resolve")).status).toBe(403);
    expect((await call("bo@example.com", "mute", { for: "1d" })).status).toBe(200);
    expect((await call("bo@example.com", "mute", { for: "1y" })).status).toBe(400);
    expect((await call("bo@example.com", "reopen")).status).toBe(200);
    expect((await call("bo@example.com", "resolve")).status).toBe(200);
    expect((await s.app.request(`/api/projects/${s.project.id}/issues/999/resolve`, { method: "POST", headers: as("bo@example.com") })).status).toBe(404);

    const detail = (await (await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`, { headers: as("cy@example.com") })).json()) as {
      issue: { status: string };
      activity: { kind: string; actorName: string }[];
      muteOptions: { value: string }[];
    };
    expect(detail.issue.status).toBe("resolved");
    expect(detail.activity.map((a) => a.kind)).toEqual(["resolved", "reopened", "muted", "created"]);
    expect(detail.activity[0]!.actorName).toBe("bo@example.com");
    expect(detail.muteOptions.map((o) => o.value)).toEqual(["1h", "1d", "1w", "release", "forever"]);
  });

  it("filters the board by status and counts each", async () => {
    const s = setup();
    const a = recordEvent(s.db, s.project.id, pythonError);
    const b = recordEvent(s.db, s.project.id, { message: "slow" });
    recordEvent(s.db, s.project.id, { message: "other" });
    resolve(s.db, s.project.id, a.issueId);
    mute(s.db, s.project.id, b.issueId, opt("forever"));
    const get = async (status: string) =>
      (await (await s.app.request(`/api/board?status=${status}`)).json()) as { issues: { title: string; status: string }[]; counts: Record<string, number>; openTotal: number };
    const open = await get("open");
    expect(open.issues.map((i) => i.title)).toEqual(["other"]);
    expect(open.counts).toEqual({ open: 1, resolved: 1, muted: 1, all: 3 });
    expect(open.openTotal).toBe(1);
    expect((await get("resolved")).issues.map((i) => i.status)).toEqual(["resolved"]);
    expect((await get("all")).issues).toHaveLength(3);
  });

  it("adds the triage columns to a database made before them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "burning-")), "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE issues (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, fingerprint TEXT NOT NULL,
      title TEXT NOT NULL, culprit TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT 'error', platform TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, UNIQUE (project_id, fingerprint));
      INSERT INTO issues (project_id, fingerprint, title, first_seen, last_seen) VALUES (1, 'x', 'old', 0, 0);`);
    old.close();
    const db = openDb(path);
    expect(db.prepare("SELECT status, notify_next FROM issues").get()).toEqual({ status: "open", notify_next: 0 });
  });
});
