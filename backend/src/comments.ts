import { tx, type Db } from "./db.js";

export const MAX_COMMENT = 10_000;

/** One earlier text of a comment, and when an edit replaced it. */
export interface CommentVersion {
  body: string;
  replacedAt: number;
}

/**
 * A comment on an issue. author is the commenter's email. history holds
 * every earlier text, oldest first; editedAt is 0 for a comment never edited.
 */
export interface Comment {
  id: number;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number;
  history: CommentVersion[];
}

type Row = { id: number; author: string; body: string; created_at: number; edited_at: number };

function withHistory(db: Db, rows: Row[]): Comment[] {
  const versions = new Map<number, CommentVersion[]>();
  const edited = rows.filter((r) => r.edited_at > 0).map((r) => r.id);
  if (edited.length) {
    const hist = db
      .prepare(`SELECT comment_id, body, replaced_at FROM comment_edits WHERE comment_id IN (${edited.map(() => "?").join(",")}) ORDER BY replaced_at, id`)
      .all(...edited) as { comment_id: number; body: string; replaced_at: number }[];
    for (const h of hist) versions.set(h.comment_id, [...(versions.get(h.comment_id) ?? []), { body: h.body, replacedAt: h.replaced_at }]);
  }
  return rows.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at, editedAt: r.edited_at, history: versions.get(r.id) ?? [] }));
}

/** An issue's comments, oldest first, so they read as a conversation. */
export function listComments(db: Db, issueId: number): Comment[] {
  const rows = db
    .prepare("SELECT id, author, body, created_at, edited_at FROM comments WHERE issue_id = ? ORDER BY created_at, id")
    .all(issueId) as Row[];
  return withHistory(db, rows);
}

export function getComment(db: Db, issueId: number, id: number): Comment | null {
  if (!Number.isSafeInteger(id)) return null;
  const r = db.prepare("SELECT id, author, body, created_at, edited_at FROM comments WHERE issue_id = ? AND id = ?").get(issueId, id) as Row | undefined;
  return r ? withHistory(db, [r])[0]! : null;
}

export function addComment(db: Db, issueId: number, author: string, body: string, now = Date.now()): number {
  const r = db.prepare("INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?) RETURNING id").get(issueId, author, body, now) as { id: number };
  return r.id;
}

/** Replaces the text and keeps the old one in the history. An edit that changes nothing is not recorded. */
export function editComment(db: Db, id: number, body: string, now = Date.now()): void {
  tx(db, () => {
    const old = db.prepare("SELECT body FROM comments WHERE id = ?").get(id) as { body: string } | undefined;
    if (!old || old.body === body) return;
    db.prepare("INSERT INTO comment_edits (comment_id, body, replaced_at) VALUES (?, ?, ?)").run(id, old.body, now);
    db.prepare("UPDATE comments SET body = ?, edited_at = ? WHERE id = ?").run(body, now, id);
  });
}

export function deleteComment(db: Db, id: number): void {
  db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}
