import { createHash } from "node:crypto";
import { addActivity, type ActivityExtra } from "./activity.js";
import type { Db } from "./db.js";
import { summarize, type SentryEvent } from "./event.js";
import { spikeKey } from "./notify/routing.js";
import { getRouting } from "./notify/store.js";
import { applyGrouping, ownerFor } from "./rules.js";
import { scrubEvent } from "./scrub.js";
import { getConfig, type ProjectConfig } from "./settings.js";
import { muteBroken, MuteFor, MuteNextRelease, type Mute, type MuteOption } from "./triage.js";

const HOUR = 3_600_000;

/**
 * Payloads kept per issue: the first `firstN` always, then at most one per
 * `everyMs`, so a burst keeps counting without filling the disk; past `max`
 * the oldest go. An event that alerts is always kept. The counts (events,
 * hours, releases) include every event either way.
 */
export const STORE = { firstN: 50, everyMs: 60_000, max: 500 };

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
  assignee: string; // email of who handles it, "" for no one
  externalUrl: string; // a GitHub issue made from it, "" for none
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
};

/** Why an event alerts: a new issue, a resolved one firing again, one firing after a mute, or a spike. */
export type AlertKind = "new" | "fired_again" | "unmuted" | "spike";

export type StoredEvent = {
  id: number;
  eventId: string;
  receivedAt: number;
  release: string;
  environment: string;
  payload: SentryEvent;
};

export type EventRow = Omit<StoredEvent, "payload">;

export type IssueRow = {
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
  stored_count: number;
  last_stored: number;
  assignee: string;
  external_url: string;
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
  assignee: r.assignee ?? "",
  externalUrl: r.external_url ?? "",
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
  reason: string; // for fired_again, unmuted, and spike
  spike?: { events: number; usual: number; fresh: string[] }; // for spike: the numbers, and the route conditions newly met
}

/**
 * Stores an event and adds it to its issue, creating the issue on first
 * sight. A resolved issue fires again, a "next release" mute ends on an event
 * from a new release, and the first event after a mute ended alerts. Several
 * servers may record at once: the unique fingerprint decides which one creates
 * a new issue, and the issue's row is locked while an event changes it.
 */
