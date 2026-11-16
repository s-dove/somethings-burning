import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { SentryEvent } from "./event.js";

// How an issue's events spread over their tags, and how many users it
// reached. Counted as events arrive, so they include every event, stored or
// sampled away.

const MAX_TAG_KEYS = 25;

/** The tags an event is counted under: where it ran, the SDK's tags, and the browser and OS from its contexts. */
export function tagsOf(ev: SentryEvent): [string, string][] {
  const out = new Map<string, string>();
  const put = (k: string, v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return;
    const val = String(v).slice(0, 200);
    if (val && !out.has(k) && out.size < MAX_TAG_KEYS) out.set(k.slice(0, 64), val);
  };
  put("environment", ev.environment);
  put("release", ev.release);
  put("level", ev.level); // only when the SDK sent one
  put("server", ev.server_name);
  const ctx = (ev.contexts ?? {}) as Record<string, { name?: string; version?: string } | undefined>;
  if (ctx.browser?.name) put("browser", [ctx.browser.name, ctx.browser.version].filter(Boolean).join(" "));
  if (ctx.os?.name) put("os", [ctx.os.name, ctx.os.version].filter(Boolean).join(" "));
  const tags = ev.tags as Record<string, unknown> | [string, unknown][] | undefined;
  for (const [k, v] of Array.isArray(tags) ? tags : Object.entries(tags ?? {})) put(String(k), v);
  return [...out];
}

/** Counts an event's tags, and the user it reached, on its issue. */
export async function countEvent(db: Db, projectId: number, issueId: number, ev: SentryEvent): Promise<void> {
  for (const [key, value] of tagsOf(ev)) {
    await db.run(
      "INSERT INTO issue_tags (issue_id, key, value, count) VALUES (?, ?, ?, 1) ON CONFLICT (issue_id, key, value) DO UPDATE SET count = issue_tags.count + 1",
      issueId,
      key,
      value,
    );
  }
  const user = userKey(projectId, ev);
  if (user) await db.run("INSERT INTO issue_users (issue_id, user_key) VALUES (?, ?) ON CONFLICT DO NOTHING", issueId, user);
}

/** A hash standing for the user the event reached: their id, email, username, or address. */
export function userKey(projectId: number, ev: SentryEvent): string {
  const u = (ev.user ?? {}) as Record<string, unknown>;
  const id = ["id", "email", "username", "ip_address"].map((k) => u[k]).find((v) => typeof v === "string" || typeof v === "number");
  return id === undefined ? "" : createHash("sha256").update(`${projectId}:${String(id)}`).digest("hex").slice(0, 24);
}

export interface TagBreakdown {
  key: string;
  total: number;
  values: { value: string; count: number }[]; // the most common first
}

/** How the issue's events spread over each tag, the busiest tags first, top values of each. */
export async function tagBreakdown(db: Db, issueId: number, top = 6): Promise<TagBreakdown[]> {
  const rows = await db.all<{ key: string; value: string; count: number }>("SELECT key, value, count FROM issue_tags WHERE issue_id = ? ORDER BY key, count DESC, value", issueId);
  const byKey = new Map<string, TagBreakdown>();
  for (const r of rows) {
    const t = byKey.get(r.key) ?? { key: r.key, total: 0, values: [] };
    t.total += r.count;
    if (t.values.length < top) t.values.push({ value: r.value, count: r.count });
    byKey.set(r.key, t);
  }
  // Where it ran first, then the SDK's own tags by how much they say.
  const ORDER = ["environment", "release", "browser", "os", "server", "level"];
  return [...byKey.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.key);
    const ib = ORDER.indexOf(b.key);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return b.total - a.total || a.key.localeCompare(b.key);
  });
}

export async function usersAffected(db: Db, issueId: number): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM issue_users WHERE issue_id = ?", issueId))!.n;
}
