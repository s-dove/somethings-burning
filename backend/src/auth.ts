import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as oidc from "openid-client";
import type { Db } from "./db.js";
import type { GitHubLogin } from "./github.js";
import { linkIdentity } from "./identities.js";
import { PasswordLogin } from "./passwords.js";
import { displayOf, getUser, recordLogin, usernameFrom } from "./users.js";

const SESSION_COOKIE = "burning_session";
const LOGIN_COOKIE = "burning_login";
const SESSION_TTL_S = 12 * 3600;
const LOGIN_TTL_S = 10 * 60;

export interface User {
  email: string;
  name: string;
  groups: string[];
  username: string; // preferred_username at sign-in
  displayName: string; // what the app shows: the person's own choice, else the username
  lang: string; // the interface language they chose; "" for not yet
}

/** The ways to sign in that the backend has configured. */
export interface Methods {
  oidc: boolean;
  oidcName: string; // what the sign-in button calls the provider
  password: boolean;
  github: boolean;
}

/** What the app needs from sign-in. Auth is the real one; tests use a stand-in. */
export interface Authenticator {
  methods: Methods;
  user(c: Context): Promise<User | null>;
  /** The /auth/* routes: starting and finishing sign-in, and signing out. */
  routes(): Hono;
}

export interface OIDCSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientAuth: string;
  redirectURL: string;
  scope: string;
  groupsClaim: string;
  name: string;
}

/**
 * Reads the groups claim. Providers send either a list or one
 * space-separated string. An absent claim is an empty list, not an error.
 */
export function groupsFromClaims(claims: Record<string, unknown> | undefined, claim: string): string[] {
  const value = claims?.[claim];
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === "string" && g !== "");
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

export const safeNext = (next: unknown): next is string =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//");

/**
 * The secret that signs cookies: BURNING_SESSION_SECRET, or a random one
 * kept in the database so sessions survive a restart.
 */
