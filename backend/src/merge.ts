import { Hono } from "hono";
import type { Access } from "./access.js";
import { addActivity } from "./activity.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { summarize, type SentryEvent } from "./event.js";
import { tagsOf } from "./issue-tags.js";
import { NotFound, type IssueRow } from "./issues.js";
import { actor, body, P, projectRoute } from "./project-routes.js";

const HOUR = 3_600_000;

// Merging issues into one, and splitting a merged one back out. A merged
// issue's fingerprint points at the issue it went into, so its later events
// join it too.


export interface Merged {
  fingerprint: string;
  title: string;
  mergedAt: number;
  events: number; // stored events with this fingerprint
}

export async function mergedInto(db: Db, issueId: number): Promise<Merged[]> {
  const rows = await db.all<{ fingerprint: string; title: string; merged_at: number }>(
    "SELECT fingerprint, title, merged_at FROM issue_fingerprints WHERE issue_id = ? ORDER BY merged_at DESC",
    issueId,
  );
  const out: Merged[] = [];
  for (const r of rows) {
    const n = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE issue_id = ? AND fingerprint = ?", issueId, r.fingerprint))!.n;
    out.push({ fingerprint: r.fingerprint, title: r.title, mergedAt: r.merged_at, events: n });
  }
  return out;
}

async function addCounts(db: Db, from: number, into: number): Promise<void> {
  await db.run(
    `INSERT INTO issue_hours (issue_id, hour, event_count) SELECT ?, hour, event_count FROM issue_hours WHERE issue_id = ?
     ON CONFLICT (issue_id, hour) DO UPDATE SET event_count = issue_hours.event_count + excluded.event_count`,
    into,
    from,
  );
  await db.run(
    `INSERT INTO issue_releases (issue_id, release, environment, event_count, first_seen, last_seen)
     SELECT ?, release, environment, event_count, first_seen, last_seen FROM issue_releases WHERE issue_id = ?
     ON CONFLICT (issue_id, release, environment) DO UPDATE SET event_count = issue_releases.event_count + excluded.event_count,
       first_seen = CASE WHEN issue_releases.first_seen < excluded.first_seen THEN issue_releases.first_seen ELSE excluded.first_seen END,
       last_seen = CASE WHEN issue_releases.last_seen > excluded.last_seen THEN issue_releases.last_seen ELSE excluded.last_seen END`,
    into,
    from,
  );
  await db.run(
    `INSERT INTO issue_tags (issue_id, key, value, count) SELECT ?, key, value, count FROM issue_tags WHERE issue_id = ?
     ON CONFLICT (issue_id, key, value) DO UPDATE SET count = issue_tags.count + excluded.count`,
    into,
    from,
  );
  await db.run("INSERT INTO issue_users (issue_id, user_key) SELECT ?, user_key FROM issue_users WHERE issue_id = ? ON CONFLICT DO NOTHING", into, from);
}

/**
 * Merges issues into one: their events, counts, tags, comments, and history
 * move to `into`, and their fingerprints point at it, so later events join it
 * too. The merged issues are gone.
 */
export function merge(db: Db, projectId: number, into: number, issueIds: number[], by: string): Promise<number> {
  const others = [...new Set(issueIds)].filter((id) => id !== into);
  return db.tx(async (t) => {
    const target = await t.get<IssueRow>(`SELECT * FROM issues WHERE project_id = ? AND id = ? ${t.forUpdate}`, projectId, into);
    if (!target) throw new NotFound();
    let n = 0;
    for (const id of others) {
      const src = await t.get<IssueRow & { fingerprint: string }>(`SELECT * FROM issues WHERE project_id = ? AND id = ? ${t.forUpdate}`, projectId, id);
      if (!src) throw new NotFound();
      const now = Date.now();
      // Events from before fingerprints were kept take the issue's own.
      await t.run("UPDATE events SET fingerprint = ? WHERE issue_id = ? AND fingerprint = ''", src.fingerprint, id);
      await t.run(
        "INSERT INTO issue_fingerprints (project_id, fingerprint, issue_id, title, merged_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id, fingerprint) DO UPDATE SET issue_id = excluded.issue_id",
        projectId,
        src.fingerprint,
        into,
        src.title,
        now,
      );
      await t.run("UPDATE issue_fingerprints SET issue_id = ? WHERE issue_id = ?", into, id);
      // Links to the merged issue lead to the one it went into, as do links to issues merged into it before.
      await t.run("UPDATE issue_redirects SET to_id = ? WHERE to_id = ?", into, id);
      await t.run("INSERT INTO issue_redirects (from_id, to_id) VALUES (?, ?) ON CONFLICT (from_id) DO UPDATE SET to_id = excluded.to_id", id, into);
      await addCounts(t, id, into);
      for (const table of ["events", "comments", "activity"]) await t.run(`UPDATE ${table} SET issue_id = ? WHERE issue_id = ?`, into, id);
      await t.run(
        `UPDATE issues SET count = count + ?, first_seen = CASE WHEN first_seen < ? THEN first_seen ELSE ? END,
           last_seen = CASE WHEN last_seen > ? THEN last_seen ELSE ? END WHERE id = ?`,
        src.count,
        src.first_seen,
        src.first_seen,
        src.last_seen,
        src.last_seen,
        into,
      );
      await t.run("DELETE FROM issues WHERE id = ?", id);
      await addActivity(t, into, now, "merged", `Merged "${src.title}" into this issue`, { actor: by });
      n++;
    }
    await t.run("UPDATE issues SET stored_count = (SELECT COUNT(*) FROM events WHERE issue_id = ?) WHERE id = ?", into, into);
    return n;
  });
}

