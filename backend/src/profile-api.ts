import { Hono } from "hono";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import type { Senders } from "./notify/deliver.js";
import { checkRoutes, OPS, PERSONAL_FIELDS, PERSONAL_KINDS, receiverError, type Route } from "./notify/routing.js";
import { getPersonalRoutes, savePersonalRoutes } from "./notify/store.js";
import { getUser, LANGS, MAX_DISPLAY_NAME, setDisplayName, setLang } from "./users.js";

// Claims about the token itself, not the person. The profile lists the rest.
const TOKEN_CLAIMS = new Set(["iss", "sub", "aud", "exp", "iat", "nbf", "auth_time", "nonce", "at_hash", "c_hash", "azp", "sid", "jti"]);

const NO_PROFILE = "sign-in is off, so there is no profile";
const SIGN_IN_AGAIN = "sign in again to load your profile";

/**
 * The signed-in person's own pages: what Burning keeps about them, the name
 * others see, and their personal notification routing.
 */
export function profileRoutes(db: Db, senders: Senders): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const view = async (email: string, groups: string[]) => {
    const u = await getUser(db, email);
    if (!u) return null;
    return {
      email: u.email,
      username: u.username,
      name: u.name,
      displayName: u.displayName,
      shownAs: u.displayName || u.username,
      groups,
      issuer: u.issuer,
      subject: u.subject,
      tokenExpires: u.tokenExpires,
      firstLogin: u.firstLogin,
      lastLogin: u.lastLogin,
      claims: Object.entries(u.claims)
        .filter(([k]) => !TOKEN_CLAIMS.has(k))
        .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]),
    };
  };

  app.get("/profile", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    const p = await view(user.email, user.groups);
    return p ? c.json(p) : c.json({ detail: SIGN_IN_AGAIN }, 404);
  });

  // PUT sets the display name. An empty name goes back to the username.
  app.put("/profile", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    if (!(await getUser(db, user.email))) return c.json({ detail: SIGN_IN_AGAIN }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown };
    const name = String(body.displayName ?? "").trim();
    if (name.length > MAX_DISPLAY_NAME) return c.json({ detail: `keep it under ${MAX_DISPLAY_NAME} characters` }, 400);
    if (/[\u0000-\u001f\u007f]/.test(name)) return c.json({ detail: "no control characters" }, 400);
    await setDisplayName(db, user.email, name);
    return c.json(await view(user.email, user.groups));
  });

  // The interface language, kept with the person so it follows them.
  app.put("/profile/lang", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    if (!(await getUser(db, user.email))) return c.json({ detail: SIGN_IN_AGAIN }, 404);
    const lang = String(((await c.req.json().catch(() => ({}))) as { lang?: unknown }).lang ?? "");
    if (!(LANGS as readonly string[]).includes(lang)) return c.json({ detail: `the language is one of ${LANGS.join(", ")}` }, 400);
    await setLang(db, user.email, lang);
    return c.json({ lang });
  });

  // The person's own routing: how alerts that reach them as a person are
  // delivered (email, Mattermost message), or dropped.
  const notifyView = (email: string, routes: Route[], initial: boolean) => ({
    routes,
    initial, // never saved: the starting route, not a choice they made
    fields: PERSONAL_FIELDS,
    ops: OPS,
    receiverKinds: PERSONAL_KINDS,
    email: senders.emailEnabled,
    mattermost: senders.mattermost.enabled,
    address: email,
  });

  app.get("/profile/notifications", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    const { routes, initial } = await getPersonalRoutes(db, user.email);
    return c.json(notifyView(user.email, routes, initial));
  });

  // PUT replaces the whole table. An empty table means no notifications.
  app.put("/profile/notifications", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    if (!(await getUser(db, user.email))) return c.json({ detail: SIGN_IN_AGAIN }, 404);
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { routes?: unknown };
    const checked = checkRoutes(body.routes, "personal");
    if ("error" in checked) return c.json({ detail: checked.error }, 400);
    await savePersonalRoutes(db, user.email, checked.routes);
    return c.json(notifyView(user.email, checked.routes, false));
  });

  // POST .../test sends a test message to one receiver right away.
  app.post("/profile/notifications/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: NO_PROFILE }, 404);
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { kind?: unknown; target?: unknown };
    const kind = String(body.kind ?? "");
    const target = String(body.target ?? "").trim().replace(/^@/, "");
    const bad = receiverError(kind, target, "personal");
    if (bad) return c.json({ detail: bad }, 400);
    const text = `Test notification from Burning for ${user.email}. Alerts will look like this.`;
    try {
      await senders.send({ kind: kind === "email" ? "email" : "mattermost_dm", target }, { subject: "Burning test notification", text, json: "{}" });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return app;
}
