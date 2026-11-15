import { listGrants } from "../access.js";
import type { Db } from "../db.js";
import type { Receiver, Route } from "./routing.js";

// ---- Project routing ----

export async function getRouting(db: Db, projectId: number): Promise<Route[]> {
  const rows = await db.all<{ name: string; matchers: string; receivers: string; sink: number; cont: number }>(
    "SELECT name, matchers, receivers, sink, cont FROM project_routes WHERE project_id = ? ORDER BY position",
    projectId,
  );
  return rows.map((r) => ({
    name: r.name,
    matchers: JSON.parse(r.matchers) as Route["matchers"],
    receivers: JSON.parse(r.receivers) as Receiver[],
    sink: Number(r.sink) === 1,
    continue: Number(r.cont) === 1,
  }));
}

export function saveRouting(db: Db, projectId: number, routes: Route[]): Promise<void> {
  return db.tx(async (t) => {
    await t.run("DELETE FROM project_routes WHERE project_id = ?", projectId);
    for (const [i, r] of routes.entries()) {
      await t.run(
        "INSERT INTO project_routes (project_id, position, name, matchers, receivers, sink, cont) VALUES (?, ?, ?, ?, ?, ?, ?)",
        projectId,
        i,
        r.name,
        JSON.stringify(r.matchers),
        JSON.stringify(r.sink ? [] : r.receivers),
        r.sink ? 1 : 0,
        r.continue ? 1 : 0,
      );
    }
  });
}

/**
 * The people the default route sends to: users granted member or admin
 * directly. Groups are left out, or one person in three groups would get
 * three copies; viewers are left out as onlookers.
 */
export async function defaultRecipients(db: Db, projectId: number): Promise<string[]> {
  return (await listGrants(db, projectId))
    .filter((g) => g.kind === "user" && (g.role === "member" || g.role === "admin"))
    .map((g) => g.subject.toLowerCase());
}

// ---- Personal routing ----

/**
 * Someone who never saved their own routing (or never signed in) starts with
 * one route: every alert that reaches them, by email. Deleting it turns
 * everything off; an empty table is saved as such.
 */
export const initialRoutes = (email: string): Route[] => [
  {
    name: "Everything by email",
    matchers: [{ field: "project", op: "=~", value: ".*" }],
    sink: false,
    receivers: [{ kind: "email", target: email.toLowerCase() }],
    continue: false,
  },
];

export async function getPersonalRoutes(db: Db, email: string): Promise<{ routes: Route[]; initial: boolean }> {
  const r = await db.get<{ notify_routes: string | null }>("SELECT notify_routes FROM users WHERE email = ?", email.toLowerCase());
  if (!r || r.notify_routes === null) return { routes: initialRoutes(email), initial: true };
  return { routes: JSON.parse(r.notify_routes) as Route[], initial: false };
}

/** Needs a users row, so only people who have signed in have their own routing. */
export async function savePersonalRoutes(db: Db, email: string, routes: Route[]): Promise<boolean> {
  return (await db.run("UPDATE users SET notify_routes = ? WHERE email = ?", JSON.stringify(routes), email.toLowerCase())).changes > 0;
}

// ---- Outbox ----

export type DeliveryKind = "email" | "mattermost_dm" | "mattermost_channel" | "webhook";
export interface Delivery {
  kind: DeliveryKind;
  target: string;
}
export interface Message {
  subject: string;
  text: string;
  json: string; // body for webhooks
}
export interface OutboxRow extends Delivery, Message {
  id: number;
  attempts: number;
}

export async function enqueue(db: Db, projectId: number, issueId: number, list: Delivery[], m: Message, now = Date.now()): Promise<void> {
  for (const d of list) {
    await db.run(
      `INSERT INTO notifications (project_id, issue_id, kind, target, subject, text, json, next_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      issueId,
      d.kind,
      d.target,
      m.subject,
      m.text,
      m.json,
      now,
      now,
    );
  }
}

export const MAX_ATTEMPTS = 5;
// How long a server may take to send one message before another takes over.
export const SEND_LEASE_MS = 2 * 60_000;

/**
 * Takes up to limit messages that are due, or whose sender went away
 * mid-send, and marks them as being sent until the lease ends. With several
 * servers, each message goes to one of them: rows another is claiming are
 * skipped.
 */
export function claim(db: Db, now = Date.now(), limit = 20): Promise<OutboxRow[]> {
  return db.tx(async (t) => {
    const ids = await t.all<{ id: number }>(
      `SELECT id FROM notifications
        WHERE (status = 'pending' AND next_at <= ?) OR (status = 'sending' AND locked_until < ?)
        ORDER BY id LIMIT ? ${t.skipLocked}`,
      now,
      now,
      limit,
    );
    if (!ids.length) return [];
    const list = ids.map((r) => r.id);
    return t.all<OutboxRow>(
      `UPDATE notifications SET status = 'sending', locked_until = ? WHERE id IN (${list.map(() => "?").join(",")})
       RETURNING id, kind, target, subject, text, json, attempts`,
      now + SEND_LEASE_MS,
      ...list,
    );
  });
}

/** Records one attempt. A failure is retried later, a minute more each time, until MAX_ATTEMPTS. */
export async function settle(db: Db, id: number, attempts: number, error: string, now = Date.now()): Promise<void> {
  if (!error) {
    await db.run("UPDATE notifications SET status = 'sent', attempts = ?, last_error = '', sent_at = ?, locked_until = 0 WHERE id = ?", attempts, now, id);
    return;
  }
  await db.run(
    "UPDATE notifications SET status = ?, attempts = ?, last_error = ?, next_at = ?, locked_until = 0 WHERE id = ?",
    attempts >= MAX_ATTEMPTS ? "failed" : "pending",
    attempts,
    error.slice(0, 500),
    now + attempts * 60_000,
    id,
  );
}
