import type { Db } from "./db.js";

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

async function withHistory(db: Db, rows: Row[]): Promise<Comment[]> {
  const versions = new Map<number, CommentVersion[]>();
  const edited = rows.filter((r) => r.edited_at > 0).map((r) => r.id);
  if (edited.length) {
    const hist = await db.all<{ comment_id: number; body: string; replaced_at: number }>(
      `SELECT comment_id, body, replaced_at FROM comment_edits WHERE comment_id IN (${edited.map(() => "?").join(",")}) ORDER BY replaced_at, id`,
      ...edited,
    );
    for (const h of hist) versions.set(h.comment_id, [...(versions.get(h.comment_id) ?? []), { body: h.body, replacedAt: h.replaced_at }]);
  }
  return rows.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at, editedAt: r.edited_at, history: versions.get(r.id) ?? [] }));
}

/** An issue's comments, oldest first, so they read as a conversation. */
export async function listComments(db: Db, issueId: number): Promise<Comment[]> {
  return withHistory(db, await db.all<Row>("SELECT id, author, body, created_at, edited_at FROM comments WHERE issue_id = ? ORDER BY created_at, id", issueId));
}

export async function getComment(db: Db, issueId: number, id: number): Promise<Comment | null> {
  if (!Number.isSafeInteger(id)) return null;
  const r = await db.get<Row>("SELECT id, author, body, created_at, edited_at FROM comments WHERE issue_id = ? AND id = ?", issueId, id);
  return r ? (await withHistory(db, [r]))[0]! : null;
}

export async function addComment(db: Db, issueId: number, author: string, body: string, now = Date.now()): Promise<number> {
  const r = await db.get<{ id: number }>("INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?) RETURNING id", issueId, author, body, now);
  return r!.id;
}

/** Replaces the text and keeps the old one in the history. An edit that changes nothing is not recorded. */
export function editComment(db: Db, id: number, body: string, now = Date.now()): Promise<void> {
  return db.tx(async (t) => {
    const old = await t.get<{ body: string }>(`SELECT body FROM comments WHERE id = ? ${t.forUpdate}`, id);
    if (!old || old.body === body) return;
    await t.run("INSERT INTO comment_edits (comment_id, body, replaced_at) VALUES (?, ?, ?)", id, old.body, now);
    await t.run("UPDATE comments SET body = ?, edited_at = ? WHERE id = ?", body, now, id);
  });
}

export async function deleteComment(db: Db, id: number): Promise<void> {
  await db.run("DELETE FROM comments WHERE id = ?", id);
}
