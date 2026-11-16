import { Hono, type Context } from "hono";
import type { Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Config } from "./env.js";
import { publicBase } from "./url.js";
import { getUser } from "./users.js";
import { groupsFromClaims } from "./auth.js";
import type { Db } from "./db.js";
import type { Senders } from "./notify/deliver.js";

const DAY = 86_400_000;

/**
 * A person's daily summary: for each project they can see, the issues first
 * seen and firing again in the last day, and the busiest ones. Empty when
 * nothing happened.
 */
export async function digestFor(db: Db, access: Access, email: string, groups: string[], baseURL: string, now = Date.now()): Promise<string> {
  const projects = await db.all<{ id: number; name: string }>("SELECT id, name FROM projects ORDER BY lower(name)");
  const roles = await access.roles(projects.map((p) => p.id), { email, groups, name: "", username: "", displayName: "" });
  const since = now - DAY;
  const parts: string[] = [];
  for (const p of projects.filter((x) => roles.has(x.id))) {
    const created = await db.all<{ id: number; title: string }>(
      "SELECT DISTINCT i.id, i.title FROM activity a JOIN issues i ON i.id = a.issue_id WHERE i.project_id = ? AND a.kind = 'created' AND a.at >= ? ORDER BY i.id",
      p.id,
      since,
    );
    const fired = await db.all<{ id: number; title: string }>(
      "SELECT DISTINCT i.id, i.title FROM activity a JOIN issues i ON i.id = a.issue_id WHERE i.project_id = ? AND a.kind = 'fired' AND a.at >= ? ORDER BY i.id",
      p.id,
      since,
    );
    const busiest = await db.all<{ id: number; title: string; n: number }>(
      `SELECT i.id, i.title, SUM(h.event_count) AS n FROM issue_hours h JOIN issues i ON i.id = h.issue_id
        WHERE i.project_id = ? AND h.hour >= ? AND i.status = 'open' GROUP BY i.id, i.title ORDER BY n DESC LIMIT 5`,
      p.id,
      Math.floor(since / 3_600_000) * 3_600_000,
    );
    if (!created.length && !fired.length && !busiest.length) continue;
    const link = (id: number) => `${baseURL}/p/${p.id}/issues/${id}`;
    const lines = [`${p.name}`];
    if (created.length) lines.push(`  New (${created.length}):`, ...created.slice(0, 10).map((i) => `    ${i.title}\n    ${link(i.id)}`));
    if (fired.length) lines.push(`  Fired again (${fired.length}):`, ...fired.slice(0, 10).map((i) => `    ${i.title}\n    ${link(i.id)}`));
    if (busiest.length) lines.push("  Busiest:", ...busiest.map((i) => `    ${i.n} events  ${i.title}\n    ${link(i.id)}`));
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

/** Sends one person's digest now. Returns false when there was nothing to say. */
export async function sendDigest(db: Db, access: Access, senders: Senders, email: string, groups: string[], baseURL: string, now = Date.now()): Promise<boolean> {
  const body = await digestFor(db, access, email, groups, baseURL, now);
  if (!body) return false;
  await senders.send(
    { kind: "email", target: email },
    { subject: "Burning: your daily summary", text: `What happened in your projects in the last day.\n\n${body}\n`, json: "{}" },
  );
  return true;
}

/**
 * Sends the daily digests that are due: to everyone who turned them on, once
 * a day, from the given hour (UTC) on. Claims each person before sending, so
 * with several servers each digest goes once.
 */
export async function sendDueDigests(db: Db, access: Access, senders: Senders, baseURL: string, hourUTC: number, groupsClaim: string, now = Date.now()): Promise<number> {
  const startOfDay = Math.floor(now / DAY) * DAY + hourUTC * 3_600_000;
  if (now < startOfDay) return 0;
  const due = await db.all<{ email: string; claims: string }>("SELECT email, claims FROM users WHERE digest = 1 AND last_digest < ?", startOfDay);
  let sent = 0;
  for (const u of due) {
    const claimed = await db.run("UPDATE users SET last_digest = ? WHERE email = ? AND last_digest < ?", now, u.email, startOfDay);
    if (!claimed.changes) continue;
    const groups = groupsFromClaims(JSON.parse(u.claims || "{}") as Record<string, unknown>, groupsClaim);
    try {
      if (await sendDigest(db, access, senders, u.email, groups, baseURL, now)) sent++;
    } catch (err) {
      console.error(`digest to ${u.email}:`, err);
    }
  }
  return sent;
}

/** A person's daily summary: on or off, and one now. */
export function digestRoutes(db: Db, access: Access, deps: { senders: Senders; config: Config }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const body = async <T>(c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as T;

  app.get("/profile/digest", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign in first" }, 404);
    const row = await db.get<{ digest: number; last_digest: number }>("SELECT digest, last_digest FROM users WHERE email = ?", user.email.toLowerCase());
    return c.json({ enabled: Number(row?.digest ?? 0) === 1, lastSent: row?.last_digest ?? 0, hourUTC: deps.config.digestHour, email: deps.senders.emailEnabled });
  });
  app.put("/profile/digest", async (c) => {
    const user = c.get("user");
    if (!user || !(await getUser(db, user.email))) return c.json({ detail: "sign in again to load your profile" }, 404);
    const { enabled } = await body<{ enabled?: unknown }>(c);
    await db.run("UPDATE users SET digest = ? WHERE email = ?", enabled === true ? 1 : 0, user.email.toLowerCase());
    return c.json({ enabled: enabled === true });
  });
  app.post("/profile/digest/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign in first" }, 404);
    try {
      const sent = await sendDigest(db, access, deps.senders, user.email, user.groups, publicBase(c, deps.config.baseURL));
      return sent ? c.json({ ok: true }) : c.json({ detail: "nothing happened in your projects in the last day" }, 200);
    } catch (err) {
      return c.json({ detail: (err as Error).message }, 502);
    }
  });

  return app;
}
