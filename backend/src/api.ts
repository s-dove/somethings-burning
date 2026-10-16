import { Hono, type Context } from "hono";
import { board, type Sort } from "./board.js";
import type { Db } from "./db.js";
import { eventView } from "./event-view.js";
import {
  eventPage,
  getEvent,
  getIssue,
  hoursByIssue,
  listIssues,
  releasesOf,
  storedEventCount,
} from "./issues.js";
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

const SORTS: Sort[] = ["hot", "latest", "count"];

export function apiRoutes(db: Db): Hono {
  const r = new Hono();

  r.get("/health", (c) => c.json({ status: "ok" }));

  r.get("/board", (c) => {
    const sort = SORTS.includes(c.req.query("sort") as Sort) ? (c.req.query("sort") as Sort) : "hot";
    const projectId = Number(c.req.query("project")) || undefined;
    if (projectId && !getProject(db, projectId)) return c.json({ detail: "not found" }, 404);
    return c.json(board(db, { projectId, sort, q: (c.req.query("q") ?? "").trim().slice(0, 200) }));
  });

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

  // The issue page: the issue, its releases, the latest stored events, and
  // one event in full (?event=<id>, or the latest).
  r.get("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}", (c) => {
    const project = getProject(db, Number(c.req.param("id")));
    const issue = project && getIssue(db, project.id, Number(c.req.param("issue")));
    if (!project || !issue) return c.json({ detail: "not found" }, 404);
    const page = eventPage(db, issue.id);
    const stored = getEvent(db, issue.id, Number(c.req.query("event")) || undefined);
    return c.json({
      project: { id: project.id, name: project.name },
      issue: { ...issue, hours: hoursByIssue(db, [issue.id]).get(issue.id) },
      releases: releasesOf(db, issue.id),
      events: page.events,
      moreEvents: page.more,
      storedEvents: storedEventCount(db, issue.id),
      event: stored ? eventView(stored) : null,
    });
  });

  r.get("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/events", (c) => {
    const issue = getIssue(db, Number(c.req.param("id")), Number(c.req.param("issue")));
    if (!issue) return c.json({ detail: "not found" }, 404);
    return c.json(eventPage(db, issue.id, Number(c.req.query("before")) || undefined));
  });

  return r;
}
