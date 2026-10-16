import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { createProject } from "../src/projects.js";
import { as, json, setup } from "./helpers.js";

describe("sign-in and access", () => {
  it("says how to sign in, and refuses the API without a session", async () => {
    const { app } = setup({ auth: true });
    expect(await (await app.request("/api/session")).json()).toEqual({ methods: { oidc: false, oidcName: "SSO", password: true }, user: null });
    expect((await app.request("/api/board")).status).toBe(401);
    expect((await app.request("/api/board", { headers: as("ana@example.com") })).status).toBe(200);
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("shows only the projects someone has a role in, by email or group", async () => {
    const { app, db, project } = setup({ auth: true });
    const board = async (who: Record<string, string>) =>
      ((await (await app.request("/api/board", { headers: who })).json()) as { projects: { name: string; role: string }[] }).projects;

    expect(await board(as("ana@example.com"))).toEqual([]);
    expect((await app.request(`/api/projects/${project.id}`, { headers: as("ana@example.com") })).status).toBe(404);

    setGrant(db, project.id, "user", "Ana@Example.com", "viewer");
    expect(await board(as("ana@example.com"))).toMatchObject([{ name: "web", role: "viewer" }]);

    setGrant(db, project.id, "group", "platform", "member");
    expect(await board(as("bo@example.com", ["platform"]))).toMatchObject([{ name: "web", role: "member" }]);
    // The highest matching role wins.
    expect(await board(as("ana@example.com", ["platform"]))).toMatchObject([{ role: "member" }]);
  });

  it("makes site admins admin everywhere", async () => {
    const { app } = setup({ auth: true, siteAdmins: "root@example.com, ops" });
    const role = async (who: Record<string, string>) =>
      ((await (await app.request("/api/board", { headers: who })).json()) as { projects: { role: string }[] }).projects[0]?.role;
    expect(await role(as("root@example.com"))).toBe("admin");
    expect(await role(as("x@example.com", ["ops"]))).toBe("admin");
    expect(await role(as("x@example.com"))).toBeUndefined();
  });

  it("makes the creator of a project its admin", async () => {
    const { app } = setup({ auth: true });
    const res = await app.request("/api/projects", { method: "POST", ...json({ name: "api" }, as("ana@example.com")) });
    const { project } = (await res.json()) as { project: { id: number } };
    const s = (await (await app.request(`/api/projects/${project.id}/settings`, { headers: as("ana@example.com") })).json()) as {
      project: { role: string };
      grants: { kind: string; subject: string; role: string }[];
    };
    expect(s.project.role).toBe("admin");
    expect(s.grants).toMatchObject([{ kind: "user", subject: "ana@example.com", role: "admin" }]);
  });

  it("lets only admins change access, and keeps one user admin", async () => {
    const { app, db, project } = setup({ auth: true });
    setGrant(db, project.id, "user", "ana@example.com", "admin");
    setGrant(db, project.id, "user", "bo@example.com", "member");
    const put = (who: string, body: object) => app.request(`/api/projects/${project.id}/access`, { method: "PUT", ...json(body, as(who)) });

    expect((await put("bo@example.com", { kind: "user", subject: "cy@example.com", role: "viewer" })).status).toBe(403);
    expect((await put("ana@example.com", { kind: "group", subject: "eng", role: "viewer" })).status).toBe(200);
    const last = await put("ana@example.com", { kind: "user", subject: "ana@example.com", role: "member" });
    expect(last.status).toBe(400);
    expect(((await last.json()) as { detail: string }).detail).toMatch(/at least one user as admin/);
  });

  it("lets only admins rename or delete a project", async () => {
    const { app, db, project } = setup({ auth: true });
    setGrant(db, project.id, "user", "bo@example.com", "member");
    expect((await app.request(`/api/projects/${project.id}`, { method: "DELETE", headers: as("bo@example.com") })).status).toBe(403);
    expect((await app.request(`/api/projects/${project.id}`, { method: "PATCH", ...json({ name: "x" }, as("bo@example.com")) })).status).toBe(403);
  });

  it("lets no one in when no sign-in is configured, but still takes events", async () => {
    const db = openDb(":memory:");
    const { app } = createApp(db);
    const project = createProject(db, "web");
    expect(await (await app.request("/api/session")).json()).toEqual({ methods: { oidc: false, oidcName: "SSO", password: false }, user: null });
    expect((await app.request("/api/board")).status).toBe(401);
    expect((await app.request("/auth/password", { method: "POST", ...json({ email: "a@example.com", password: "x" }) })).status).toBe(404);
    const ingest = await app.request(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, { method: "POST", body: JSON.stringify({ message: "hi" }) });
    expect(ingest.status).toBe(200);
  });

  it("rejects cross-site writes but not SDK ingest", async () => {
    const { app, project } = setup();
    const cross = await app.request("/api/projects", { method: "POST", ...json({ name: "x" }, { origin: "https://evil.example", host: "burning.example.com" }) });
    expect(cross.status).toBe(403);
    const ingest = await app.request(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, {
      method: "POST",
      headers: { origin: "https://shop.example", host: "burning.example.com" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(ingest.status).toBe(200);
  });
});