export async function recordEvent(db: Db, projectId: number, input: SentryEvent, now = Date.now(), config?: ProjectConfig): Promise<Recorded> {
  const cfg = config ?? (await getConfig(db, projectId));
  // Secrets out first, so nothing below (or the stored payload) sees them;
  // then the project's grouping rules may set the fingerprint.
  const event = applyGrouping(scrubEvent(input, cfg.scrub), cfg.grouping);
  const s = summarize(event);
  const release = str(event.release);
  const environment = str(event.environment);
  const where = { release, environment };
  return db.tx(async (t) => {
    if (release) await t.run("INSERT INTO releases (project_id, version, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", projectId, release, now);
    const res: Recorded = { eventId: s.eventId, issueId: 0, title: s.title, alert: null, reason: "" };
    // A fingerprint merged into another issue belongs to that issue.
    const alias = await t.get<{ issue_id: number }>("SELECT issue_id FROM issue_fingerprints WHERE project_id = ? AND fingerprint = ?", projectId, s.fingerprint);
    const existing = () =>
      alias
        ? t.get<IssueRow>(`SELECT * FROM issues WHERE id = ? ${t.forUpdate}`, alias.issue_id)
        : t.get<IssueRow>(`SELECT * FROM issues WHERE project_id = ? AND fingerprint = ? ${t.forUpdate}`, projectId, s.fingerprint);
    // Most events belong to a known issue: look first, and insert only when there is none.
    let found = await existing();
    const created = found
      ? undefined
      : await t.get<{ id: number; title: string }>(
          `INSERT INTO issues (project_id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT (project_id, fingerprint) DO NOTHING RETURNING id, title`,
          projectId,
          s.fingerprint,
          s.title,
          s.culprit,
          s.level,
          s.platform,
          now,
          now,
        );
    let stored = { count: 0, last: 0 };
    let status = "open";
    if (created) {
      res.issueId = created.id;
      res.alert = "new";
      await addActivity(t, created.id, now, "created", "First seen", where);
      // The project's ownership rules pick who handles a new issue.
      const owned = ownerFor(event, cfg.owners);
      if (owned) {
        await t.run("UPDATE issues SET assignee = ? WHERE id = ?", owned.owner, created.id);
        await addActivity(t, created.id, now, "assigned", `Assigned to ${owned.owner} by ownership rule ${owned.rule}`);
      }
    } else {
      // Another server may have created it a moment ago.
      found ??= await existing();
      if (!found) throw new Error(`issue for fingerprint ${s.fingerprint} vanished`);
      res.issueId = found.id;
      res.title = found.title;
      stored = { count: Number(found.stored_count), last: Number(found.last_stored) };
      await triageEvent(t, projectId, toIssue(found), Number(found.notify_next) === 1, release, environment, now, res);
      status = res.alert ? "open" : found.status;
      await t.run(
        "UPDATE issues SET level = ?, last_seen = CASE WHEN last_seen > ? THEN last_seen ELSE ? END, count = count + 1 WHERE id = ?",
        s.level,
        now,
        now,
        found.id,
      );
    }
    const hour = Math.floor(now / HOUR) * HOUR;
    const inHour = (await t.get<{ event_count: number }>(
      `INSERT INTO issue_hours (issue_id, hour, event_count) VALUES (?, ?, 1)
       ON CONFLICT (issue_id, hour) DO UPDATE SET event_count = issue_hours.event_count + 1 RETURNING event_count`,
      res.issueId,
      hour,
    ))!.event_count;
    await countTags(t, res.issueId, event);
    const user = userKey(projectId, event);
    if (user) await t.run("INSERT INTO issue_users (issue_id, user_key) VALUES (?, ?) ON CONFLICT DO NOTHING", res.issueId, user);
    if (!res.alert && status === "open") await spikeCheck(t, projectId, res, inHour, hour, now, where);
    await t.run(
      `INSERT INTO issue_releases (issue_id, release, environment, event_count, first_seen, last_seen) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (issue_id, release, environment) DO UPDATE SET event_count = issue_releases.event_count + 1,
         last_seen = CASE WHEN issue_releases.last_seen > excluded.last_seen THEN issue_releases.last_seen ELSE excluded.last_seen END`,
      res.issueId,
      release,
      environment,
      now,
      now,
    );
    if (res.alert || stored.count < STORE.firstN || now - stored.last >= STORE.everyMs) {
      await t.run(
        "INSERT INTO events (project_id, issue_id, event_id, received_at, release, environment, payload, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        projectId,
        res.issueId,
        s.eventId,
        now,
        release,
        environment,
        JSON.stringify({ ...event, event_id: s.eventId }),
        s.fingerprint,
      );
      // Past the cap, drop the oldest payloads. The counts keep the full number.
      await t.run(
        "DELETE FROM events WHERE issue_id = ? AND id NOT IN (SELECT id FROM events WHERE issue_id = ? ORDER BY received_at DESC, id DESC LIMIT ?)",
        res.issueId,
        res.issueId,
        STORE.max,
      );
      await t.run("UPDATE issues SET stored_count = (SELECT COUNT(*) FROM events WHERE issue_id = ?), last_stored = ? WHERE id = ?", res.issueId, now, res.issueId);
    }
    return res;
  });
}

// ---- Tags, users, and spikes ----

const MAX_TAG_KEYS = 25;

/** The tags an event is counted under: where it ran, the SDK's tags, and the browser and OS from its contexts. */
export function tagsOf(ev: SentryEvent): [string, string][] {
  const out = new Map<string, string>();
  const put = (k: string, v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return;
    const val = String(v).slice(0, 200);
    if (val && !out.has(k) && out.size < MAX_TAG_KEYS) out.set(k.slice(0, 64), val);
  };
  put("environment", ev.environment);
  put("release", ev.release);
  put("level", ev.level); // only when the SDK sent one
  put("server", ev.server_name);
  const ctx = (ev.contexts ?? {}) as Record<string, { name?: string; version?: string } | undefined>;
  if (ctx.browser?.name) put("browser", [ctx.browser.name, ctx.browser.version].filter(Boolean).join(" "));
  if (ctx.os?.name) put("os", [ctx.os.name, ctx.os.version].filter(Boolean).join(" "));
  const tags = ev.tags as Record<string, unknown> | [string, unknown][] | undefined;
  for (const [k, v] of Array.isArray(tags) ? tags : Object.entries(tags ?? {})) put(String(k), v);
  return [...out];
}

