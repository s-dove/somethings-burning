import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { listActivity } from "../src/activity.js";
import { board } from "../src/board.js";
import { getIssue, recordEvent } from "../src/issues.js";
import { saveRouting } from "../src/notify/store.js";
import { getConfig, saveConfig } from "../src/settings.js";
import { as, json, pythonError, setup, signIn } from "./helpers.js";

describe("assignment and ownership", () => {
  it("assigns by hand and by ownership rule, and the assignee receiver reaches them", async () => {
    const s = await setup();
    await signIn(s.db, "ana@example.com");
    const cfg = await getConfig(s.db, s.project.id);
    await saveConfig(s.db, s.project.id, { ...cfg, owners: [{ field: "path", pattern: "^app/", owner: "ana@example.com" }] });
    await saveRouting(s.db, s.project.id, [{ name: "owner", matchers: [{ field: "level", op: "=~", value: ".*" }], sink: false, continue: false, receivers: [{ kind: "assignee", target: "" }] }]);
    await s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, { method: "POST", headers: { host: "b.example.com" }, body: JSON.stringify(pythonError) });
    await s.queue.idle();
    await s.outbox.drain();
    const issue = (await getIssue(s.db, s.project.id, 1))!;
    expect(issue.assignee).toBe("ana@example.com");
    expect(s.senders.sent.map((x) => x.d.target)).toEqual(["ana@example.com"]);
    expect((await listActivity(s.db, 1)).map((a) => a.text)).toContain("Assigned to ana@example.com by ownership rule 1");

    expect((await s.app.request(`/api/projects/${s.project.id}/issues/1/assign`, { method: "POST", ...json({ assignee: "bo@example.com" }) })).status).toBe(200);
    expect((await getIssue(s.db, s.project.id, 1))!.assignee).toBe("bo@example.com");
    expect((await board(s.db, { status: "all", sort: "latest", q: "", assignee: "bo@example.com" })).issues).toHaveLength(1);
    expect((await board(s.db, { status: "all", sort: "latest", q: "", assignee: "" })).issues).toHaveLength(0);
  });

  it("lets viewers see but not assign", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "cy@example.com", "viewer");
    const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
    expect((await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/assign`, { method: "POST", ...json({ assignee: "" }, as("cy@example.com")) })).status).toBe(403);
  });

  it("checks ownership rules from the settings page", async () => {
    const s = await setup();
    const put = (body: unknown) => s.app.request(`/api/projects/${s.project.id}/config/owners`, { method: "PUT", ...json(body) });
    expect((await put([{ field: "path", pattern: "^app/", owner: "not-an-email" }])).status).toBe(400);
    expect((await put([{ field: "path", pattern: "(", owner: "a@example.com" }])).status).toBe(400);
    expect((await put([{ field: "tag", pattern: "x", owner: "a@example.com" }])).status).toBe(400); // no tag name
    expect((await put([{ field: "path", pattern: "^app/", owner: "A@example.com" }])).status).toBe(200);
    expect((await getConfig(s.db, s.project.id)).owners).toEqual([{ field: "path", pattern: "^app/", owner: "a@example.com" }]);
  });
});
