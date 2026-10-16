import { Hono, type Context } from "hono";
import type { Db } from "./db.js";
import { getIssue, latestEvents, listIssues } from "./issues.js";
import { createProject, deleteProject, getProject, listProjects, renameProject } from "./projects.js";

/** The URL SDKs reach this server at: PUBLIC_URL, or what the browser used. */
function publicUrl(c: Context): URL {
  if (process.env.PUBLIC_URL) return new URL(process.env.PUBLIC_URL);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  return new URL(`${proto}://${host}`);
}

function dsn(c: Context, projectId: number, key: string): string {
  const u = publicUrl(c);
  return `${u.protocol}//${key}@${u.host}${u.pathname.replace(/\/$/, "")}/${projectId}`;
}

async function nameFrom(c: Context): Promise<string | undefined> {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  return name && name.length <= 80 ? name : undefined;
}

export function apiRoutes(db: Db): Hono {
  const r = new Hono();

  r.get("/health", (c) => c.json({ status: "ok" }));

  r.get("/projects", (c) => c.json({ projects: listProjects(db) }));

  r.post("/projects", async (c) => {
    const name = await nameFrom(c);
    if (!name) return c.json({ detail: "name is required (up to 80 characters)" }, 400);
    const p = createProject(db, name);
    return c.json({ project: { ...p, dsn: dsn(c, p.id, p.publicKey) } }, 201);
  });

  r.get("/projects/:id{[0-9]+}", (c) => {
    const p = getProject(db, Number(c.req.param("id")));
    if (!p) return c.json({ detail: "not found" }, 404);
    return c.json({ project: { ...p, dsn: dsn(c, p.id, p.publicKey) } });
  });

  r.patch("/projects/:id{[0-9]+}", async (c) => {
    const name = await nameFrom(c);
    if (!name) return c.json({ detail: "name is required (up to 80 characters)" }, 400);
    const p = renameProject(db, Number(c.req.param("id")), name);
    if (!p) return c.json({ detail: "not found" }, 404);
    return c.json({ project: { ...p, dsn: dsn(c, p.id, p.publicKey) } });
  });

  r.delete("/projects/:id{[0-9]+}", (c) => {
    if (!deleteProject(db, Number(c.req.param("id")))) return c.json({ detail: "not found" }, 404);
    return c.body(null, 204);
  });

  r.get("/projects/:id{[0-9]+}/issues", (c) => {
    const id = Number(c.req.param("id"));
    if (!getProject(db, id)) return c.json({ detail: "not found" }, 404);
    return c.json({ issues: listIssues(db, id) });
  });

  r.get("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}", (c) => {
    const issue = getIssue(db, Number(c.req.param("id")), Number(c.req.param("issue")));
    if (!issue) return c.json({ detail: "not found" }, 404);
    return c.json({ issue, events: latestEvents(db, issue.id) });
  });

  return r;
}
