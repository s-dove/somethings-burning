import { Hono, type Context } from "hono";
import { Access, atLeast, setGrant, type Role } from "./access.js";
import type { Authenticator, User } from "./auth.js";
import type { Config } from "./env.js";
import { alertEvents, type LiveAlerts } from "./live.js";
import type { CodeSources } from "./source/index.js";
import { attachLinks } from "./source/links.js";
import { tagBreakdown, usersAffected } from "./issue-tags.js";
import { configRoutes } from "./config-api.js";
import { getSources } from "./sources.js";
import { sourcesRoutes } from "./sources-api.js";
import { listActivity } from "./activity.js";
import { board, type Sort, type StatusFilter } from "./board.js";
import { commentRoutes, commentsView } from "./comments-api.js";
import type { Db } from "./db.js";
import { eventView } from "./event-view.js";
import { eventPage, getEvent, getIssue, hoursByIssue, latestRelease, listIssues, mute, NotFound, releasesOf, reopenByHand, resolve, storedEventCount } from "./issues.js";
import type { Senders } from "./notify/deliver.js";
import { createProject, deleteProject, getProject, listProjects, NameTaken, renameProject } from "./projects.js";
import { profileRoutes } from "./profile-api.js";
import { routingRoutes } from "./routing-api.js";
import { settingsRoutes } from "./settings-api.js";
import { siteRoutes } from "./site-api.js";
import { MUTE_OPTIONS, muteOption } from "./triage.js";
import { dsn } from "./url.js";
import { people } from "./users.js";

export type AppEnv = { Variables: { user?: User } };

export interface ApiDeps {
  auth: Authenticator;
  access: Access;
  senders: Senders;
  baseURL: string;
  config: Config;
  live: LiveAlerts;
  code: CodeSources;
}

async function nameFrom(c: Context): Promise<string | undefined> {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  return name && name.length <= 80 ? name : undefined;
}

const SORTS: Sort[] = ["hot", "latest", "count"];
const STATUSES: StatusFilter[] = ["open", "resolved", "muted", "all"];
const pick = <T extends string>(v: string | undefined, of: T[], def: T): T => (of.includes(v as T) ? (v as T) : def);

