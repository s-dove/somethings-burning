import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { AppEnv } from "./api.js";
import type { User } from "./auth.js";
import type { Db } from "./db.js";
import { body, notFound } from "./project-routes.js";
import { displayOf, getUser } from "./users.js";

// Personal access tokens: "brp_" and 40 hex characters. A token acts as the
// person who made it, with their roles, for scripts and AI agents (MCP).
// Only a hash is kept; the token is shown once, when it is made.
//
// - read: only reads (GET), and the read tools over MCP.
// - write: whatever the person may do, except making or listing tokens.
//
// Groups come from the person's last sign-in, so a group they leave still
// counts until they sign in again.

export type Scope = "read" | "write";
export const SCOPES: Scope[] = ["read", "write"];

/** Days a new token lasts; 0 is never. */
export const EXPIRY_DAYS = [30, 90, 180, 365, 0];
const MAX_TOKENS = 50;
const DAY = 86_400_000;

export interface PersonalTokenView {
  id: number;
  name: string;
  prefix: string; // the first characters, to tell tokens apart
  scope: Scope;
  createdAt: number;
  expiresAt: number; // 0 for never
  lastUsed: number;
}

export const TOKEN_RE = /^brp_[0-9a-f]{40}$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = { id: number; name: string; prefix: string; scope: string; created_at: number; expires_at: number; last_used: number };
const toView = (r: Row): PersonalTokenView => ({
  id: Number(r.id),
  name: r.name,
  prefix: r.prefix,
  scope: r.scope === "write" ? "write" : "read",
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  lastUsed: Number(r.last_used),
});

export async function createPersonalToken(
  db: Db,
  email: string,
  opts: { name: string; scope: Scope; days: number },
  now = Date.now(),
): Promise<{ token: string; view: PersonalTokenView }> {
  const token = `brp_${randomBytes(20).toString("hex")}`;
  const expiresAt = opts.days ? now + opts.days * DAY : 0;
  const row = await db.get<{ id: number }>(
    "INSERT INTO personal_tokens (email, name, token_hash, prefix, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    email.toLowerCase(),
    opts.name,
    hash(token),
    token.slice(0, 8),
    opts.scope,
    now,
    expiresAt,
  );
  return { token, view: { id: Number(row!.id), name: opts.name, prefix: token.slice(0, 8), scope: opts.scope, createdAt: now, expiresAt, lastUsed: 0 } };
}

export async function listPersonalTokens(db: Db, email: string): Promise<PersonalTokenView[]> {
  const rows = await db.all<Row>(
    "SELECT id, name, prefix, scope, created_at, expires_at, last_used FROM personal_tokens WHERE email = ? ORDER BY created_at DESC, id DESC",
    email.toLowerCase(),
  );
  return rows.map(toView);
}

export async function revokePersonalToken(db: Db, email: string, id: number): Promise<boolean> {
  return (await db.run("DELETE FROM personal_tokens WHERE email = ? AND id = ?", email.toLowerCase(), id)).changes > 0;
}

/**
 * The person a token acts as, and what it may do; null when the token is
 * unknown, expired, or its person never signed in. Marks it used (at most
 * once a minute, so a busy agent does not write on every call).
 */
export async function personalTokenUser(db: Db, token: string, now = Date.now()): Promise<{ user: User; id: number; scope: Scope } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await db.get<{ id: number; email: string; scope: string; expires_at: number; last_used: number }>(
    "SELECT id, email, scope, expires_at, last_used FROM personal_tokens WHERE token_hash = ?",
    hash(token),
  );
  if (!row) return null;
  if (Number(row.expires_at) && Number(row.expires_at) <= now) return null;
  const saved = await getUser(db, row.email);
  if (!saved) return null;
  if (now - Number(row.last_used) > 60_000) await db.run("UPDATE personal_tokens SET last_used = ? WHERE id = ?", now, row.id);
  return {
    id: Number(row.id),
    scope: row.scope === "write" ? "write" : "read",
    user: { email: saved.email, name: saved.name, groups: saved.groups, username: saved.username, displayName: displayOf(saved), lang: saved.lang },
  };
}

/** The signed-in person's own tokens: list, make (shown once), and revoke. A token cannot reach these. */
export function personalTokenRoutes(db: Db): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/profile/tokens", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign-in is off, so there are no tokens" }, 404);
    return c.json({ tokens: await listPersonalTokens(db, user.email), scopes: SCOPES, expiryDays: EXPIRY_DAYS });
  });
  app.post("/profile/tokens", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign-in is off, so there are no tokens" }, 404);
    if (!(await getUser(db, user.email))) return c.json({ detail: "sign in again to make a token" }, 404);
    const b = await body<{ name?: unknown; scope?: unknown; days?: unknown }>(c);
    const name = String(b.name ?? "").trim();
    if (!name || name.length > 80) return c.json({ detail: 'name the token, like "Local agent"' }, 400);
    const scope = String(b.scope ?? "read") as Scope;
    if (!SCOPES.includes(scope)) return c.json({ detail: "access is read or write" }, 400);
    const days = Number(b.days ?? 90);
    if (!EXPIRY_DAYS.includes(days)) return c.json({ detail: `a token lasts ${EXPIRY_DAYS.filter(Boolean).join(", ")} days, or never expires` }, 400);
    if ((await listPersonalTokens(db, user.email)).length >= MAX_TOKENS) return c.json({ detail: `up to ${MAX_TOKENS} tokens; revoke one first` }, 400);
    return c.json(await createPersonalToken(db, user.email, { name, scope, days }), 201);
  });
  app.delete("/profile/tokens/:token{[0-9]+}", async (c) => {
    const user = c.get("user");
    if (!user) return notFound(c);
    return (await revokePersonalToken(db, user.email, Number(c.req.param("token")))) ? c.body(null, 204) : notFound(c);
  });
  return app;
}
