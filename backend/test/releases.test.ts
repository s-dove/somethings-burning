import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { board } from "../src/board.js";
import { recordEvent, resolve } from "../src/issues.js";
import { listReleases } from "../src/releases.js";
import { as, json, pythonError, setup } from "./helpers.js";

describe("releases and deploys", () => {
  it("lists releases with their events, new issues, regressions, and deploys", async () => {
    const s = await setup();
    const t = Date.now();
    const a = await recordEvent(s.db, s.project.id, { ...pythonError, release: "web@1" }, t - 10_000);
    await resolve(s.db, s.project.id, a.issueId);
    await recordEvent(s.db, s.project.id, { ...pythonError, release: "web@2" }, t - 5000);
    await recordEvent(s.db, s.project.id, { message: "new in 2", release: "web@2" }, t - 4000);
    await s.app.request(`/api/projects/${s.project.id}/deploys`, { method: "POST", ...json({ release: "web@2", environment: "production" }) });
    const list = await listReleases(s.db, s.project.id);
    expect(list.map((r) => [r.version, r.events, r.issues, r.newIssues, r.regressions, r.deploys.length])).toEqual([
      ["web@2", 2, 2, 1, 1, 1],
      ["web@1", 1, 1, 1, 0, 0],
    ]);
    // The board narrows to one release's issues.
    expect((await board(s.db, { status: "all", sort: "latest", q: "", release: "web@1" })).issues).toHaveLength(1);
  });
});

describe("API tokens", () => {
  it("lets a token create releases and deploys for its project only", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    const made = await s.app.request(`/api/projects/${s.project.id}/tokens`, { method: "POST", ...json({ name: "CI" }, as("ana@example.com")) });
    const { token } = (await made.json()) as { token: string };
    expect(token).toMatch(/^brn_[0-9a-f]{40}$/);
    const ci = (path: string, body: unknown) => s.app.request(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await ci(`/api/projects/${s.project.id}/releases`, { version: "web@3", commit: "abc1234" })).status).toBe(201);
    expect((await ci(`/api/projects/${s.project.id}/deploys`, { release: "web@3", environment: "production" })).status).toBe(201);
    // Nothing else, and not another project.
    expect((await s.app.request(`/api/projects/${s.project.id}/issues`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    expect((await ci(`/api/projects/${s.project.id}/tokens`, { name: "more" })).status).toBe(403);
    expect((await ci(`/api/projects/999/releases`, { version: "x" })).status).toBe(403);
    expect((await s.app.request("/api/board", { headers: { authorization: "Bearer brn_" + "0".repeat(40) } })).status).toBe(401);
    expect((await listReleases(s.db, s.project.id))[0]).toMatchObject({ version: "web@3", commit: "abc1234", deploys: [{ environment: "production" }] });
    const tokens = (await (await s.app.request(`/api/projects/${s.project.id}/tokens`, { headers: as("ana@example.com") })).json()) as { tokens: { id: number; lastUsed: number }[] };
    expect(tokens.tokens[0]!.lastUsed).toBeGreaterThan(0);
    expect((await s.app.request(`/api/projects/${s.project.id}/tokens/${tokens.tokens[0]!.id}`, { method: "DELETE", headers: as("ana@example.com") })).status).toBe(204);
    expect((await ci(`/api/projects/${s.project.id}/releases`, { version: "web@4" })).status).toBe(401);
  });
});
