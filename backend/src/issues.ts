import { addActivity } from "./activity.js";
import { tx, type Db } from "./db.js";
import { summarize, type SentryEvent } from "./event.js";
import { muteBroken, MuteFor, MuteNextRelease, type Mute, type MuteOption } from "./triage.js";

const HOUR = 3_600_000;

export type Status = "open" | "resolved" | "muted";

export type Issue = {
  id: number;
  projectId: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  status: Status;
  resolvedAt: number;
  mute: Mute;
  reopenReason: string; // why it last fired again
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
};

/** Why an event alerts: a new issue, a resolved one firing again, or one firing after a mute. */
export type AlertKind = "new" | "fired_again" | "unmuted";

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
  status: string;
  resolved_at: number;
  mute_kind: string;
  mute_until: number;
  muted_at: number;
  notify_next: number;
  reopen_reason: string;
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
  status: r.status as Status,
  resolvedAt: r.resolved_at,
  mute: { kind: r.mute_kind, until: r.mute_until, mutedAt: r.muted_at },
  reopenReason: r.reopen_reason,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  eventCount: r.count,
});

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

export interface Recorded {
  eventId: string;
  issueId: number;
  title: string;
  alert: AlertKind | null; // why this event alerts, if it does
  reason: string; // for fired_again and unmuted
}

/**
 * Stores an event and adds it to its issue, creating the issue on first
 * sight. A resolved issue fires again, a "next release" mute ends on an event
 * from a new release, and the first event after a mute ended alerts.
 */
