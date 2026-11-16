import { describe, expect, it } from "vitest";
import { getIssue, recordEvent } from "../src/issues.js";
import { tagBreakdown } from "../src/issue-tags.js";
import { mergedInto } from "../src/merge.js";
import { getConfig, saveConfig } from "../src/settings.js";
import { json, setup } from "./helpers.js";

describe("merging and grouping rules", () => {
  it("merges issues, sends later events of either to the one kept, and splits one back out", async () => {
    const s = await setup();
    const a = await recordEvent(s.db, s.project.id, { message: "timeout talking to db" });
    const b = await recordEvent(s.db, s.project.id, { message: "db connection reset", tags: { region: "eu" } });
    await recordEvent(s.db, s.project.id, { message: "db connection reset", tags: { region: "eu" } });
    const res = await s.app.request(`/api/projects/${s.project.id}/issues/merge`, { method: "POST", ...json({ into: a.issueId, issues: [a.issueId, b.issueId] }) });
    expect(await res.json()).toEqual({ into: a.issueId, merged: 1 });
    expect(await getIssue(s.db, s.project.id, b.issueId)).toBeUndefined();
    expect((await getIssue(s.db, s.project.id, a.issueId))!.eventCount).toBe(3);
    expect((await recordEvent(s.db, s.project.id, { message: "db connection reset" })).issueId).toBe(a.issueId);
    const merged = await mergedInto(s.db, a.issueId);
    expect(merged).toEqual([expect.objectContaining({ title: "db connection reset", events: 3 })]);

    const split = await s.app.request(`/api/projects/${s.project.id}/issues/${a.issueId}/unmerge`, { method: "POST", ...json({ fingerprint: merged[0]!.fingerprint }) });
    const { issue: back } = (await split.json()) as { issue: number };
    expect(await getIssue(s.db, s.project.id, back)).toMatchObject({ title: "db connection reset", eventCount: 3 });
    expect((await getIssue(s.db, s.project.id, a.issueId))!.eventCount).toBe(1);
    expect((await tagBreakdown(s.db, back)).find((t) => t.key === "region")!.total).toBe(2);
    expect((await recordEvent(s.db, s.project.id, { message: "db connection reset" })).issueId).toBe(back);
  });

  it("groups by the project's rules", async () => {
    const s = await setup();
    const cfg = await getConfig(s.db, s.project.id);
    await saveConfig(s.db, s.project.id, { ...cfg, grouping: [{ field: "message", pattern: "timeout", fingerprint: "timeouts {{ tag.region }}" }] });
    const a = await recordEvent(s.db, s.project.id, { message: "read timeout on /a", tags: { region: "eu" } });
    const b = await recordEvent(s.db, s.project.id, { message: "connect timeout to db", tags: { region: "eu" } });
    const c = await recordEvent(s.db, s.project.id, { message: "connect timeout to db", tags: { region: "us" } });
    expect(a.issueId).toBe(b.issueId);
    expect(c.issueId).not.toBe(a.issueId);
  });

  it("checks grouping rules from the settings page", async () => {
    const s = await setup();
    const put = (body: unknown) => s.app.request(`/api/projects/${s.project.id}/config/grouping`, { method: "PUT", ...json(body) });
    expect((await put([{ field: "message", pattern: "(", fingerprint: "x" }])).status).toBe(400);
    expect((await put([{ field: "message", pattern: "x", fingerprint: " " }])).status).toBe(400);
    expect((await put([{ field: "message", pattern: "timeout", fingerprint: "timeouts" }])).status).toBe(200);
  });
});
