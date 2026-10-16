import { listGrants } from "../access.js";
import { tx, type Db } from "../db.js";
import type { Receiver, Route } from "./routing.js";

// ---- Project routing ----

export function getRouting(db: Db, projectId: number): Route[] {
  const rows = db
    .prepare("SELECT name, matchers, receivers, sink, cont FROM project_routes WHERE project_id = ? ORDER BY position")
    .all(projectId) as { name: string; matchers: string; receivers: string; sink: number; cont: number }[];
  return rows.map((r) => ({
    name: r.name,
    matchers: JSON.parse(r.matchers) as Route["matchers"],
    receivers: JSON.parse(r.receivers) as Receiver[],
    sink: r.sink === 1,
    continue: r.cont === 1,
  }));
}

export function saveRouting(db: Db, projectId: number, routes: Route[]): void {
  tx(db, () => {
    db.prepare("DELETE FROM project_routes WHERE project_id = ?").run(projectId);
    const insert = db.prepare(
      "INSERT INTO project_routes (project_id, position, name, matchers, receivers, sink, cont) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    routes.forEach((r, i) =>
      insert.run(projectId, i, r.name, JSON.stringify(r.matchers), JSON.stringify(r.sink ? [] : r.receivers), r.sink ? 1 : 0, r.continue ? 1 : 0),
    );
  });
}

/**
 * The people the default route sends to: users granted member or admin
 * directly. Groups are left out, or one person in three groups would get
 * three copies; viewers are left out as onlookers.
 */
export function defaultRecipients(db: Db, projectId: number): string[] {
  return listGrants(db, projectId)
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

export function getPersonalRoutes(db: Db, email: string): { routes: Route[]; initial: boolean } {
  const r = db.prepare("SELECT notify_routes FROM users WHERE email = ?").get(email.toLowerCase()) as
    | { notify_routes: string | null }
    | undefined;
  if (!r || r.notify_routes === null) return { routes: initialRoutes(email), initial: true };
  return { routes: JSON.parse(r.notify_routes) as Route[], initial: false };
}

/** Needs a users row, so only people who have signed in have their own routing. */
export function savePersonalRoutes(db: Db, email: string, routes: Route[]): boolean {
  const r = db.prepare("UPDATE users SET notify_routes = ? WHERE email = ?").run(JSON.stringify(routes), email.toLowerCase());
  return Number(r.changes) > 0;
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

export function enqueue(db: Db, projectId: number, issueId: number, list: Delivery[], m: Message, now = Date.now()): void {
  const insert = db.prepare(
    `INSERT INTO notifications (project_id, issue_id, kind, target, subject, text, json, next_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of list) insert.run(projectId, issueId, d.kind, d.target, m.subject, m.text, m.json, now, now);
}

export const MAX_ATTEMPTS = 5;

/** Messages that are due, marked as being sent. One server, so no locking. */
export function claim(db: Db, now = Date.now(), limit = 20): OutboxRow[] {
  return tx(db, () => {
    const rows = db
      .prepare(
        `SELECT id, kind, target, subject, text, json, attempts FROM notifications
          WHERE status = 'pending' AND next_at <= ? ORDER BY id LIMIT ?`,
      )
      .all(now, limit) as unknown as OutboxRow[];
    const mark = db.prepare("UPDATE notifications SET status = 'sending' WHERE id = ?");
    for (const r of rows) mark.run(r.id);
    return rows;
  });
}

/** Records one attempt. A failure is retried later, a minute more each time, until MAX_ATTEMPTS. */
export function settle(db: Db, id: number, attempts: number, error: string, now = Date.now()): void {
  if (!error) {
    db.prepare("UPDATE notifications SET status = 'sent', attempts = ?, last_error = '', sent_at = ? WHERE id = ?").run(attempts, now, id);
    return;
  }
  db.prepare("UPDATE notifications SET status = ?, attempts = ?, last_error = ?, next_at = ? WHERE id = ?").run(
    attempts >= MAX_ATTEMPTS ? "failed" : "pending",
    attempts,
    error.slice(0, 500),
    now + attempts * 60_000,
    id,
  );
}

/** Rows left as 'sending' by a server that stopped go back to the queue. */
export function requeueStuck(db: Db): void {
  db.prepare("UPDATE notifications SET status = 'pending' WHERE status = 'sending'").run();
}
