import type { Db, Param } from "./db.js";
import { hoursByIssue, toIssue, type Issue, type IssueRow } from "./issues.js";
import { MUTE_OPTIONS } from "./triage.js";

const HOUR = 3_600_000;

export type BoardIssue = Issue & { projectName: string; hours: number[] };
export type Sort = "hot" | "latest" | "count";
export type StatusFilter = "open" | "resolved" | "muted" | "all";

// hot weighs each of the last 24 hours, the newest the most, so an issue
// that is busy now ranks above one that was busy this morning.
const heat = (hours: number[]) => hours.reduce((sum, n, i) => sum + n * Math.pow(1.25, i), 0);

const inList = (n: number) => (n ? Array.from({ length: n }, () => "?").join(",") : "NULL");

/** The board: every project for the sidebar, and the issues of one project (or all). */
export async function board(
  db: Db,
  opts: { projectId?: number; status?: StatusFilter; sort: Sort; q: string; scope?: number[]; assignee?: string },
  now = Date.now(),
) {
  const status = opts.status ?? "open";
  // The last 24 hourly cells, this one included, as on the heat strips.
  const since = (Math.floor(now / HOUR) - 23) * HOUR;
  // scope is the projects the person can see; undefined means all.
  const visible = (id: number) => !opts.scope || opts.scope.includes(id);
  const all = (
    await db.all<{ id: number; name: string; created_at: number; open_count: number; day: number }>(
      `SELECT p.id, p.name, p.created_at,
              (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'open') AS open_count,
              (SELECT COALESCE(SUM(h.event_count), 0) FROM issue_hours h JOIN issues i ON i.id = h.issue_id
                WHERE i.project_id = p.id AND h.hour >= ? AND i.status != 'resolved') AS day
         FROM projects p ORDER BY lower(p.name)`,
      since,
    )
  ).map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, openCount: p.open_count, unresolvedDay: p.day }));
  const projects = all.filter((p) => visible(p.id));
  const ids = projects.map((p) => p.id);

  const where: string[] = [`i.project_id IN (${inList(ids.length)})`];
  const args: Param[] = [...ids];
  if (opts.projectId) {
    where.push("i.project_id = ?");
    args.push(opts.projectId);
  }
  if (status !== "all") {
    where.push("i.status = ?");
    args.push(status);
  }
  if (opts.assignee !== undefined) {
    where.push("i.assignee = ?");
    args.push(opts.assignee);
  }
  if (opts.q) {
    where.push("(lower(i.title) LIKE ? ESCAPE '\\' OR lower(i.culprit) LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  const order = opts.sort === "count" ? "i.count DESC" : "i.last_seen DESC";
  const rows = await db.all<IssueRow & { project_name: string }>(
    `SELECT i.*, p.name AS project_name FROM issues i JOIN projects p ON p.id = i.project_id
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`,
    ...args,
  );
  const hours = await hoursByIssue(db, rows.map((r) => r.id), now);
  const issues: BoardIssue[] = rows.map((r) => ({ ...toIssue(r), projectName: r.project_name, hours: hours.get(r.id) ?? new Array<number>(24).fill(0) }));
  if (opts.sort === "hot") issues.sort((a, b) => heat(b.hours) - heat(a.hours) || b.lastSeen - a.lastSeen);

  const inScope = opts.projectId ? [opts.projectId] : ids;
  const scope = `IN (${inList(inScope.length)})`;
  const count = async (sql: string, ...a: Param[]) => (await db.get<{ n: number }>(sql, ...a))!.n;
  // Events of issues that are not resolved, from the hourly counts.
  const unresolved = (from: number) =>
    count(
      `SELECT COALESCE(SUM(h.event_count), 0) AS n FROM issue_hours h JOIN issues i ON i.id = h.issue_id
        WHERE h.hour >= ? AND i.status != 'resolved' AND i.project_id ${scope}`,
      from,
      ...inScope,
    );
  const events = { day: await unresolved(since), hour: await unresolved(Math.floor(now / HOUR) * HOUR) };
  const burning = await count(`SELECT COUNT(*) AS n FROM issues WHERE status = 'open' AND last_seen >= ? AND project_id ${scope}`, now - HOUR, ...inScope);
  const counts: Record<StatusFilter, number> = { open: 0, resolved: 0, muted: 0, all: 0 };
  for (const r of await db.all<{ status: StatusFilter; n: number }>(`SELECT status, COUNT(*) AS n FROM issues WHERE project_id ${scope} GROUP BY status`, ...inScope)) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }

  let project = null;
  if (opts.projectId) {
    const p = projects.find((x) => x.id === opts.projectId);
    if (p) {
      // Whether it still reports: its last event, and its newest release.
      const last = (await db.get<{ t: number | null }>("SELECT MAX(last_seen) AS t FROM issues WHERE project_id = ?", p.id))!.t;
      const rel = await db.get<{ version: string; first_seen: number }>("SELECT version, first_seen FROM releases WHERE project_id = ? ORDER BY first_seen DESC LIMIT 1", p.id);
      project = { id: p.id, name: p.name, pulse: { lastEvent: last ?? 0, release: rel?.version ?? "", releaseSeen: rel?.first_seen ?? 0 } };
    }
  }

  return {
    project,
    projects,
    issues,
    filter: { status, sort: opts.sort, query: opts.q, assignee: opts.assignee ?? null },
    counts,
    burning,
    events,
    openTotal: projects.reduce((n, p) => n + p.openCount, 0),
    muteOptions: MUTE_OPTIONS.map(({ value, label }) => ({ value, label })),
  };
}
