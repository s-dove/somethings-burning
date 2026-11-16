import { Hono } from "hono";
import type { Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { body, P, projectRoute } from "./project-routes.js";

export interface ReleaseSummary {
  version: string;
  firstSeen: number;
  commit: string;
  events: number;
  issues: number; // issues with events in it
  newIssues: number; // issues first seen in it
  regressions: number; // issues that fired again in it
  deploys: { environment: string; url: string; at: number }[];
}

/** A project's releases, newest first, with what each brought. */
export async function listReleases(db: Db, projectId: number, limit = 100): Promise<ReleaseSummary[]> {
  const rows = await db.all<{ version: string; first_seen: number; commit_sha: string }>(
    "SELECT version, first_seen, commit_sha FROM releases WHERE project_id = ? ORDER BY first_seen DESC LIMIT ?",
    projectId,
    limit,
  );
  if (!rows.length) return [];
  const versions = rows.map((r) => r.version);
  const inList = versions.map(() => "?").join(",");
  const counts = new Map(
    (
      await db.all<{ release: string; events: number; issues: number }>(
        `SELECT r.release, SUM(r.event_count) AS events, COUNT(DISTINCT r.issue_id) AS issues FROM issue_releases r JOIN issues i ON i.id = r.issue_id
          WHERE i.project_id = ? AND r.release IN (${inList}) GROUP BY r.release`,
        projectId,
        ...versions,
      )
    ).map((r) => [r.release, r]),
  );
  const kinds = await db.all<{ release: string; kind: string; n: number }>(
    `SELECT a.release, a.kind, COUNT(DISTINCT a.issue_id) AS n FROM activity a JOIN issues i ON i.id = a.issue_id
      WHERE i.project_id = ? AND a.kind IN ('created', 'fired') AND a.release IN (${inList}) GROUP BY a.release, a.kind`,
    projectId,
    ...versions,
  );
  const deploys = await db.all<{ release: string; environment: string; url: string; at: number }>(
    `SELECT release, environment, url, at FROM deploys WHERE project_id = ? AND release IN (${inList}) ORDER BY at DESC`,
    projectId,
    ...versions,
  );
  return rows.map((r) => ({
    version: r.version,
    firstSeen: r.first_seen,
    commit: r.commit_sha,
    events: counts.get(r.version)?.events ?? 0,
    issues: counts.get(r.version)?.issues ?? 0,
    newIssues: kinds.find((k) => k.release === r.version && k.kind === "created")?.n ?? 0,
    regressions: kinds.find((k) => k.release === r.version && k.kind === "fired")?.n ?? 0,
    deploys: deploys.filter((d) => d.release === r.version).map(({ environment, url, at }) => ({ environment, url, at })),
  }));
}

/** Records a release from CI, before or after its first event; the commit is optional. */
export async function upsertRelease(db: Db, projectId: number, version: string, commit: string, now = Date.now()): Promise<void> {
  await db.run(
    `INSERT INTO releases (project_id, version, first_seen, commit_sha) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id, version) DO UPDATE SET commit_sha = CASE WHEN excluded.commit_sha != '' THEN excluded.commit_sha ELSE releases.commit_sha END`,
    projectId,
    version,
    now,
    commit,
  );
}

export async function addDeploy(db: Db, projectId: number, release: string, environment: string, url: string, now = Date.now()): Promise<void> {
  await upsertRelease(db, projectId, release, "", now);
  await db.run("INSERT INTO deploys (project_id, release, environment, url, at) VALUES (?, ?, ?, ?, ?)", projectId, release, environment, url, now);
}

/** Releases (anyone on the project) and, for admins or an API token, creating releases and marking deploys. */
export function releaseRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);

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

  return app;
}
