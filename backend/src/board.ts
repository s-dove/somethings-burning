import type { Db } from "./db.js";
import { hoursByIssue, toIssue, type Issue } from "./issues.js";
import { MUTE_OPTIONS } from "./triage.js";

const HOUR = 3_600_000;

export type BoardIssue = Issue & { projectName: string; hours: number[] };
export type Sort = "hot" | "latest" | "count";
export type StatusFilter = "open" | "resolved" | "muted" | "all";

// hot weighs each of the last 24 hours, the newest the most, so an issue
// that is busy now ranks above one that was busy this morning.
const heat = (hours: number[]) => hours.reduce((sum, n, i) => sum + n * Math.pow(1.25, i), 0);

/** The board: every project for the sidebar, and the issues of one project (or all). */
export function board(db: Db, opts: { projectId?: number; status?: StatusFilter; sort: Sort; q: string; scope?: number[] }, now = Date.now()) {
  const status = opts.status ?? "open";
  const since = now - 24 * HOUR;
  // scope is the projects the person can see; undefined means all.
  const visible = (id: number) => !opts.scope || opts.scope.includes(id);
  const all = (
    db
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'open') AS open_count,
                (SELECT COUNT(*) FROM events e JOIN issues i ON i.id = e.issue_id
                  WHERE e.project_id = p.id AND e.received_at >= ? AND i.status != 'resolved') AS day
           FROM projects p ORDER BY p.name COLLATE NOCASE`,
      )
      .all(since) as { id: number; name: string; created_at: number; open_count: number; day: number }[]
  ).map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, openCount: p.open_count, unresolvedDay: p.day }));
  const projects = all.filter((p) => visible(p.id));
  const ids = projects.map((p) => p.id);

  const where: string[] = [`i.project_id IN (${ids.map(() => "?").join(",") || "NULL"})`];
  const args: (string | number)[] = [...ids];
  if (opts.projectId) {
    where.push("i.project_id = ?");
    args.push(opts.projectId);
  }
  if (status !== "all") {
    where.push("i.status = ?");
    args.push(status);
  }
  if (opts.q) {
    where.push("(i.title LIKE ? ESCAPE '\\' OR i.culprit LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  const order = opts.sort === "count" ? "i.count DESC" : "i.last_seen DESC";
  const rows = db
    .prepare(
      `SELECT i.*, p.name AS project_name FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`,
    )
    .all(...args) as (Parameters<typeof toIssue>[0] & { project_name: string })[];
  const hours = hoursByIssue(db, rows.map((r) => r.id), now);
  const issues: BoardIssue[] = rows.map((r) => ({
    ...toIssue(r),
    projectName: r.project_name,
    hours: hours.get(r.id) ?? new Array<number>(24).fill(0),
  }));
  if (opts.sort === "hot") issues.sort((a, b) => heat(b.hours) - heat(a.hours) || b.lastSeen - a.lastSeen);

  const inScope = opts.projectId ? [opts.projectId] : ids;
  const scope = `AND project_id IN (${inScope.map(() => "?").join(",") || "NULL"})`;
  const scopeArgs = inScope;
  const count = (sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const events = {
    day: count(`SELECT COUNT(*) AS n FROM events WHERE received_at >= ? ${scope}`, since, ...scopeArgs),
    hour: count(`SELECT COUNT(*) AS n FROM events WHERE received_at >= ? ${scope}`, now - HOUR, ...scopeArgs),
  };
  const burning = count(
    `SELECT COUNT(*) AS n FROM issues WHERE status = 'open' AND last_seen >= ? ${scope}`,
    now - HOUR,
    ...scopeArgs,
  );
  const counts: Record<StatusFilter, number> = { open: 0, resolved: 0, muted: 0, all: 0 };
  for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM issues WHERE 1 = 1 ${scope} GROUP BY status`).all(...scopeArgs) as { status: StatusFilter; n: number }[]) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }

  let project = null;
  if (opts.projectId) {
    const p = projects.find((x) => x.id === opts.projectId);
    if (p) {
      const pulse = db
        .prepare(
          `SELECT MAX(received_at) AS last,
                  (SELECT release FROM events WHERE project_id = ? AND release != '' ORDER BY id DESC LIMIT 1) AS release
             FROM events WHERE project_id = ?`,
        )
        .get(p.id, p.id) as { last: number | null; release: string | null };
      const releaseSeen = pulse.release
        ? (
            db
              .prepare("SELECT MIN(received_at) AS t FROM events WHERE project_id = ? AND release = ?")
              .get(p.id, pulse.release) as { t: number }
          ).t
        : 0;
      project = {
        id: p.id,
        name: p.name,
        pulse: { lastEvent: pulse.last ?? 0, release: pulse.release ?? "", releaseSeen },
      };
    }
  }

  return {
    project,
    projects,
    issues,
    filter: { status, sort: opts.sort, query: opts.q },
    counts,
    burning,
    events,
    openTotal: projects.reduce((n, p) => n + p.openCount, 0),
    muteOptions: MUTE_OPTIONS.map(({ value, label }) => ({ value, label })),
  };
}
