import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db.js";

// Project API tokens, for CI: "brn_" and 40 hex characters. Only a hash is
// kept; the token is shown once, when it is made.

export interface TokenView {
  id: number;
  name: string;
  prefix: string; // the first characters, to tell tokens apart
  createdBy: string;
  createdAt: number;
  lastUsed: number;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createToken(db: Db, projectId: number, name: string, createdBy: string): Promise<{ token: string; view: TokenView }> {
  const token = `brn_${randomBytes(20).toString("hex")}`;
  const now = Date.now();
  const row = await db.get<{ id: number }>(
    "INSERT INTO api_tokens (project_id, name, token_hash, prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    projectId,
    name,
    hash(token),
    token.slice(0, 8),
    createdBy,
    now,
  );
  return { token, view: { id: row!.id, name, prefix: token.slice(0, 8), createdBy, createdAt: now, lastUsed: 0 } };
}

export async function listTokens(db: Db, projectId: number): Promise<TokenView[]> {
  const rows = await db.all<{ id: number; name: string; prefix: string; created_by: string; created_at: number; last_used: number }>(
    "SELECT id, name, prefix, created_by, created_at, last_used FROM api_tokens WHERE project_id = ? ORDER BY created_at DESC",
    projectId,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdBy: r.created_by, createdAt: r.created_at, lastUsed: r.last_used }));
}

export async function revokeToken(db: Db, projectId: number, id: number): Promise<boolean> {
  return (await db.run("DELETE FROM api_tokens WHERE project_id = ? AND id = ?", projectId, id)).changes > 0;
}

/** The project a token belongs to, or null. Marks it used. */
export async function tokenProject(db: Db, token: string): Promise<number | null> {
  if (!/^brn_[0-9a-f]{40}$/.test(token)) return null;
  const row = await db.get<{ id: number; project_id: number }>("SELECT id, project_id FROM api_tokens WHERE token_hash = ?", hash(token));
  if (!row) return null;
  await db.run("UPDATE api_tokens SET last_used = ? WHERE id = ?", Date.now(), row.id);
  return row.project_id;
}
