import type { Db } from "./db.js";

// A person who has signed in, one row per email (lowercase). Filled from the
// ID token at every sign-in. Only claims are kept, never the tokens: Burning
// does not call anything on the person's behalf.
export interface UserRecord {
  email: string;
  username: string; // preferred_username, or the part of the email before @
  name: string; // the name claim
  displayName: string; // set by the person; empty means the username
  lang: string; // the interface language they chose; "" for not yet
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
  tokenExpires: number; // the ID token's exp, Unix seconds
  firstLogin: number;
  lastLogin: number;
}

export const MAX_DISPLAY_NAME = 80;

/** The interface languages a person can choose. */
export const LANGS = ["en", "zh", "zh-TW", "ja", "ko", "es", "fr", "de", "pt-BR"] as const;

export async function setLang(db: Db, email: string, lang: string): Promise<void> {
  await db.run("UPDATE users SET lang = ? WHERE email = ?", lang, email.toLowerCase());
}

export const displayOf = (u: { displayName: string; username: string; email: string }): string =>
  u.displayName || u.username || u.email;

/** preferred_username, or the email's local part. */
export function usernameFrom(claims: Record<string, unknown>, email: string): string {
  const pref = claims.preferred_username;
  if (typeof pref === "string" && pref.trim()) return pref.trim();
  return email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
}

type Row = {
  email: string;
  username: string;
  name: string;
  display_name: string;
  lang: string;
  issuer: string;
  subject: string;
  claims: string;
  token_expires: number;
  first_login: number;
  last_login: number;
};

const toRecord = (r: Row): UserRecord => ({
  email: r.email,
  username: r.username,
  name: r.name,
  displayName: r.display_name,
  lang: r.lang ?? "",
  issuer: r.issuer,
  subject: r.subject,
  claims: JSON.parse(r.claims || "{}") as Record<string, unknown>,
  tokenExpires: r.token_expires,
  firstLogin: r.first_login,
  lastLogin: r.last_login,
});

/** Saves what the ID token said. A display name the person chose stays. */
export async function recordLogin(db: Db, u: { email: string; issuer: string; claims: Record<string, unknown> }, now = Date.now()): Promise<void> {
  const email = u.email.toLowerCase();
  const c = u.claims;
  await db.run(
    `INSERT INTO users (email, username, name, issuer, subject, claims, token_expires, first_login, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET
       username = excluded.username, name = excluded.name, issuer = excluded.issuer, subject = excluded.subject,
       claims = excluded.claims, token_expires = excluded.token_expires, last_login = excluded.last_login`,
    email,
    usernameFrom(c, email),
    typeof c.name === "string" ? c.name : "",
    u.issuer,
    typeof c.sub === "string" ? c.sub : "",
    JSON.stringify(c),
    typeof c.exp === "number" ? c.exp : 0,
    now,
    now,
  );
}

export async function getUser(db: Db, email: string): Promise<UserRecord | null> {
  const r = await db.get<Row>("SELECT * FROM users WHERE email = ?", email.toLowerCase());
  return r ? toRecord(r) : null;
}

export async function setDisplayName(db: Db, email: string, displayName: string): Promise<void> {
  await db.run("UPDATE users SET display_name = ? WHERE email = ?", displayName.trim(), email.toLowerCase());
}

export interface Person {
  email: string;
  username: string;
  displayName: string;
}

/** How to show each email. Someone who never signed in shows as their email. */
export async function people(db: Db, emails: Iterable<string>): Promise<Map<string, Person>> {
  const wanted = [...new Set([...emails].filter(Boolean).map((e) => e.toLowerCase()))];
  const out = new Map<string, Person>();
  if (wanted.length === 0) return out;
  const rows = await db.all<{ email: string; username: string; display_name: string }>(
    `SELECT email, username, display_name FROM users WHERE email IN (${wanted.map(() => "?").join(",")})`,
    ...wanted,
  );
  const found = new Map(rows.map((r) => [r.email, r]));
  for (const email of wanted) {
    const r = found.get(email);
    const username = r?.username || usernameFrom({}, email);
    out.set(email, { email, username, displayName: r ? displayOf({ displayName: r.display_name, username, email }) : email });
  }
  return out;
}

export async function allPeople(db: Db): Promise<Person[]> {
  const rows = await db.all<{ email: string; username: string; display_name: string }>("SELECT email, username, display_name FROM users");
  return rows.map((r) => ({
    email: r.email,
    username: r.username,
    displayName: displayOf({ displayName: r.display_name, username: r.username, email: r.email }),
  }));
}
