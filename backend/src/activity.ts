import type { Db } from "./db.js";

export interface Activity {
  at: number;
  kind: string; // created, resolved, muted, reopened, fired, unmuted, notified
  text: string;
  release: string;
  environment: string;
  actor: string; // email of who did it; empty for what Burning did on its own
}

export type ActivityExtra = { release?: string; environment?: string; actor?: string };

export function addActivity(db: Db, issueId: number, at: number, kind: string, text: string, extra: ActivityExtra = {}): void {
  db.prepare("INSERT INTO activity (issue_id, at, kind, text, release, environment, actor) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    issueId,
    at,
    kind,
    text,
    extra.release ?? "",
    extra.environment ?? "",
    extra.actor ?? "",
  );
}

/** The issue's history, newest first. */
export function listActivity(db: Db, issueId: number, limit = 100): Activity[] {
  return db
    .prepare("SELECT at, kind, text, release, environment, actor FROM activity WHERE issue_id = ? ORDER BY at DESC, id DESC LIMIT ?")
    .all(issueId, limit) as unknown as Activity[];
}