export async function sessionSecret(db: Db, configured: string): Promise<string> {
  if (configured) return createHash("sha256").update(`burning-session:${configured}`).digest("hex");
  // Several servers may start at once: the first insert wins, and all read it back.
  await db.run("INSERT INTO meta (key, value) VALUES ('session_secret', ?) ON CONFLICT DO NOTHING", randomBytes(32).toString("hex"));
  return (await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'session_secret'"))!.value;
}

/**
 * Sessions: the cookie holds only a session id (group lists are too long for
 * a cookie). It is HttpOnly, SameSite=Lax, signed, and Secure when the app is
 * served over https.
 */
export class Sessions {
  constructor(
    private db: Db,
    readonly secret: string,
    private secure: boolean,
  ) {}

  cookie(maxAge: number) {
    return { path: "/", httpOnly: true, secure: this.secure, sameSite: "Lax" as const, maxAge };
  }

  async user(c: Context): Promise<User | null> {
    const id = await getSignedCookie(c, this.secret, SESSION_COOKIE);
    if (!id) return null;
    const row = await this.db.get<{ email: string; name: string; groups: string; expires: number }>("SELECT email, name, groups, expires FROM sessions WHERE id = ?", id);
    if (!row || row.expires < Math.floor(Date.now() / 1000)) return null;
    const saved = await getUser(this.db, row.email);
    const username = saved?.username || usernameFrom({}, row.email);
    return {
      email: row.email,
      name: row.name,
      groups: groupsFromClaims({ groups: JSON.parse(row.groups) }, "groups"),
      username,
      displayName: saved ? displayOf(saved) : username,
      lang: saved?.lang ?? "",
    };
  }

  /**
   * Finds or links the person's account (identities.ts), records the sign-in,
   * and starts their session. `email` must be one the provider verified.
   */
  async start(
    c: Context,
    who: { provider: string; subject: string; email: string; issuer: string; claims: Record<string, unknown>; groups: string[] },
  ): Promise<void> {
    const email = await linkIdentity(this.db, {
      provider: who.provider,
      subject: who.subject,
      email: who.email,
      username: usernameFrom(who.claims, who.email.toLowerCase()),
    });
    await recordLogin(this.db, { email, issuer: who.issuer, claims: who.claims, groups: who.groups });
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const name = typeof who.claims.name === "string" ? who.claims.name : "";
    await this.db.run("INSERT INTO sessions (id, email, name, groups, expires) VALUES (?, ?, ?, ?, ?)", id, email, name, JSON.stringify(who.groups), now + SESSION_TTL_S);
    await this.db.run("DELETE FROM sessions WHERE expires < ?", now);
    console.log(`signed in email=${email} via=${who.issuer} groups=${who.groups.length}`);
    await setSignedCookie(c, SESSION_COOKIE, id, this.secret, this.cookie(SESSION_TTL_S));
  }

  async end(c: Context): Promise<void> {
    const id = await getSignedCookie(c, this.secret, SESSION_COOKIE);
    if (id) await this.db.run("DELETE FROM sessions WHERE id = ?", id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }
}

export const CLIENT_AUTH = ["client_secret_basic", "client_secret_post", "none"] as const;

/** The token endpoint authentication: as configured, else basic with a secret and none without. */
export function clientAuthFor(s: Pick<OIDCSettings, "clientSecret" | "clientAuth">): oidc.ClientAuth {
  const method = s.clientAuth || (s.clientSecret ? "client_secret_basic" : "none");
  if (!(CLIENT_AUTH as readonly string[]).includes(method)) {
    throw new Error(`BURNING_OIDC_CLIENT_AUTH must be one of ${CLIENT_AUTH.join(", ")}, not "${method}"`);
  }
  if (method !== "none" && !s.clientSecret) throw new Error(`${method} needs BURNING_OIDC_CLIENT_SECRET`);
  if (method === "client_secret_post") return oidc.ClientSecretPost(s.clientSecret);
  if (method === "client_secret_basic") return oidc.ClientSecretBasic(s.clientSecret);
  return oidc.None();
}

/**
 * OidcLogin signs people in with any OpenID Connect provider: the endpoints
 * come from the issuer's discovery document, and sign-in is the
 * authorization code flow with PKCE.
 */
export class OidcLogin {
  private constructor(
    private config: oidc.Configuration,
    readonly settings: OIDCSettings,
  ) {}

  static async create(settings: OIDCSettings): Promise<OidcLogin> {
    // A plain-http issuer is only for local development (a provider on localhost).
    const insecure = new URL(settings.issuer).protocol === "http:";
    if (insecure) console.warn(`OIDC issuer ${settings.issuer} is plain http: use this for local development only`);
    const config = await oidc.discovery(
      new URL(settings.issuer),
      settings.clientId,
      settings.clientSecret || undefined,
      clientAuthFor(settings),
      insecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
    );
    return new OidcLogin(config, settings);
  }

  async begin(c: Context, sessions: Sessions, next: string) {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    await setSignedCookie(c, LOGIN_COOKIE, JSON.stringify({ verifier, state, next }), sessions.secret, sessions.cookie(LOGIN_TTL_S));
    const url = oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.settings.redirectURL,
      scope: this.settings.scope,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
    });
    return c.redirect(url.href, 302);
  }

  /** Checks the provider's callback, starts the session, and returns the page to go to. */
  async finish(c: Context, sessions: Sessions): Promise<string> {
    const raw = await getSignedCookie(c, sessions.secret, LOGIN_COOKIE);
    deleteCookie(c, LOGIN_COOKIE, { path: "/" });
    if (!raw) throw new Error("Sign-in expired. Try again.");
    const flow = JSON.parse(raw) as { verifier: string; state: string; next: string };
    if (c.req.query("error")) throw new Error(`Sign-in failed: ${c.req.query("error_description") ?? c.req.query("error")}`);
    // The token request repeats the registered redirect URL, so rebuild the
    // callback URL from it rather than from the Host header.
    const current = new URL(this.settings.redirectURL);
    current.search = new URL(c.req.url).search;
    const tokens = await oidc.authorizationCodeGrant(this.config, current, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
    });
    const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    let groups = groupsFromClaims(claims, this.settings.groupsClaim);
    // Some providers put groups only in userinfo. If that lookup fails, sign
    // in anyway with no groups.
    if (groups.length === 0 && tokens.access_token && typeof claims.sub === "string") {
      try {
        const info = await oidc.fetchUserInfo(this.config, tokens.access_token, claims.sub);
        groups = groupsFromClaims(info, this.settings.groupsClaim);
      } catch (err) {
        console.warn("userinfo lookup failed, signing in with no groups:", err);
      }
    }
    const email = typeof claims.email === "string" ? claims.email : String(claims.sub ?? "");
    if (!email) throw new Error("The provider sent no email or subject.");
    const subject = typeof claims.sub === "string" && claims.sub ? claims.sub : email;
    await sessions.start(c, { provider: `oidc:${this.settings.issuer}`, subject, email, issuer: this.settings.issuer, claims: { ...claims }, groups });
    return safeNext(flow.next) ? flow.next : "/";
  }
}

