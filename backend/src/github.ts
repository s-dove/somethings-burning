import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { safeNext, type Sessions } from "./auth.js";

const LOGIN_COOKIE = "burning_login_github";
const LOGIN_TTL_S = 10 * 60;

export interface GitHubSettings {
  clientId: string;
  clientSecret: string;
  redirectURL: string; // <web app URL>/auth/github/callback
  // Who may sign in: these emails ("*" for anyone with a verified email),
  // and members of these organizations. At least one must be set.
  allowedEmails: string[];
  orgs: string[];
  webURL: string; // https://github.com, or a GitHub Enterprise Server
  apiURL: string; // https://api.github.com, or <server>/api/v3
}

type Fetch = typeof globalThis.fetch;

const ENV_NAMES = { clientId: "BURNING_GITHUB_CLIENT_ID", clientSecret: "BURNING_GITHUB_CLIENT_SECRET", redirectURL: "BURNING_GITHUB_REDIRECT_URL" } as const;

/** What is wrong with the settings, or "" when nothing is. */
export function githubProblem(s: GitHubSettings): string {
  const missing = (["clientId", "clientSecret", "redirectURL"] as const).filter((k) => !s[k]);
  if (missing.length) return `GitHub sign-in is half configured: set ${missing.map((k) => ENV_NAMES[k]).join(", ")} too`;
  if (s.allowedEmails.length === 0 && s.orgs.length === 0) {
    return "GitHub sign-in needs BURNING_GITHUB_ALLOWED_EMAILS or BURNING_GITHUB_ORGS, or anyone with a GitHub account could sign in (BURNING_GITHUB_ALLOWED_EMAILS=* allows that)";
  }
  return "";
}

/**
 * GitHubLogin signs people in with a GitHub OAuth app. GitHub is OAuth 2.0,
 * not OpenID Connect: after the code exchange, who the person is comes from
 * its API. The account is their verified primary email; the identity is
 * their numeric user id, which survives a renamed login or a changed email.
 * With organizations configured, each one they belong to is a group
 * "github:<org>", usable in project access.
 */
export class GitHubLogin {
  constructor(
    readonly settings: GitHubSettings,
    private fetch: Fetch = globalThis.fetch,
  ) {}

  private get scope(): string {
    return this.settings.orgs.length ? "read:user user:email read:org" : "read:user user:email";
  }

  async begin(c: Context, sessions: Sessions, next: string) {
    const state = randomBytes(24).toString("hex");
    await setSignedCookie(c, LOGIN_COOKIE, JSON.stringify({ state, next }), sessions.secret, sessions.cookie(LOGIN_TTL_S));
    const url = new URL("/login/oauth/authorize", this.settings.webURL);
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectURL,
      scope: this.scope,
      state,
      allow_signup: "false",
    }).toString();
    return c.redirect(url.href, 302);
  }

  /** Checks GitHub's callback, starts the session, and returns the page to go to. */
  async finish(c: Context, sessions: Sessions): Promise<string> {
    const raw = await getSignedCookie(c, sessions.secret, LOGIN_COOKIE);
    deleteCookie(c, LOGIN_COOKIE, { path: "/" });
    if (!raw) throw new Error("Sign-in expired. Try again.");
    const flow = JSON.parse(raw) as { state: string; next: string };
    if (c.req.query("error")) throw new Error(`Sign-in failed: ${c.req.query("error_description") ?? c.req.query("error")}`);
    const state = c.req.query("state") ?? "";
    if (state.length !== flow.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
      throw new Error("Sign-in failed: the state does not match. Try again.");
    }
    const code = c.req.query("code");
    if (!code) throw new Error("Sign-in failed: GitHub sent no code.");

    const token = await this.token(code);
    const user = await this.api<{ id: number; login: string; name: string | null }>(token, "/user");
    const emails = await this.api<{ email: string; primary: boolean; verified: boolean }[]>(token, "/user/emails");
    // Only a verified email may link to an account: anyone can add an unverified one.
    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) throw new Error("Your GitHub account has no verified primary email.");
    const email = primary.email.toLowerCase();
    const orgs = this.settings.orgs.length ? (await this.api<{ login: string }[]>(token, "/user/orgs?per_page=100")).map((o) => o.login.toLowerCase()) : [];
    if (!this.allowed(email, orgs)) throw new Error(`${email} may not sign in here.`);

    const subject = String(user.id);
    await sessions.start(c, {
      provider: "github",
      subject,
      email,
      issuer: "github",
      claims: { sub: subject, email, email_verified: true, preferred_username: user.login, name: user.name ?? "" },
      // Prefixed, so a GitHub organization cannot pass for a group from another provider.
      groups: orgs.map((o) => `github:${o}`),
    });
    return safeNext(flow.next) ? flow.next : "/";
  }

  private allowed(email: string, orgs: string[]): boolean {
    const { allowedEmails, orgs: wanted } = this.settings;
    return allowedEmails.includes("*") || allowedEmails.includes(email) || orgs.some((o) => wanted.includes(o));
  }

  private async token(code: string): Promise<string> {
    const res = await this.fetch(new URL("/login/oauth/access_token", this.settings.webURL), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, code, redirect_uri: this.settings.redirectURL }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) throw new Error(`Sign-in failed: ${body.error_description ?? body.error ?? `GitHub answered ${res.status}`}`);
    return body.access_token;
  }

  private async api<T>(token: string, path: string): Promise<T> {
    const res = await this.fetch(this.settings.apiURL.replace(/\/$/, "") + path, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "burning", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`Sign-in failed: GitHub answered ${res.status} for ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }
}
