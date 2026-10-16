import type { Db } from "./db.js";
import { hoursByIssue, toIssue, type Issue } from "./issues.js";

const HOUR = 3_600_000;

export type BoardIssue = Issue & { projectName: string; hours: number[] };
export type Sort = "hot" | "latest" | "count";

// hot weighs each of the last 24 hours, the newest the most, so an issue
// that is busy now ranks above one that was busy this morning.
const heat = (hours: number[]) => hours.reduce((sum, n, i) => sum + n * Math.pow(1.25, i), 0);

/** The board: every project for the sidebar, and the issues of one project (or all). */
export function board(db: Db, opts: { projectId?: number; sort: Sort; q: string }, now = Date.now()) {
  const since = now - 24 * HOUR;
  const projects = (
    db
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id) AS open_count,
                (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.received_at >= ?) AS day
           FROM projects p ORDER BY p.name COLLATE NOCASE`,
      )
      .all(since) as { id: number; name: string; created_at: number; open_count: number; day: number }[]
  ).map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, openCount: p.open_count, unresolvedDay: p.day }));

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.projectId) {
    where.push("i.project_id = ?");
    args.push(opts.projectId);
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
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 200`,
    )
    .all(...args) as (Parameters<typeof toIssue>[0] & { project_name: string })[];
  const hours = hoursByIssue(db, rows.map((r) => r.id), now);
  const issues: BoardIssue[] = rows.map((r) => ({
    ...toIssue(r),
    projectName: r.project_name,
    hours: hours.get(r.id) ?? new Array<number>(24).fill(0),
  }));
  if (opts.sort === "hot") issues.sort((a, b) => heat(b.hours) - heat(a.hours) || b.lastSeen - a.lastSeen);

  const scope = opts.projectId ? "AND project_id = ?" : "";
  const scopeArgs = opts.projectId ? [opts.projectId] : [];
  const count = (sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const events = {
    day: count(`SELECT COUNT(*) AS n FROM events WHERE received_at >= ? ${scope}`, since, ...scopeArgs),
    hour: count(`SELECT COUNT(*) AS n FROM events WHERE received_at >= ? ${scope}`, now - HOUR, ...scopeArgs),
  };
  const burning = count(
    `SELECT COUNT(*) AS n FROM issues WHERE last_seen >= ? ${scope}`,
    now - HOUR,
    ...scopeArgs,
  );
  const open = count(`SELECT COUNT(*) AS n FROM issues WHERE 1 = 1 ${scope}`, ...scopeArgs);

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
    filter: { sort: opts.sort, query: opts.q },
    counts: { open },
    burning,
    events,
    openTotal: projects.reduce((n, p) => n + p.openCount, 0),
  };
}