/** Auth is sign-in as configured: any of OIDC, passwords, and GitHub, or none. */
export class Auth implements Authenticator {
  constructor(
    private sessions: Sessions,
    private oidc: OidcLogin | null,
    private password: PasswordLogin | null,
    private github: GitHubLogin | null = null,
  ) {}

  get methods(): Methods {
    return { oidc: !!this.oidc, oidcName: this.oidc?.settings.name || "SSO", password: !!this.password, github: !!this.github };
  }

  user(c: Context): Promise<User | null> {
    return this.sessions.user(c);
  }

  routes(): Hono {
    const app = new Hono();
    const { sessions, oidc: sso, password, github } = this;

    // OIDC: start (a form post), then the provider calls back.
    app.post("/auth/oidc", async (c) => {
      if (!sso) return c.text("OIDC sign-in is not configured", 404);
      const form = await c.req.parseBody();
      return sso.begin(c, sessions, safeNext(form.next) ? form.next : "/");
    });
    app.get("/auth/callback", async (c) => {
      if (!sso) return c.notFound();
      try {
        return c.redirect(await sso.finish(c, sessions), 303);
      } catch (err) {
        console.warn("sign-in failed:", err);
        return c.text((err as Error).message, 400);
      }
    });

    // GitHub: start (a form post), then GitHub calls back.
    app.post("/auth/github", async (c) => {
      if (!github) return c.text("GitHub sign-in is not configured", 404);
      const form = await c.req.parseBody();
      return github.begin(c, sessions, safeNext(form.next) ? form.next : "/");
    });
    app.get("/auth/github/callback", async (c) => {
      if (!github) return c.notFound();
      try {
        return c.redirect(await github.finish(c, sessions), 303);
      } catch (err) {
        console.warn("GitHub sign-in failed:", err);
        return c.text((err as Error).message, 400);
      }
    });

    // Password: JSON { email, password }, answered with JSON.
    app.post("/auth/password", async (c) => {
      if (!password) return c.json({ detail: "password sign-in is not configured" }, 404);
      const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
      const email = String(body.email ?? "").trim().toLowerCase();
      const secret = String(body.password ?? "");
      if (!email || !secret) return c.json({ detail: "enter your email and password" }, 400);
      if (password.locked(email)) return c.json({ detail: "too many failed attempts; try again in a few minutes" }, 429);
      const account = password.verify(email, secret);
      if (!account) return c.json({ detail: "wrong email or password" }, 401);
      await sessions.start(c, {
        provider: "password",
        subject: account.email,
        email: account.email,
        issuer: "password",
        claims: { email: account.email, preferred_username: usernameFrom({}, account.email), groups: account.groups },
        groups: account.groups,
      });
      return c.json({ ok: true });
    });

    app.post("/auth/logout", async (c) => {
      await sessions.end(c);
      return c.redirect("/login", 303);
    });
    return app;
  }
}

/** No way to sign in: every API call answers 401, and the login page says to configure one. */
export const noAuth: Authenticator = {
  methods: { oidc: false, oidcName: "SSO", password: false, github: false },
  user: async () => null,
  routes: () => new Hono(),
};
