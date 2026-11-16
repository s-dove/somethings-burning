import { describe, expect, it } from "vitest";
import { recordEvent } from "../src/issues.js";
import { tagBreakdown, usersAffected } from "../src/issue-tags.js";
import { pythonError, setup } from "./helpers.js";

describe("tags and users", () => {
  it("counts each tag value and the distinct users an issue reached", async () => {
    const s = await setup();
    const ev = (browser: string, user: string) => ({ ...pythonError, environment: "production", tags: { region: "eu" }, contexts: { browser: { name: browser, version: "131" } }, user: { id: user } });
    let id = 0;
    for (const [b, u] of [["Chrome", "1"], ["Chrome", "2"], ["Firefox", "1"]] as const) id = (await recordEvent(s.db, s.project.id, ev(b, u))).issueId;
    const tags = await tagBreakdown(s.db, id);
    expect(tags.map((t) => t.key)).toEqual(["environment", "browser", "level", "region"]);
    expect(tags.find((t) => t.key === "browser")!.values).toEqual([{ value: "Chrome 131", count: 2 }, { value: "Firefox 131", count: 1 }]);
    expect(await usersAffected(s.db, id)).toBe(2);
    const detail = (await (await s.app.request(`/api/projects/${s.project.id}/issues/${id}`)).json()) as { users: number; tags: unknown[] };
    expect(detail.users).toBe(2);
    expect(detail.tags).toHaveLength(4);
    // No level sent: no level tag, rather than a made-up "error".
    const bare = await recordEvent(s.db, s.project.id, { message: "no level here" });
    expect((await tagBreakdown(s.db, bare.issueId)).map((t) => t.key)).not.toContain("level");
  });
});
