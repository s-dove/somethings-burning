import { Hono, type Context } from "hono";
import { atLeast, type Access, type Role } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Config } from "./env.js";
import type { Db } from "./db.js";
import { sendDigest } from "./digest.js";
import { assign, merge, unmerge } from "./issue-extras.js";
import { getIssue, NotFound } from "./issues.js";
import type { Senders } from "./notify/deliver.js";
import { getProject } from "./projects.js";
import { addDeploy, listReleases, upsertRelease } from "./releases.js";
import { checkSection, getConfig, saveConfig, type ProjectConfig } from "./settings.js";
import { GitHubSource } from "./source/github.js";
import type { CodeSources } from "./source/index.js";
import { forgetMaps } from "./source/sourcemaps.js";
import { getSources } from "./sources.js";
import { createToken, listTokens, revokeToken } from "./tokens.js";
import { publicBase } from "./url.js";
import { getUser } from "./users.js";

const MAX_ARTIFACT = 20 * 1024 * 1024;
const NAME = /^[\w.~:/@+-]{1,500}$/;

/**
 * The project features past the basics: settings sections (ownership,
 * spikes, scrubbing, grouping), assignment, merging, releases and deploys,
 * API tokens, source maps, GitHub issues, and the personal digest.
 */
export function extrasRoutes(db: Db, access: Access, deps: { senders: Senders; code: CodeSources; config: Config }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const P = "/projects/:id{[0-9]+}";

  const load = async (c: Context<AppEnv>) => {
    const project = await getProject(db, Number(c.req.param("id")));
    const role = project ? await access.role(project.id, c.get("user")) : null;
    return project && role ? { project, role } : null;
  };
  const notFound = (c: Context) => c.json({ detail: "not found" }, 404);
  const needs = (c: Context, role: Role) => c.json({ detail: `this needs the ${role} role` }, 403);
  const body = async <T>(c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as T;
  const actor = (c: Context<AppEnv>) => c.get("user")?.email ?? (c.get("token") ? "api token" : "");

  /** Runs fn for a project the caller holds `role` in; NotFound becomes a 404. */
  const withRole = (role: Role, fn: (c: Context<AppEnv>, found: NonNullable<Awaited<ReturnType<typeof load>>>) => Promise<Response>) => async (c: Context<AppEnv>) => {
    const found = await load(c);
    if (!found) return notFound(c);
    if (!atLeast(found.role, role)) return needs(c, role);
    try {
      return await fn(c, found);
    } catch (err) {
      if (err instanceof NotFound) return notFound(c);
      throw err;
    }
  };

  // ---- Settings sections ----

  app.get(`${P}/config`, withRole("viewer", async (c, f) => c.json({ project: { id: f.project.id, name: f.project.name, role: f.role }, config: await getConfig(db, f.project.id) })));

  app.put(
    `${P}/config/:section`,
    withRole("admin", async (c, f) => {
      const section = c.req.param("section") as keyof ProjectConfig;
      const checked = checkSection(section, await c.req.json().catch(() => null));
      if ("error" in checked) return c.json({ detail: checked.error }, 400);
      const config = await getConfig(db, f.project.id);
      (config as unknown as Record<string, unknown>)[section] = checked.value;
      await saveConfig(db, f.project.id, config);
      return c.json({ project: { id: f.project.id, name: f.project.name, role: f.role }, config });
    }),
  );

  // ---- Assignment, merging ----

  app.post(
    `${P}/issues/:issue{[0-9]+}/assign`,
    withRole("member", async (c, f) => {
      const { assignee } = await body<{ assignee?: unknown }>(c);
      const email = typeof assignee === "string" ? assignee.trim() : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ detail: "assign to an email, or to no one" }, 400);
      await assign(db, f.project.id, Number(c.req.param("issue")), email, actor(c));
      return c.json({ ok: true });
    }),
  );

  app.post(
    `${P}/issues/merge`,
    withRole("member", async (c, f) => {
      const b = await body<{ into?: unknown; issues?: unknown }>(c);
      const into = Number(b.into);
      const ids = (Array.isArray(b.issues) ? b.issues : []).map(Number).filter(Number.isSafeInteger);
      if (!Number.isSafeInteger(into) || ids.filter((i) => i !== into).length < 1) return c.json({ detail: "choose the issue to keep and at least one to merge into it" }, 400);
      const merged = await merge(db, f.project.id, into, ids, actor(c));
      return c.json({ into, merged });
    }),
  );

  app.post(
    `${P}/issues/:issue{[0-9]+}/unmerge`,
    withRole("member", async (c, f) => {
      const { fingerprint } = await body<{ fingerprint?: unknown }>(c);
      if (typeof fingerprint !== "string" || !fingerprint) return c.json({ detail: "name the fingerprint to split out" }, 400);
      const id = await unmerge(db, f.project.id, Number(c.req.param("issue")), fingerprint, actor(c));
      return c.json({ issue: id });
    }),
  );

  // ---- A GitHub issue from an issue ----

  app.post(
    `${P}/issues/:issue{[0-9]+}/github`,
    withRole("member", async (c, f) => {
      const issue = await getIssue(db, f.project.id, Number(c.req.param("issue")));
      if (!issue) return notFound(c);
      // One more after the first needs { again: true }, so a double click cannot make two.
      const again = (await body<{ again?: boolean }>(c)).again === true;
      if (issue.externalUrl && !again) return c.json({ detail: "a GitHub issue was made already", url: issue.externalUrl }, 409);
      const src = (await getSources(db, f.project.id)).find((s) => s.primary && s.kind === "github");
      if (!src) return c.json({ detail: "the project's primary code source is not a GitHub repository" }, 400);
      const link = `${publicBase(c, deps.config.baseURL)}/issues/${issue.id}`;
      const text = [
        `**${issue.title}**`,
        "",
        `${issue.eventCount} events since ${new Date(issue.firstSeen).toISOString().slice(0, 10)}${issue.culprit ? ` in \`${issue.culprit}\`` : ""}.`,
        "",
        `Burning: ${link}`,
      ].join("\n");
      const reader = deps.code.open(src);
      if (!(reader instanceof GitHubSource)) return c.json({ detail: "the primary source is not read through GitHub" }, 400);
      let url: string;
      try {
        url = await reader.createIssue(issue.title.slice(0, 250), text);
      } catch (err) {
        return c.json({ detail: (err as Error).message }, 502);
      }
      await db.run("UPDATE issues SET external_url = ? WHERE id = ?", url, issue.id);
      await db.run("INSERT INTO activity (issue_id, at, kind, text, actor) VALUES (?, ?, 'linked', ?, ?)", issue.id, Date.now(), `GitHub issue ${url}`, actor(c));
      return c.json({ url });
    }),
  );

  // ---- Releases and deploys ----

  app.get(`${P}/releases`, withRole("viewer", async (c, f) => c.json({ project: { id: f.project.id, name: f.project.name, role: f.role }, releases: await listReleases(db, f.project.id) })));

  app.post(
    `${P}/releases`,
    withRole("admin", async (c, f) => {
      const b = await body<{ version?: unknown; commit?: unknown }>(c);
      const version = String(b.version ?? "").trim();
      const commit = String(b.commit ?? "").trim();
      if (!version || version.length > 200) return c.json({ detail: "a release needs a version" }, 400);
      if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) return c.json({ detail: "the commit is a hex sha" }, 400);
      await upsertRelease(db, f.project.id, version, commit.toLowerCase());
      return c.json({ ok: true }, 201);
    }),
  );

  app.post(
    `${P}/deploys`,
    withRole("admin", async (c, f) => {
      const b = await body<{ release?: unknown; environment?: unknown; url?: unknown }>(c);
      const release = String(b.release ?? "").trim();
      const environment = String(b.environment ?? "").trim();
      const url = String(b.url ?? "").trim();
      if (!release || release.length > 200) return c.json({ detail: "a deploy needs the release" }, 400);
      if (environment.length > 100) return c.json({ detail: "the environment name is too long" }, 400);
      if (url && !/^https?:\/\/\S+$/.test(url)) return c.json({ detail: "the url is http(s)" }, 400);
      await addDeploy(db, f.project.id, release, environment, url);
      return c.json({ ok: true }, 201);
    }),
  );

  // ---- API tokens ----

  app.get(`${P}/tokens`, withRole("admin", async (c, f) => c.json({ tokens: await listTokens(db, f.project.id) })));
  app.post(
    `${P}/tokens`,
    withRole("admin", async (c, f) => {
      if (c.get("token")) return c.json({ detail: "a token cannot make tokens" }, 403);
      const name = String((await body<{ name?: unknown }>(c)).name ?? "").trim();
      if (!name || name.length > 80) return c.json({ detail: "name the token, like \"CI\"" }, 400);
      const made = await createToken(db, f.project.id, name, actor(c));
      return c.json(made, 201);
    }),
  );
  app.delete(
    `${P}/tokens/:token{[0-9]+}`,
    withRole("admin", async (c, f) => ((await revokeToken(db, f.project.id, Number(c.req.param("token")))) ? c.body(null, 204) : notFound(c))),
  );

  // ---- Source maps ----

  app.get(
    `${P}/sourcemaps`,
    withRole("viewer", async (c, f) => {
      const release = c.req.query("release");
      const rows = await db.all<{ release: string; name: string; size: number; created_at: number }>(
        `SELECT release, name, size, created_at FROM artifacts WHERE project_id = ? ${release ? "AND release = ?" : ""} ORDER BY created_at DESC LIMIT 500`,
        f.project.id,
        ...(release ? [release] : []),
      );
      return c.json({ artifacts: rows.map((r) => ({ release: r.release, name: r.name, size: r.size, createdAt: r.created_at })) });
    }),
  );

  // Upload: multipart (release, and one or more files; a file's name is its
  // URL path, like ~/static/js/app.js.map) or JSON { release, name, content }.
  app.post(
    `${P}/sourcemaps`,
    withRole("admin", async (c, f) => {
      const files: { name: string; content: string }[] = [];
      let release = "";
      if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
        const form = await c.req.parseBody({ all: true });
        release = String(form.release ?? "").trim();
        const prefix = String(form.prefix ?? "~/").trim();
        for (const v of Object.values(form).flat()) {
          if (v instanceof File) {
            if (v.size > MAX_ARTIFACT) return c.json({ detail: `${v.name} is over 20 MB` }, 413);
            const name = v.name.includes("/") ? v.name : `${prefix.replace(/\/?$/, "/")}${v.name}`;
            files.push({ name, content: await v.text() });
          }
        }
      } else {
        const b = await body<{ release?: unknown; name?: unknown; content?: unknown }>(c);
        release = String(b.release ?? "").trim();
        if (typeof b.content === "string") files.push({ name: String(b.name ?? "").trim(), content: b.content });
      }
      if (!release || release.length > 200) return c.json({ detail: "name the release the maps belong to" }, 400);
      if (!files.length) return c.json({ detail: "attach at least one .map file" }, 400);
      for (const file of files) {
        if (!NAME.test(file.name) || !file.name.endsWith(".map")) return c.json({ detail: `"${file.name}" should be a .map path, like ~/static/js/app.js.map` }, 400);
        if (file.content.length > MAX_ARTIFACT) return c.json({ detail: `${file.name} is over 20 MB` }, 413);
        try {
          const m = JSON.parse(file.content) as { version?: unknown; mappings?: unknown };
          if (m.version !== 3 || typeof m.mappings !== "string") throw new Error();
        } catch {
          return c.json({ detail: `${file.name} is not a version 3 source map` }, 400);
        }
      }
      await upsertRelease(db, f.project.id, release, "");
      for (const file of files) {
        await db.run(
          `INSERT INTO artifacts (project_id, release, name, content, size, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, release, name) DO UPDATE SET content = excluded.content, size = excluded.size, created_at = excluded.created_at`,
          f.project.id,
          release,
          file.name,
          file.content,
          file.content.length,
          Date.now(),
        );
      }
      forgetMaps(f.project.id, release);
      return c.json({ release, uploaded: files.map((x) => x.name) }, 201);
    }),
  );

  app.delete(
    `${P}/sourcemaps`,
    withRole("admin", async (c, f) => {
      const b = await body<{ release?: unknown; name?: unknown }>(c);
      const release = String(b.release ?? "");
      const r = await db.run(
        `DELETE FROM artifacts WHERE project_id = ? AND release = ? ${typeof b.name === "string" ? "AND name = ?" : ""}`,
        f.project.id,
        release,
        ...(typeof b.name === "string" ? [b.name] : []),
      );
      forgetMaps(f.project.id, release);
      return r.changes ? c.body(null, 204) : notFound(c);
    }),
  );

  // ---- The personal daily digest ----

  app.get("/profile/digest", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign in first" }, 404);
    const row = await db.get<{ digest: number; last_digest: number }>("SELECT digest, last_digest FROM users WHERE email = ?", user.email.toLowerCase());
    return c.json({ enabled: Number(row?.digest ?? 0) === 1, lastSent: row?.last_digest ?? 0, hourUTC: deps.config.digestHour, email: deps.senders.emailEnabled });
  });
  app.put("/profile/digest", async (c) => {
    const user = c.get("user");
    if (!user || !(await getUser(db, user.email))) return c.json({ detail: "sign in again to load your profile" }, 404);
    const { enabled } = await body<{ enabled?: unknown }>(c);
    await db.run("UPDATE users SET digest = ? WHERE email = ?", enabled === true ? 1 : 0, user.email.toLowerCase());
    return c.json({ enabled: enabled === true });
  });
  app.post("/profile/digest/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign in first" }, 404);
    try {
      const sent = await sendDigest(db, access, deps.senders, user.email, user.groups, publicBase(c, deps.config.baseURL));
      return sent ? c.json({ ok: true }) : c.json({ detail: "nothing happened in your projects in the last day" }, 200);
    } catch (err) {
      return c.json({ detail: (err as Error).message }, 502);
    }
  });

  return app;
}