export function recordEvent(db: Db, projectId: number, event: SentryEvent, now = Date.now()): Recorded {
  const s = summarize(event);
  const release = str(event.release);
  const environment = str(event.environment);
  const where = { release, environment };
  return tx(db, () => {
    if (release) db.prepare("INSERT OR IGNORE INTO releases (project_id, version, first_seen) VALUES (?, ?, ?)").run(projectId, release, now);
    const res: Recorded = { eventId: s.eventId, issueId: 0, title: s.title, alert: null, reason: "" };
    const found = db.prepare("SELECT * FROM issues WHERE project_id = ? AND fingerprint = ?").get(projectId, s.fingerprint) as IssueRow | undefined;
    if (!found) {
      const row = db
        .prepare(
          `INSERT INTO issues (project_id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id, title`,
        )
        .get(projectId, s.fingerprint, s.title, s.culprit, s.level, s.platform, now, now) as { id: number; title: string };
      res.issueId = row.id;
      res.alert = "new";
      addActivity(db, row.id, now, "created", "First seen", where);
    } else {
      res.issueId = found.id;
      res.title = found.title;
      triageEvent(db, projectId, toIssue(found), found.notify_next === 1, release, environment, now, res);
      db.prepare("UPDATE issues SET level = ?, last_seen = MAX(last_seen, ?), count = count + 1 WHERE id = ?").run(s.level, now, found.id);
    }
    db.prepare(
      `INSERT INTO events (project_id, issue_id, event_id, received_at, release, environment, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(projectId, res.issueId, s.eventId, now, release.slice(0, 200), environment.slice(0, 200), JSON.stringify({ ...event, event_id: s.eventId }));
    return res;
  });
}

function triageEvent(db: Db, projectId: number, issue: Issue, notifyNext: boolean, release: string, environment: string, now: number, res: Recorded): void {
  if (issue.status === "resolved") {
    res.alert = "fired_again";
    res.reason = `A new event arrived${releaseSuffix(release, environment)} after it was resolved`;
    reopen(db, issue.id, now, "fired", "Fired again: a new event arrived after it was resolved", res.reason, { release, environment });
    return;
  }
  if (issue.status === "muted") {
    const seen = db.prepare("SELECT first_seen FROM releases WHERE project_id = ? AND version = ?").get(projectId, release) as
      | { first_seen: number }
      | undefined;
    const reason = muteBroken(issue.mute, release, seen?.first_seen ?? 0);
    if (reason) {
      res.alert = "unmuted";
      res.reason = reason;
      reopen(db, issue.id, now, "unmuted", `Unmuted: ${reason}`, reason);
    }
    return;
  }
  if (notifyNext) {
    res.alert = "unmuted";
    res.reason = "The first event since the mute ended";
    db.prepare("UPDATE issues SET notify_next = 0, reopen_reason = ? WHERE id = ?").run(res.reason, issue.id);
  }
}

function releaseSuffix(release: string, environment: string): string {
  let s = release ? ` in release ${release}` : "";
  if (environment) s += ` (${environment})`;
  return s;
}

// ---- Triage ----

export class NotFound extends Error {}

const OPEN_SET = "status = 'open', resolved_at = 0, mute_kind = '', mute_until = 0, muted_at = 0, notify_next = 0";

/** Puts an issue back to open, clearing any resolve or mute state. */
function reopen(db: Db, issueId: number, now: number, kind: string, text: string, reason: string, extra: Parameters<typeof addActivity>[5] = {}): void {
  db.prepare(`UPDATE issues SET ${OPEN_SET}, reopen_reason = ? WHERE id = ?`).run(reason, issueId);
  addActivity(db, issueId, now, kind, text, extra);
}

/** Runs fn on one issue of a project, in a transaction, with its current status. */
function update(db: Db, projectId: number, issueId: number, fn: (status: Status, now: number) => void): void {
  tx(db, () => {
    const row = db.prepare("SELECT status FROM issues WHERE project_id = ? AND id = ?").get(projectId, issueId) as { status: Status } | undefined;
    if (!row) throw new NotFound();
    fn(row.status, Date.now());
  });
}

/** Marks everything that fired so far as handled. The next event fires the issue again. */
export function resolve(db: Db, projectId: number, issueId: number, actor = ""): void {
  update(db, projectId, issueId, (_, now) => {
    db.prepare(`UPDATE issues SET ${OPEN_SET}, status = 'resolved', resolved_at = ?, reopen_reason = '' WHERE id = ?`).run(now, issueId);
    addActivity(db, issueId, now, "resolved", "Resolved. The next event fires it again", { actor });
  });
}

/** Keeps counting events without alerting, for the chosen time. */
export function mute(db: Db, projectId: number, issueId: number, opt: MuteOption, actor = ""): void {
  update(db, projectId, issueId, (_, now) => {
    let until = 0;
    let text = "Muted until unmuted";
    if (opt.kind === MuteFor) {
      until = now + opt.durationMs;
      text = `Muted for ${opt.label}`;
    } else if (opt.kind === MuteNextRelease) {
      text = "Muted until a new release reports it";
    }
    db.prepare(
      `UPDATE issues SET status = 'muted', resolved_at = 0, mute_kind = ?, mute_until = ?, muted_at = ?, notify_next = 0, reopen_reason = '' WHERE id = ?`,
    ).run(opt.kind, until, now, issueId);
    addActivity(db, issueId, now, "muted", text, { actor });
  });
}

/** Puts a resolved or muted issue back to open. After an unmute the next event alerts, as it would have without the mute. */
export function reopenByHand(db: Db, projectId: number, issueId: number, actor = ""): void {
  update(db, projectId, issueId, (status, now) => {
    reopen(db, issueId, now, "reopened", status === "muted" ? "Unmuted" : "Reopened", "", { actor });
    if (status === "muted") db.prepare("UPDATE issues SET notify_next = 1 WHERE id = ?").run(issueId);
  });
}

/** Ends every timed mute that ran out. The issue goes back to open and its next event alerts. */
export function expireMutes(db: Db, now = Date.now()): number {
  return tx(db, () => {
    const ended = db
      .prepare(`UPDATE issues SET ${OPEN_SET}, notify_next = 1, reopen_reason = '' WHERE status = 'muted' AND mute_kind = ? AND mute_until <= ? RETURNING id`)
      .all(MuteFor, now) as { id: number }[];
    for (const { id } of ended) addActivity(db, id, now, "unmuted", "Mute ended");
    return ended.length;
  });
}

/** The newest release a project has seen, for the mute menu's hint. */
export function latestRelease(db: Db, projectId: number): string {
  const r = db.prepare("SELECT version FROM releases WHERE project_id = ? ORDER BY first_seen DESC LIMIT 1").get(projectId) as { version: string } | undefined;
  return r?.version ?? "";
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