async function countTags(db: Db, issueId: number, ev: SentryEvent): Promise<void> {
  for (const [key, value] of tagsOf(ev)) {
    await db.run(
      "INSERT INTO issue_tags (issue_id, key, value, count) VALUES (?, ?, ?, 1) ON CONFLICT (issue_id, key, value) DO UPDATE SET count = issue_tags.count + 1",
      issueId,
      key,
      value,
    );
  }
}

/** A hash standing for the user the event reached: their id, email, username, or address. */
export function userKey(projectId: number, ev: SentryEvent): string {
  const u = (ev.user ?? {}) as Record<string, unknown>;
  const id = ["id", "email", "username", "ip_address"].map((k) => u[k]).find((v) => typeof v === "string" || typeof v === "number");
  return id === undefined ? "" : createHash("sha256").update(`${projectId}:${String(id)}`).digest("hex").slice(0, 24);
}

const SPIKE_EVERY_MS = 6 * HOUR;

/**
 * A spike alert: this hour's events meet a spike condition of the project's
 * routes, at least `events`, and `factor` times the hourly average of the 24
 * hours before. Each condition alerts an issue at most every six hours; the
 * routes whose condition is newly met are the ones it goes to.
 */
async function spikeCheck(db: Db, projectId: number, res: Recorded, inHour: number, hour: number, now: number, where: ActivityExtra): Promise<void> {
  const conditions = [...new Map((await getRouting(db, projectId)).flatMap((r) => (r.spike ? [[spikeKey(r.spike), r.spike] as const] : []))).values()];
  if (!conditions.length || inHour < Math.min(...conditions.map((c) => c.events))) return;
  const before = (await db.get<{ n: number }>(
    "SELECT COALESCE(SUM(event_count), 0) AS n FROM issue_hours WHERE issue_id = ? AND hour >= ? AND hour < ?",
    res.issueId,
    hour - 24 * HOUR,
    hour,
  ))!.n;
  const usual = Number(before) / 24;
  const met = conditions.filter((c) => inHour >= c.events && inHour >= c.factor * usual).map(spikeKey);
  if (!met.length) return;
  const last = new Map(
    (await db.all<{ cond: string; at: number }>("SELECT cond, at FROM issue_spikes WHERE issue_id = ?", res.issueId)).map((r) => [r.cond, Number(r.at)]),
  );
  const fresh = met.filter((k) => now - (last.get(k) ?? 0) >= SPIKE_EVERY_MS);
  if (!fresh.length) return;
  for (const k of fresh) {
    await db.run("INSERT INTO issue_spikes (issue_id, cond, at) VALUES (?, ?, ?) ON CONFLICT (issue_id, cond) DO UPDATE SET at = excluded.at", res.issueId, k, now);
  }
  res.alert = "spike";
  res.spike = { events: inHour, usual, fresh };
  const was = usual === 0 ? "none in the day before" : `about ${usual < 1 ? usual.toFixed(1) : Math.round(usual)} an hour before`;
  res.reason = `${inHour} events in the last hour, ${was}`;
  await addActivity(db, res.issueId, now, "spike", `Spiking: ${res.reason}`, where);
}

async function triageEvent(db: Db, projectId: number, issue: Issue, notifyNext: boolean, release: string, environment: string, now: number, res: Recorded): Promise<void> {
  if (issue.status === "resolved") {
    res.alert = "fired_again";
    res.reason = `A new event arrived${releaseSuffix(release, environment)} after it was resolved`;
    await reopen(db, issue.id, now, "fired", "Fired again: a new event arrived after it was resolved", res.reason, { release, environment });
    return;
  }
  if (issue.status === "muted") {
    const seen = await db.get<{ first_seen: number }>("SELECT first_seen FROM releases WHERE project_id = ? AND version = ?", projectId, release);
    const reason = muteBroken(issue.mute, release, seen?.first_seen ?? 0);
    if (reason) {
      res.alert = "unmuted";
      res.reason = reason;
      await reopen(db, issue.id, now, "unmuted", `Unmuted: ${reason}`, reason);
    }
    return;
  }
  if (notifyNext) {
    res.alert = "unmuted";
    res.reason = "The first event since the mute ended";
    await db.run("UPDATE issues SET notify_next = 0, reopen_reason = ? WHERE id = ?", res.reason, issue.id);
  }
}

