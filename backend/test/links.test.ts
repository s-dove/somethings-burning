import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { recordEvent } from "../src/issues.js";
import { getUser } from "../src/users.js";
import { as, json, setup, signIn } from "./helpers.js";

describe("issue links by number", () => {
  it("finds an issue by its number alone, follows merges, and hides issues of other projects", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "member");
    const a = await recordEvent(s.db, s.project.id, { message: "timeout talking to db" });
    const b = await recordEvent(s.db, s.project.id, { message: "db connection reset" });
    const get = async (n: number, who: string) => {
      const res = await s.app.request(`/api/issues/${n}`, { headers: as(who) });
      return res.status === 200 ? await res.json() : res.status;
    };
    expect(await get(b.issueId, "ana@example.com")).toEqual({ project: s.project.id, issue: b.issueId, merged: false });
    expect(await get(b.issueId, "eve@example.com")).toBe(404); // no role: as if there were no such issue
    expect(await get(999, "ana@example.com")).toBe(404);
    await s.app.request(`/api/projects/${s.project.id}/issues/merge`, { method: "POST", ...json({ into: a.issueId, issues: [a.issueId, b.issueId] }, as("ana@example.com")) });
    expect(await get(b.issueId, "ana@example.com")).toEqual({ project: s.project.id, issue: a.issueId, merged: true });
  });
});

describe("languages", () => {
  it("keeps the language a person chooses, from the list only", async () => {
    const s = await setup({ auth: true });
    await signIn(s.db, "ana@example.com");
    const session = async () => (await getUser(s.db, "ana@example.com"))!.lang;
    expect(await session()).toBe(""); // not chosen yet: the app asks
    const put = (lang: string) => s.app.request("/api/profile/lang", { method: "PUT", ...json({ lang }, as("ana@example.com")) });
    expect((await put("ja")).status).toBe(200);
    expect(await session()).toBe("ja");
    expect((await put("xx")).status).toBe(400);
    expect(await session()).toBe("ja");
  });
});
