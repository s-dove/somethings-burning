import type { Db } from "./db.js";
import { summarize, type SentryEvent } from "./event.js";

const HOUR = 3_600_000;

export type Issue = {
  id: number;
  projectId: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
};

export type StoredEvent = {
  id: number;
  eventId: string;
  receivedAt: number;
  release: string;
  environment: string;
  payload: SentryEvent;
};

export type EventRow = Omit<StoredEvent, "payload">;

type IssueRow = {
  id: number;
  project_id: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  first_seen: number;
  last_seen: number;
  count: number;
};

export const toIssue = (r: IssueRow): Issue => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  culprit: r.culprit,
  level: r.level,
  platform: r.platform,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  eventCount: r.count,
});

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

/** Stores an event and adds it to its issue, creating the issue on first sight. */
export function recordEvent(
  db: Db,
  projectId: number,
  event: SentryEvent,
  now = Date.now(),
): { eventId: string; issueId: number; isNew: boolean; title: string } {
  const s = summarize(event);
  db.exec("BEGIN");
  try {
    const issue = db
      .prepare(
        `INSERT INTO issues (project_id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (project_id, fingerprint) DO UPDATE SET
           level = excluded.level, last_seen = excluded.last_seen, count = count + 1
         RETURNING id, count, title`,
      )
      .get(projectId, s.fingerprint, s.title, s.culprit, s.level, s.platform, now, now) as { id: number; count: number; title: string };
    db.prepare(
      `INSERT INTO events (project_id, issue_id, event_id, received_at, release, environment, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      issue.id,
      s.eventId,
      now,
      str(event.release),
      str(event.environment),
      JSON.stringify({ ...event, event_id: s.eventId }),
    );
    db.exec("COMMIT");
    return { eventId: s.eventId, issueId: issue.id, isNew: issue.count === 1, title: issue.title };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listIssues(db: Db, projectId: number): Issue[] {
  const rows = db
    .prepare("SELECT * FROM issues WHERE project_id = ? ORDER BY last_seen DESC LIMIT 200")
    .all(projectId) as IssueRow[];
  return rows.map(toIssue);
}

export function getIssue(db: Db, projectId: number, issueId: number): Issue | undefined {
  const row = db.prepare("SELECT * FROM issues WHERE project_id = ? AND id = ?").get(projectId, issueId) as
    | IssueRow
    | undefined;
  return row && toIssue(row);
}

/**
 * Hourly event counts for the last 24 hours, oldest first, per issue. The
 * last cell is the current (partial) hour.
 */
export function hoursByIssue(db: Db, issueIds: number[], now = Date.now()): Map<number, number[]> {
  const out = new Map<number, number[]>(issueIds.map((id) => [id, new Array<number>(24).fill(0)]));
  if (issueIds.length === 0) return out;
  const current = Math.floor(now / HOUR);
  const rows = db
    .prepare(
      `SELECT issue_id, received_at / ${HOUR} AS h, COUNT(*) AS n FROM events
        WHERE received_at >= ? AND issue_id IN (${issueIds.map(() => "?").join(",")})
        GROUP BY issue_id, h`,
    )
    .all((current - 23) * HOUR, ...issueIds) as { issue_id: number; h: number; n: number }[];
  for (const r of rows) {
    const i = 23 - (current - Math.floor(r.h));
    const cells = out.get(r.issue_id);
    if (cells && i >= 0 && i < 24) cells[i] = r.n;
  }
  return out;
}

type EventRowDb = { id: number; event_id: string; received_at: number; release: string; environment: string };
const toRow = (r: EventRowDb): EventRow => ({
  id: r.id,
  eventId: r.event_id,
  receivedAt: r.received_at,
  release: r.release,
  environment: r.environment,
});

/** A page of an issue's stored events, newest first, older than `before` when given. */
export function eventPage(db: Db, issueId: number, before?: number, limit = 10): { events: EventRow[]; more: boolean } {
  const rows = db
    .prepare(
      `SELECT id, event_id, received_at, release, environment FROM events
        WHERE issue_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
    )
    .all(issueId, before ?? Number.MAX_SAFE_INTEGER, limit + 1) as EventRowDb[];
  return { events: rows.slice(0, limit).map(toRow), more: rows.length > limit };
}

export function storedEventCount(db: Db, issueId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM events WHERE issue_id = ?").get(issueId) as { n: number }).n;
}

/** One stored event of an issue: `eventRowId`, or the latest. */
export function getEvent(db: Db, issueId: number, eventRowId?: number): StoredEvent | undefined {
  const row = (
    eventRowId
      ? db.prepare("SELECT * FROM events WHERE issue_id = ? AND id = ?").get(issueId, eventRowId)
      : db.prepare("SELECT * FROM events WHERE issue_id = ? ORDER BY id DESC LIMIT 1").get(issueId)
  ) as (EventRowDb & { payload: string }) | undefined;
  return row && { ...toRow(row), payload: JSON.parse(row.payload) as SentryEvent };
}

/** Events per release and environment, busiest release first. */
export function releasesOf(db: Db, issueId: number) {
  const rows = db
    .prepare(
      `SELECT release, environment, COUNT(*) AS n, MAX(received_at) AS last FROM events
        WHERE issue_id = ? GROUP BY release, environment ORDER BY MAX(received_at) DESC`,
    )
    .all(issueId) as { release: string; environment: string; n: number; last: number }[];
  return rows
    .filter((r) => r.release || r.environment)
    .map((r) => ({ release: r.release, environment: r.environment, eventCount: r.n, lastSeen: r.last }));
}