function releaseSuffix(release: string, environment: string): string {
  let s = release ? ` in release ${release}` : "";
  if (environment) s += ` (${environment})`;
  return s;
}

// ---- Triage ----

export class NotFound extends Error {}

// Clears resolve and mute state. Each column is set once: Postgres refuses two
// assignments to one column in an UPDATE.
const CLEAR_SET = "resolved_at = 0, mute_kind = '', mute_until = 0, muted_at = 0";
const OPEN_SET = `status = 'open', ${CLEAR_SET}, notify_next = 0`;

/** Puts an issue back to open, clearing any resolve or mute state. */
async function reopen(db: Db, issueId: number, now: number, kind: string, text: string, reason: string, extra: ActivityExtra = {}): Promise<void> {
  await db.run(`UPDATE issues SET ${OPEN_SET}, reopen_reason = ? WHERE id = ?`, reason, issueId);
  await addActivity(db, issueId, now, kind, text, extra);
}

/** Runs fn on one issue of a project, with its row locked, so a triage and an incoming event do not interleave. */
function update(db: Db, projectId: number, issueId: number, fn: (t: Db, status: Status, now: number) => Promise<void>): Promise<void> {
  return db.tx(async (t) => {
    const row = await t.get<{ status: Status }>(`SELECT status FROM issues WHERE project_id = ? AND id = ? ${t.forUpdate}`, projectId, issueId);
    if (!row) throw new NotFound();
    await fn(t, row.status, Date.now());
  });
}

/** Marks everything that fired so far as handled. The next event fires the issue again. */
export function resolve(db: Db, projectId: number, issueId: number, actor = ""): Promise<void> {
  return update(db, projectId, issueId, async (t, _, now) => {
    await t.run("UPDATE issues SET status = 'resolved', resolved_at = ?, mute_kind = '', mute_until = 0, muted_at = 0, notify_next = 0, reopen_reason = '' WHERE id = ?", now, issueId);
    await addActivity(t, issueId, now, "resolved", "Resolved. The next event fires it again", { actor });
  });
}

/** Keeps counting events without alerting, for the chosen time. */
export function mute(db: Db, projectId: number, issueId: number, opt: MuteOption, actor = ""): Promise<void> {
  return update(db, projectId, issueId, async (t, _, now) => {
    let until = 0;
    let text = "Muted until unmuted";
    if (opt.kind === MuteFor) {
      until = now + opt.durationMs;
      text = `Muted for ${opt.label}`;
    } else if (opt.kind === MuteNextRelease) {
      text = "Muted until a new release reports it";
    }
    await t.run(
      "UPDATE issues SET status = 'muted', resolved_at = 0, mute_kind = ?, mute_until = ?, muted_at = ?, notify_next = 0, reopen_reason = '' WHERE id = ?",
      opt.kind,
      until,
      now,
      issueId,
    );
    await addActivity(t, issueId, now, "muted", text, { actor });
  });
}

/** Puts a resolved or muted issue back to open. After an unmute the next event alerts, as it would have without the mute. */
export function reopenByHand(db: Db, projectId: number, issueId: number, actor = ""): Promise<void> {
  return update(db, projectId, issueId, async (t, status, now) => {
    await reopen(t, issueId, now, "reopened", status === "muted" ? "Unmuted" : "Reopened", "", { actor });
    if (status === "muted") await t.run("UPDATE issues SET notify_next = 1 WHERE id = ?", issueId);
  });
}

/**
 * Ends every timed mute that ran out. The issue goes back to open and its
 * next event alerts. The update claims the rows it changes, so with several
 * servers on the same timer each issue is reopened once.
 */
export function expireMutes(db: Db, now = Date.now()): Promise<number> {
  return db.tx(async (t) => {
    const ended = await t.all<{ id: number }>(
      `UPDATE issues SET status = 'open', ${CLEAR_SET}, notify_next = 1, reopen_reason = '' WHERE status = 'muted' AND mute_kind = ? AND mute_until <= ? RETURNING id`,
      MuteFor,
      now,
    );
    for (const { id } of ended) await addActivity(t, id, now, "unmuted", "Mute ended");
    return ended.length;
  });
}

/** The newest release a project has seen, for the mute menu's hint. */
export async function latestRelease(db: Db, projectId: number): Promise<string> {
  const r = await db.get<{ version: string }>("SELECT version FROM releases WHERE project_id = ? ORDER BY first_seen DESC LIMIT 1", projectId);
  return r?.version ?? "";
}

