import { Hono, type Context } from "hono";
import { adminCheck, atLeast, type Access, type Grant, isRole, listGrants, normalizeSubject, removeGrant, type Role, ROLES, setGrant, type SubjectKind } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { getProject, type Project } from "./projects.js";
import { allPeople, people } from "./users.js";
import { dsn } from "./url.js";

const isKind = (v: unknown): v is SubjectKind => v === "user" || v === "group";

/**
 * A project's settings: the DSN, and who has which role. Anyone with a role
 * reads them; only admins change access. /people lists who a route can send to.
 */
export function settingsRoutes(db: Db, access: Access, baseURL: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Adds the display name of each user grant (empty for groups).
  const withNames = (grants: Grant[]) => {
    const who = people(db, grants.filter((g) => g.kind === "user").map((g) => g.subject));
    return grants.map((g) => ({ ...g, name: g.kind === "user" ? (who.get(g.subject)?.displayName ?? "") : "" }));
  };

  const load = (c: Context<AppEnv>) => {
    const project = getProject(db, Number(c.req.param("id")));
    const role = project ? access.role(project.id, c.get("user")) : null;
    return project && role ? { project, role } : null;
  };

  const view = (c: Context<AppEnv>, project: Project, role: Role | null) =>
    c.json({
      project: { id: project.id, name: project.name, role, createdAt: project.createdAt },
      dsn: dsn(c, baseURL, project.id, project.publicKey),
      grants: withNames(listGrants(db, project.id)),
      roles: ROLES,
    });

  app.get("/projects/:id{[0-9]+}/settings", (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    return view(c, found.project, found.role);
  });

  // PUT adds a grant or changes its role. DELETE removes it. Every change
  // must leave at least one user as admin.
  app.on(["PUT", "DELETE"], "/projects/:id{[0-9]+}/access", async (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    if (!atLeast(found.role, "admin")) return c.json({ detail: "only admins change access" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; subject?: unknown; role?: unknown };
    if (!isKind(body.kind)) return c.json({ detail: "choose a user or a group" }, 400);
    const subject = typeof body.subject === "string" ? normalizeSubject(body.kind, body.subject) : "";
    if (!subject) return c.json({ detail: body.kind === "user" ? "enter an email" : "enter a group name" }, 400);
    if (body.kind === "user" && !subject.includes("@")) return c.json({ detail: "enter the user's email" }, 400);
    const id = found.project.id;
    const grants = listGrants(db, id);
    const put = c.req.method === "PUT";
    if (put && !isRole(body.role)) return c.json({ detail: "choose a role" }, 400);
    if (!put && !grants.some((g) => g.kind === body.kind && g.subject === subject)) return c.json({ detail: "no such grant" }, 404);
    const problem = adminCheck(grants, body.kind, subject, put ? (body.role as Role) : null);
    if (problem) return c.json({ detail: problem }, 400);
    if (put) setGrant(db, id, body.kind, subject, body.role as Role);
    else removeGrant(db, id, body.kind, subject);
    // The change went through even if it removed the caller's own access;
    // a null role tells the page they can no longer see the project.
    return view(c, found.project, access.role(id, c.get("user")));
  });

  // Everyone who has signed in, plus anyone granted a role on the project by
  // email who has not. People with a role on the project come first.
  app.get("/people", (c) => {
    const projectId = Number(c.req.query("project") ?? 0) || 0;
    const roles = new Map<string, string>();
    if (projectId && access.role(projectId, c.get("user"))) {
      for (const g of listGrants(db, projectId)) if (g.kind === "user") roles.set(g.subject, g.role);
    }
    const out = new Map(allPeople(db).map((p) => [p.email, { ...p, role: roles.get(p.email) ?? "" }]));
    for (const [email, role] of roles) {
      if (!out.has(email)) out.set(email, { email, username: email.split("@")[0]!, displayName: email, role });
    }
    const rank = (p: { role: string }) => (p.role === "admin" ? 0 : p.role === "member" ? 1 : p.role ? 2 : 3);
    return c.json([...out.values()].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName)));
  });

  return app;
}
