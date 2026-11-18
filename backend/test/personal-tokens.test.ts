import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { recordEvent } from "../src/issues.js";
import { createPersonalToken } from "../src/personal-tokens.js";
import { createProject } from "../src/projects.js";
import { recordLogin } from "../src/users.js";
import { as, json, pythonError, setup } from "./helpers.js";

const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

async function makeToken(s: Awaited<ReturnType<typeof setup>>, email: string, body: Record<string, unknown>) {
  const res = await s.app.request("/api/profile/tokens", { method: "POST", ...json(body, as(email)) });
  return { status: res.status, ...((await res.json()) as { token: string; view: { id: number; scope: string; expiresAt: number }; detail?: string }) };
}

describe("personal access tokens", () => {
  it("are shown once, kept as a hash, listed, and revoked", async () => {
    const s = await setup({ auth: true });
    await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {} });
    const made = await makeToken(s, "ana@example.com", { name: "Claude Code", scope: "read", days: 30 });
    expect(made.status).toBe(201);
    expect(made.token).toMatch(/^brp_[0-9a-f]{40}$/);
    expect(made.view.expiresAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const stored = await s.db.get<{ token_hash: string }>("SELECT token_hash FROM personal_tokens");
    expect(stored!.token_hash).not.toContain(made.token.slice(4));

    const list = (await (await s.app.request("/api/profile/tokens", { headers: as("ana@example.com") })).json()) as { tokens: { id: number; prefix: string }[] };
    expect(list.tokens.map((t) => t.prefix)).toEqual([made.token.slice(0, 8)]);
    // Someone else neither sees nor revokes it.
    await recordLogin(s.db, { email: "bo@example.com", issuer: "password", claims: {} });
    expect(((await (await s.app.request("/api/profile/tokens", { headers: as("bo@example.com") })).json()) as { tokens: unknown[] }).tokens).toEqual([]);
    expect((await s.app.request(`/api/profile/tokens/${made.view.id}`, { method: "DELETE", headers: as("bo@example.com") })).status).toBe(404);

    expect((await s.app.request("/api/projects", { headers: bearer(made.token) })).status).toBe(200);
    expect((await s.app.request(`/api/profile/tokens/${made.view.id}`, { method: "DELETE", headers: as("ana@example.com") })).status).toBe(204);
    expect((await s.app.request("/api/projects", { headers: bearer(made.token) })).status).toBe(401);
  });

  it("check the name, access, and how long they last", async () => {
    const s = await setup({ auth: true });
    await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {} });
    expect((await makeToken(s, "ana@example.com", { name: "" })).status).toBe(400);
    expect((await makeToken(s, "ana@example.com", { name: "x", scope: "admin" })).status).toBe(400);
    expect((await makeToken(s, "ana@example.com", { name: "x", days: 7 })).status).toBe(400);
    expect((await makeToken(s, "ana@example.com", { name: "x", days: 180 })).view.expiresAt).toBeGreaterThan(Date.now() + 179 * 86_400_000);
    const never = await makeToken(s, "ana@example.com", { name: "x", days: 0 });
    expect([never.status, never.view.expiresAt, never.view.scope]).toEqual([201, 0, "read"]);
  });

  it("act as their person, with the person's roles and groups", async () => {
    const s = await setup({ auth: true });
    const other = await createProject(s.db, "billing");
    await setGrant(s.db, s.project.id, "group", "web-team", "member");
    await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {}, groups: ["web-team"] });
    const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
    const { token } = await makeToken(s, "ana@example.com", { name: "agent", scope: "write" });

    const projects = (await (await s.app.request("/api/projects", { headers: bearer(token) })).json()) as { projects: { id: number; role: string }[] };
    expect(projects.projects.map((p) => [p.id, p.role])).toEqual([[s.project.id, "member"]]);
    expect((await s.app.request(`/api/projects/${other.id}`, { headers: bearer(token) })).status).toBe(404);
    // A write token triages, recorded as the person.
    expect((await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/resolve`, { method: "POST", headers: bearer(token) })).status).toBe(200);
    const issue = (await (await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`, { headers: bearer(token) })).json()) as { activity: { actor: string; kind: string }[] };
    expect(issue.activity.find((a) => a.kind === "resolved")).toMatchObject({ actor: "ana@example.com" });
    // Not an admin, so no admin pages.
    expect((await s.app.request(`/api/projects/${s.project.id}/tokens`, { headers: bearer(token) })).status).toBe(403);
  });

  it("read-only tokens only read; no token reaches tokens", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {} });
    const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
    const read = (await makeToken(s, "ana@example.com", { name: "r", scope: "read" })).token;
    const write = (await makeToken(s, "ana@example.com", { name: "w", scope: "write" })).token;

    expect((await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`, { headers: bearer(read) })).status).toBe(200);
    const denied = await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/resolve`, { method: "POST", headers: bearer(read) });
    expect([denied.status, ((await denied.json()) as { detail: string }).detail]).toEqual([403, "this token is read-only"]);
    // Neither kind lists or makes personal tokens, or makes project tokens.
    for (const t of [read, write]) {
      expect((await s.app.request("/api/profile/tokens", { headers: bearer(t) })).status).toBe(403);
      expect((await s.app.request("/api/profile/tokens", { method: "POST", ...json({ name: "x" }, bearer(t)) })).status).toBe(403);
    }
    expect((await s.app.request(`/api/projects/${s.project.id}/tokens`, { method: "POST", ...json({ name: "CI" }, bearer(write)) })).status).toBe(403);
  });

  it("stop working when they expire", async () => {
    const s = await setup({ auth: true });
    await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {} });
    const { token } = await createPersonalToken(s.db, "ana@example.com", { name: "old", scope: "read", days: 30 }, Date.now() - 31 * 86_400_000);
    const res = await s.app.request("/api/projects", { headers: bearer(token) });
    expect([res.status, ((await res.json()) as { detail: string }).detail]).toEqual([401, "invalid or expired personal access token"]);
    expect((await s.app.request("/api/projects", { headers: bearer("brp_" + "0".repeat(40)) })).status).toBe(401);
  });
});
