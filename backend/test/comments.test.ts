import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { getComment } from "../src/comments.js";
import { recordEvent } from "../src/issues.js";
import { as, json, pythonError, setup, signIn } from "./helpers.js";

type View = { id: number; author: string; body: string; editedAt: number; authorName: string; authorUsername: string; canEdit: boolean; canDelete: boolean }[];

async function world() {
  const s = await setup({ auth: true });
  await setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
  await setGrant(s.db, s.project.id, "user", "bo@example.com", "member");
  await setGrant(s.db, s.project.id, "user", "cy@example.com", "viewer");
  await signIn(s.db, "bo@example.com", { preferred_username: "bo" });
  const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
  const url = `/api/projects/${s.project.id}/issues/${issueId}/comments`;
  const call = async (who: string, method: string, path = "", body?: object) => {
    const res = await s.app.request(url + path, body ? { method, ...json(body, as(who)) } : { method, headers: as(who) });
    return { status: res.status, body: (await res.json()) as View & { detail?: string } };
  };
  return { ...s, issueId, call };
}

describe("comments", () => {
  it("lets anyone with a role comment, viewers too, and lists them oldest first", async () => {
    const w = await world();
    expect((await w.call("cy@example.com", "POST", "", { body: "seen in **prod**" })).status).toBe(200);
    const res = await w.call("bo@example.com", "POST", "", { body: "on it, @cy" });
    expect(res.body.map((c) => c.body)).toEqual(["seen in **prod**", "on it, @cy"]);
    expect(res.body[1]).toMatchObject({ author: "bo@example.com", authorName: "bo", authorUsername: "bo", canEdit: true, canDelete: true });
    expect(res.body[0]).toMatchObject({ author: "cy@example.com", authorUsername: "cy", canEdit: false, canDelete: false });
    expect((await w.call("zed@example.com", "POST", "", { body: "hi" })).status).toBe(404);
    expect((await w.call("bo@example.com", "POST", "", { body: "   " })).status).toBe(400);
    expect((await w.call("bo@example.com", "POST", "", { body: "x".repeat(10_001) })).status).toBe(400);

    const detail = (await (await w.app.request(`/api/projects/${w.project.id}/issues/${w.issueId}`, { headers: as("ana@example.com") })).json()) as { comments: View };
    expect(detail.comments.map((c) => [c.author, c.canEdit, c.canDelete])).toEqual([
      ["cy@example.com", false, true],
      ["bo@example.com", false, true],
    ]);
  });

  it("lets only the author edit, and keeps the earlier text", async () => {
    const w = await world();
    const [c] = (await w.call("bo@example.com", "POST", "", { body: "first" })).body;
    expect((await w.call("ana@example.com", "PATCH", `/${c!.id}`, { body: "admin edit" })).status).toBe(403);
    const edited = await w.call("bo@example.com", "PATCH", `/${c!.id}`, { body: "second" });
    expect(edited.body[0]).toMatchObject({ body: "second" });
    expect(edited.body[0]!.editedAt).toBeGreaterThan(0);
    expect((await getComment(w.db, w.issueId, c!.id))!.history.map((h) => h.body)).toEqual(["first"]);
    // An edit that changes nothing is not recorded.
    await w.call("bo@example.com", "PATCH", `/${c!.id}`, { body: "second" });
    expect((await getComment(w.db, w.issueId, c!.id))!.history).toHaveLength(1);
  });

  it("lets the author or an admin delete", async () => {
    const w = await world();
    const [a] = (await w.call("bo@example.com", "POST", "", { body: "mine" })).body;
    expect((await w.call("cy@example.com", "DELETE", `/${a!.id}`)).status).toBe(403);
    expect((await w.call("ana@example.com", "DELETE", `/${a!.id}`)).body).toEqual([]);
    const [b] = (await w.call("bo@example.com", "POST", "", { body: "again" })).body;
    expect((await w.call("bo@example.com", "DELETE", `/${b!.id}`)).body).toEqual([]);
    expect((await w.call("bo@example.com", "DELETE", "/999")).status).toBe(404);
  });
});