// ---- Reading ----

export async function listIssues(db: Db, projectId: number): Promise<Issue[]> {
  return (await db.all<IssueRow>("SELECT * FROM issues WHERE project_id = ? ORDER BY last_seen DESC LIMIT 200", projectId)).map(toIssue);
}

export async function getIssue(db: Db, projectId: number, issueId: number): Promise<Issue | undefined> {
  if (!Number.isSafeInteger(issueId)) return undefined;
  const row = await db.get<IssueRow>("SELECT * FROM issues WHERE project_id = ? AND id = ?", projectId, issueId);
  return row && toIssue(row);
}

/**
 * Hourly event counts for the last 24 hours, oldest first, per issue. The
 * last cell is the current (partial) hour.
 */
export async function hoursByIssue(db: Db, issueIds: number[], now = Date.now()): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>(issueIds.map((id) => [id, new Array<number>(24).fill(0)]));
  if (issueIds.length === 0) return out;
  const current = Math.floor(now / HOUR);
  const rows = await db.all<{ issue_id: number; hour: number; event_count: number }>(
    `SELECT issue_id, hour, event_count FROM issue_hours WHERE hour >= ? AND issue_id IN (${issueIds.map(() => "?").join(",")})`,
    (current - 23) * HOUR,
    ...issueIds,
  );
  for (const r of rows) {
    const i = 23 - (current - Math.floor(r.hour / HOUR));
    const cells = out.get(r.issue_id);
    if (cells && i >= 0 && i < 24) cells[i] = r.event_count;
  }
  return out;
}

type EventRowDb = { id: number; event_id: string; received_at: number; release: string; environment: string };
const toRow = (r: EventRowDb): EventRow => ({ id: r.id, eventId: r.event_id, receivedAt: r.received_at, release: r.release, environment: r.environment });

/** A page of an issue's stored events, newest first, older than `before` when given. */
export async function eventPage(db: Db, issueId: number, before?: number, limit = 10): Promise<{ events: EventRow[]; more: boolean }> {
  const rows = await db.all<EventRowDb>(
    "SELECT id, event_id, received_at, release, environment FROM events WHERE issue_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
    issueId,
    before ?? Number.MAX_SAFE_INTEGER,
    limit + 1,
  );
  return { events: rows.slice(0, limit).map(toRow), more: rows.length > limit };
}

export async function storedEventCount(db: Db, issueId: number): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE issue_id = ?", issueId))!.n;
}

/** One stored event of an issue: `eventRowId`, or the latest. */
export async function getEvent(db: Db, issueId: number, eventRowId?: number): Promise<StoredEvent | undefined> {
  const row = eventRowId
    ? await db.get<EventRowDb & { payload: string }>("SELECT * FROM events WHERE issue_id = ? AND id = ?", issueId, eventRowId)
    : await db.get<EventRowDb & { payload: string }>("SELECT * FROM events WHERE issue_id = ? ORDER BY id DESC LIMIT 1", issueId);
  return row && { ...toRow(row), payload: JSON.parse(row.payload) as SentryEvent };
}

/** Events per release and environment, most recent first. Every event counts, kept or not. */
export async function releasesOf(db: Db, issueId: number) {
  const rows = await db.all<{ release: string; environment: string; event_count: number; last_seen: number }>(
    "SELECT release, environment, event_count, last_seen FROM issue_releases WHERE issue_id = ? ORDER BY last_seen DESC",
    issueId,
  );
  return rows
    .filter((r) => r.release || r.environment)
    .map((r) => ({ release: r.release, environment: r.environment, eventCount: r.event_count, lastSeen: r.last_seen }));
}

/** Deletes payloads older than the retention period, and hourly counts as old. Issues and their totals are kept. */
export function prune(db: Db, retentionMs: number, now = Date.now()): Promise<number> {
  const cutoff = now - retentionMs;
  return db.tx(async (t) => {
    const n = (await t.run("DELETE FROM events WHERE received_at < ?", cutoff)).changes;
    if (n > 0) await t.run("UPDATE issues SET stored_count = (SELECT COUNT(*) FROM events e WHERE e.issue_id = issues.id)");
    await t.run("DELETE FROM issue_hours WHERE hour < ?", cutoff);
    return n;
  });
}