/** The JSON API the web app reads, under /api. */
export function apiRoutes(db: Db, deps: ApiDeps): Hono<AppEnv> {
  const { auth, access } = deps;
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ status: "ok" }));

  // How to sign in, and who is signed in. Readable without a session.
  app.get("/session", async (c) => c.json({ methods: auth.methods, user: await auth.user(c) }));

  // Everything below needs a session.
  app.use("*", async (c, next) => {
    const user = await auth.user(c);
    if (!user) return c.json({ detail: "sign in first" }, 401);
    c.set("user", user);
    return next();
  });

  // Live alerts: a stream of project ids as their issues alert, only for
  // projects this person can see.
  app.get("/alerts", (c) => alertEvents(c, deps.live, async (id) => (await access.role(id, c.get("user"))) !== null));

  /** The project and the caller's role in it, or null when they cannot see it. */
  const load = async (c: Context<AppEnv>) => {
    const project = await getProject(db, Number(c.req.param("id")));
    const role = project ? await access.role(project.id, c.get("user")) : null;
    return project && role ? { project, role } : null;
  };
  const taken = (c: Context) => c.json({ detail: "a project with that name already exists" }, 409);
  const notFound = (c: Context) => c.json({ detail: "not found" }, 404);
  const needs = (c: Context, role: Role) =>
    c.json({ detail: role === "admin" ? "this needs the admin role" : "this needs the member role" }, 403);

  // One board for both views: every project's issues, or one project's.
  // Only projects the person has a role in are listed or counted.
  app.get("/board", async (c) => {
    const sort = pick(c.req.query("sort"), SORTS, "hot");
    const status = pick(c.req.query("status"), STATUSES, "open");
    const all = (await db.all<{ id: number }>("SELECT id FROM projects")).map((r) => r.id);
    const roles = await access.roles(all, c.get("user"));
    const scope = [...roles.keys()];
    const projectId = Number(c.req.query("project")) || undefined;
    if (projectId && !roles.has(projectId)) return notFound(c);
    const b = await board(db, { projectId, status, sort, q: (c.req.query("q") ?? "").trim().slice(0, 200), scope });
    return c.json({
      ...b,
      project: b.project && { ...b.project, role: roles.get(b.project.id) },
      projects: b.projects.map((p) => ({ ...p, role: roles.get(p.id) })),
      issues: b.issues.map((i) => ({ ...i, role: roles.get(i.projectId) })),
    });
  });

  app.get("/projects", async (c) => {
    const all = await listProjects(db);
    const roles = await access.roles(all.map((p) => p.id), c.get("user"));
    return c.json({ projects: all.filter((p) => roles.has(p.id)).map((p) => ({ ...p, role: roles.get(p.id) })) });
  });

  // Whoever creates a project is its first admin.
  app.post("/projects", async (c) => {
    const name = await nameFrom(c);
    if (!name) return c.json({ detail: "name is required (up to 80 characters)" }, 400);
    let p;
    try {
      p = await createProject(db, name);
    } catch (err) {
      if (err instanceof NameTaken) return taken(c);
      throw err;
    }
    const user = c.get("user");
    if (user) await setGrant(db, p.id, "user", user.email, "admin");
    return c.json({ project: { ...p, dsn: dsn(c, deps.baseURL, p.id, p.publicKey), role: "admin" } }, 201);
  });

  app.get("/projects/:id{[0-9]+}", async (c) => {
    const found = await load(c);
    if (!found) return notFound(c);
    const p = found.project;
    return c.json({ project: { ...p, dsn: dsn(c, deps.baseURL, p.id, p.publicKey), role: found.role } });
  });

  app.patch("/projects/:id{[0-9]+}", async (c) => {
    const found = await load(c);
    if (!found) return notFound(c);
    if (!atLeast(found.role, "admin")) return needs(c, "admin");
    const name = await nameFrom(c);
    if (!name) return c.json({ detail: "name is required (up to 80 characters)" }, 400);
    let p;
    try {
      p = (await renameProject(db, found.project.id, name))!;
    } catch (err) {
      if (err instanceof NameTaken) return taken(c);
      throw err;
    }
    return c.json({ project: { ...p, dsn: dsn(c, deps.baseURL, p.id, p.publicKey), role: found.role } });
  });

  app.delete("/projects/:id{[0-9]+}", async (c) => {
    const found = await load(c);
    if (!found) return notFound(c);
    if (!atLeast(found.role, "admin")) return needs(c, "admin");
    await deleteProject(db, found.project.id);
    return c.body(null, 204);
  });

  app.get("/projects/:id{[0-9]+}/issues", async (c) => {
    const found = await load(c);
    if (!found) return notFound(c);
    return c.json({ issues: await listIssues(db, found.project.id) });
  });

  // The issue page: the issue, its releases, the latest stored events, and
  // one event in full (?event=<id>, or the latest).
  app.get("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}", async (c) => {
    const found = await load(c);
    const issue = found && (await getIssue(db, found.project.id, Number(c.req.param("issue"))));
    if (!found || !issue) return notFound(c);
    const page = await eventPage(db, issue.id);
    const stored = await getEvent(db, issue.id, Number(c.req.query("event")) || undefined);
    const event = stored ? eventView(stored) : null;
    if (event && stored) await attachLinks(event, stored.payload, await getSources(db, found.project.id), deps.code);
    const history = await listActivity(db, issue.id);
    const actors = await people(db, history.map((a) => a.actor));
    return c.json({
      project: { id: found.project.id, name: found.project.name, role: found.role },
      issue: { ...issue, hours: (await hoursByIssue(db, [issue.id])).get(issue.id) },
      activity: history.map((a) => ({ ...a, actorName: a.actor ? (actors.get(a.actor)?.displayName ?? a.actor) : "" })),
      comments: await commentsView(db, issue.id, c.get("user")?.email.toLowerCase() ?? "", found.role),
      muteOptions: MUTE_OPTIONS.map(({ value, label }) => ({ value, label })),
      latestRelease: await latestRelease(db, found.project.id),
      releases: await releasesOf(db, issue.id),
      events: page.events,
      moreEvents: page.more,
      storedEvents: await storedEventCount(db, issue.id),
      event,
      tags: await tagBreakdown(db, issue.id),
      users: await usersAffected(db, issue.id),
    });
  });

  app.get("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/events", async (c) => {
    const found = await load(c);
    const issue = found && (await getIssue(db, found.project.id, Number(c.req.param("issue"))));
    if (!found || !issue) return notFound(c);
    return c.json(await eventPage(db, issue.id, Number(c.req.query("before")) || undefined));
  });

  // Triage needs the member role. The signed-in person is recorded as who did it.
  const action = (fn: (projectId: number, issueId: number, actor: string, c: Context<AppEnv>) => Promise<void> | void) => async (c: Context<AppEnv>) => {
    const found = await load(c);
    if (!found) return notFound(c);
    if (!atLeast(found.role, "member")) return c.json({ detail: "triage needs the member role" }, 403);
    try {
      await fn(found.project.id, Number(c.req.param("issue")), c.get("user")?.email ?? "", c);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof NotFound) return c.json({ detail: "issue not found" }, 404);
      if (err instanceof BadRequest) return c.json({ detail: err.message }, 400);
      throw err;
    }
  };
  app.post("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/resolve", action((p, i, actor) => resolve(db, p, i, actor)));
  app.post("/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/reopen", action((p, i, actor) => reopenByHand(db, p, i, actor)));
  app.post(
    "/projects/:id{[0-9]+}/issues/:issue{[0-9]+}/mute",
    action(async (p, i, actor, c) => {
      const body = (await c.req.json().catch(() => ({}))) as { for?: string };
      const opt = muteOption(body.for ?? "");
      if (!opt) throw new BadRequest("choose how long to mute");
      await mute(db, p, i, opt, actor);
    }),
  );

  app.route("/", commentRoutes(db, access));
  app.route("/", configRoutes(db, access));
  app.route("/", sourcesRoutes(db, access, deps.code));
  app.route("/", siteRoutes(deps.config, deps.senders, deps.code));
  app.route("/", settingsRoutes(db, access, deps.baseURL));
  app.route("/", routingRoutes(db, access, deps.senders));
  app.route("/", profileRoutes(db, deps.senders));

  return app;
}

class BadRequest extends Error {}
