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

export async function addActivity(db: Db, issueId: number, at: number, kind: string, text: string, extra: ActivityExtra = {}): Promise<void> {
  await db.run(
    "INSERT INTO activity (issue_id, at, kind, text, release, environment, actor) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
export function listActivity(db: Db, issueId: number, limit = 100): Promise<Activity[]> {
  return db.all<Activity>("SELECT at, kind, text, release, environment, actor FROM activity WHERE issue_id = ? ORDER BY at DESC, id DESC LIMIT ?", issueId, limit);
}