/**
 * Splits a merged fingerprint back out into an issue of its own: its stored
 * events move there, and their counts move with them. Counts of events whose
 * payloads were sampled away cannot be told apart, so they stay.
 */
export function unmerge(db: Db, projectId: number, issueId: number, fingerprint: string, by: string): Promise<number> {
  return db.tx(async (t) => {
    const alias = await t.get<{ title: string }>("SELECT title FROM issue_fingerprints WHERE project_id = ? AND fingerprint = ? AND issue_id = ?", projectId, fingerprint, issueId);
    if (!alias) throw new NotFound();
    const target = await t.get<IssueRow>(`SELECT * FROM issues WHERE id = ? ${t.forUpdate}`, issueId);
    const moved = await t.all<{ id: number; received_at: number; release: string; environment: string; payload: string }>(
      "SELECT id, received_at, release, environment, payload FROM events WHERE issue_id = ? AND fingerprint = ? ORDER BY id",
      issueId,
      fingerprint,
    );
    const now = Date.now();
    const first = moved[0]?.received_at ?? now;
    const last = moved[moved.length - 1]?.received_at ?? now;
    const sample = moved[0] ? summarize(JSON.parse(moved[0].payload) as SentryEvent) : null;
    const created = await t.get<{ id: number }>(
      `INSERT INTO issues (project_id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      projectId,
      fingerprint,
      alias.title,
      sample?.culprit ?? "",
      target?.level ?? "error",
      target?.platform ?? "",
      first,
      last,
      moved.length,
    );
    const id = created!.id;
    await t.run("DELETE FROM issue_fingerprints WHERE project_id = ? AND fingerprint = ?", projectId, fingerprint);
    for (const e of moved) {
      const hour = Math.floor(e.received_at / HOUR) * HOUR;
      await t.run("UPDATE issue_hours SET event_count = event_count - 1 WHERE issue_id = ? AND hour = ?", issueId, hour);
      await t.run("INSERT INTO issue_hours (issue_id, hour, event_count) VALUES (?, ?, 1) ON CONFLICT (issue_id, hour) DO UPDATE SET event_count = issue_hours.event_count + 1", id, hour);
      await t.run("UPDATE issue_releases SET event_count = event_count - 1 WHERE issue_id = ? AND release = ? AND environment = ?", issueId, e.release, e.environment);
      await t.run(
        `INSERT INTO issue_releases (issue_id, release, environment, event_count, first_seen, last_seen) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (issue_id, release, environment) DO UPDATE SET event_count = issue_releases.event_count + 1,
           last_seen = CASE WHEN issue_releases.last_seen > excluded.last_seen THEN issue_releases.last_seen ELSE excluded.last_seen END`,
        id,
        e.release,
        e.environment,
        e.received_at,
        e.received_at,
      );
      for (const [key, value] of tagsOf(JSON.parse(e.payload) as SentryEvent)) {
        await t.run("UPDATE issue_tags SET count = count - 1 WHERE issue_id = ? AND key = ? AND value = ?", issueId, key, value);
        await t.run("INSERT INTO issue_tags (issue_id, key, value, count) VALUES (?, ?, ?, 1) ON CONFLICT (issue_id, key, value) DO UPDATE SET count = issue_tags.count + 1", id, key, value);
      }
    }
    for (const table of ["issue_hours", "issue_releases", "issue_tags"]) await t.run(`DELETE FROM ${table} WHERE issue_id = ? AND ${table === "issue_tags" ? "count" : "event_count"} <= 0`, issueId);
    await t.run("UPDATE events SET issue_id = ? WHERE issue_id = ? AND fingerprint = ?", id, issueId, fingerprint);
    await t.run(
      "UPDATE issues SET count = CASE WHEN count > ? THEN count - ? ELSE 0 END, stored_count = (SELECT COUNT(*) FROM events WHERE issue_id = ?) WHERE id = ?",
      moved.length,
      moved.length,
      issueId,
      issueId,
    );
    await t.run("UPDATE issues SET stored_count = ?, last_stored = ? WHERE id = ?", moved.length, last, id);
    await addActivity(t, issueId, now, "unmerged", `Split "${alias.title}" back out into its own issue`, { actor: by });
    await addActivity(t, id, now, "unmerged", "Split out of a merged issue", { actor: by });
    return id;
  });
}

/** Merge (members): { into, issues }. Unmerge (members): { fingerprint }. */
export function mergeRoutes(db: Db, access: Access): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const withRole = projectRoute(db, access);

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

  return app;
}
