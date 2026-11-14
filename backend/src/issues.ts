import type { Db } from "./db.js";
import { summarize, type SentryEvent } from "./event.js";

export type Issue = {
  id: number;
  projectId: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
};

export type StoredEvent = {
  id: number;
  eventId: string;
  receivedAt: string;
  payload: SentryEvent;
};

type IssueRow = {
  id: number;
  project_id: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  first_seen: string;
  last_seen: string;
  count: number;
};

const toIssue = (r: IssueRow): Issue => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  culprit: r.culprit,
  level: r.level,
  platform: r.platform,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  count: r.count,
});

/** Stores an event and adds it to its issue, creating the issue on first sight. */
export function recordEvent(db: Db, projectId: number, event: SentryEvent): { eventId: string; issueId: number } {
  const s = summarize(event);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const issue = db
      .prepare(
        `INSERT INTO issues (project_id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (project_id, fingerprint) DO UPDATE SET
           title = excluded.title, culprit = excluded.culprit, level = excluded.level,
           platform = excluded.platform, last_seen = excluded.last_seen, count = count + 1
         RETURNING id`,
      )
      .get(projectId, s.fingerprint, s.title, s.culprit, s.level, s.platform, now, now) as { id: number };
    db.prepare(
      "INSERT INTO events (project_id, issue_id, event_id, received_at, payload) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, issue.id, s.eventId, now, JSON.stringify({ ...event, event_id: s.eventId }));
    db.exec("COMMIT");
    return { eventId: s.eventId, issueId: issue.id };
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

export function latestEvents(db: Db, issueId: number, limit = 10): StoredEvent[] {
  const rows = db
    .prepare("SELECT id, event_id, received_at, payload FROM events WHERE issue_id = ? ORDER BY id DESC LIMIT ?")
    .all(issueId, limit) as { id: number; event_id: string; received_at: string; payload: string }[];
  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    receivedAt: r.received_at,
    payload: JSON.parse(r.payload) as SentryEvent,
  }));
}
