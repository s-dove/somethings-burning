import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Auth, Sessions } from "../src/auth.js";
import { openDb } from "../src/db.js";
import { GitHubLogin, githubProblem, type GitHubSettings } from "../src/github.js";
import { identitiesOf, linkIdentity } from "../src/identities.js";
import { testDb, testPgUrl, usingPostgres } from "./helpers.js";

interface FakeAccount {
  id: number;
  login: string;
  name?: string;
  emails: { email: string; primary: boolean; verified: boolean }[];
  orgs?: string[];
}

const SETTINGS: GitHubSettings = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectURL: "https://burning.example.com/auth/github/callback",
  allowedEmails: ["ana@example.com", "ana@new.example.com"],
  orgs: [],
  webURL: "https://github.example.com",
  apiURL: "https://api.github.example.com",
};

/** A stand-in for GitHub: the code exchange, then the API, for whoever `account()` says signed in. */
function fakeGitHub(account: () => FakeAccount) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url.pathname);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/login/oauth/access_token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("client_secret") !== "secret-1" || form.get("code") !== "good-code") return json({ error: "bad_verification_code" });
      return json({ access_token: "token-1", token_type: "bearer" });
    }
    const a = account();
    if (url.pathname === "/user") return json({ id: a.id, login: a.login, name: a.name ?? null });
    if (url.pathname === "/user/emails") return json(a.emails);
    if (url.pathname === "/user/orgs") return json((a.orgs ?? []).map((login) => ({ login })));
    return json({ message: "Not Found" }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function setupGitHub(account: () => FakeAccount, settings: Partial<GitHubSettings> = {}) {
  const db = await testDb();
  const gh = fakeGitHub(account);
  const auth = new Auth(new Sessions(db, "test-secret", false), null, null, new GitHubLogin({ ...SETTINGS, ...settings }, gh.fetch));
  return { ...createApp(db, { auth }), db, calls: gh.calls };
}

type App = Awaited<ReturnType<typeof setupGitHub>>;

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]!).filter((c) => !c.endsWith("="));

/** Starts sign-in, then comes back from GitHub with `code`; returns the callback's answer. */
async function signIn(a: App, opts: { code?: string; state?: (s: string) => string; next?: string } = {}) {
  const start = await a.app.request("/auth/github", { method: "POST", body: new URLSearchParams({ next: opts.next ?? "/projects" }) });
  expect(start.status).toBe(302);
  const location = new URL(start.headers.get("location")!);
  const state = location.searchParams.get("state")!;
  const back = new URL("/auth/github/callback", "http://localhost");
  back.search = new URLSearchParams({ code: opts.code ?? "good-code", state: opts.state ? opts.state(state) : state }).toString();
  return { start, location, res: await a.app.request(back.pathname + back.search, { headers: { cookie: cookiesOf(start).join("; ") } }) };
}

async function sessionUser(a: App, res: Response) {
  const cookie = cookiesOf(res).find((c) => c.startsWith("burning_session="));
  if (!cookie) return null;
  const body = (await (await a.app.request("/api/session", { headers: { cookie } })).json()) as { user: { email: string; groups: string[]; username: string } | null };
  return body.user;
}

const ana = (over: Partial<FakeAccount> = {}): FakeAccount => ({
  id: 4242,
  login: "ana-gh",
  name: "Ana",
  emails: [
    { email: "ana@other.example.com", primary: false, verified: true },
    { email: "Ana@Example.com", primary: true, verified: true },
  ],
  ...over,
});

describe("GitHub sign-in", () => {
  it("sends people to GitHub, then signs them in with their verified primary email", async () => {
    const a = await setupGitHub(() => ana());
    expect(await (await a.app.request("/api/session")).json()).toMatchObject({ methods: { github: true, oidc: false, password: false } });

    const { location, res } = await signIn(a);
    expect(location.origin + location.pathname).toBe("https://github.example.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("redirect_uri")).toBe(SETTINGS.redirectURL);
    expect(location.searchParams.get("scope")).toBe("read:user user:email");
    expect(location.searchParams.get("allow_signup")).toBe("false");

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects");
    expect(await sessionUser(a, res)).toMatchObject({ email: "ana@example.com", username: "ana-gh", groups: [] });
    expect(await identitiesOf(a.db, "ana@example.com")).toMatchObject([{ provider: "github", subject: "4242", loginEmail: "ana@example.com", username: "ana-gh" }]);
    // No organizations configured: their memberships are not asked for.
    expect(a.calls).not.toContain("/user/orgs");
  });

  it("joins the account another way already made for the same email", async () => {
    const a = await setupGitHub(() => ana());
    await linkIdentity(a.db, { provider: "oidc:https://sso.example.com", subject: "sso-1", email: "ana@example.com", username: "ana" });
    const { res } = await signIn(a);
    expect(await sessionUser(a, res)).toMatchObject({ email: "ana@example.com" });
    expect((await identitiesOf(a.db, "ana@example.com")).map((i) => i.provider)).toEqual(["oidc:https://sso.example.com", "github"]);
  });

  it("keeps the same account when the email changes on GitHub", async () => {
    let account = ana();
    const a = await setupGitHub(() => account);
    await signIn(a);
    account = ana({ emails: [{ email: "ana@new.example.com", primary: true, verified: true }] });
    const { res } = await signIn(a);
    expect(await sessionUser(a, res)).toMatchObject({ email: "ana@example.com" });
    expect(await identitiesOf(a.db, "ana@example.com")).toMatchObject([{ provider: "github", subject: "4242", loginEmail: "ana@new.example.com" }]);
  });

  it("refuses an unverified primary email", async () => {
    const a = await setupGitHub(() => ana({ emails: [{ email: "ana@example.com", primary: true, verified: false }] }));
    const { res } = await signIn(a);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/no verified primary email/);
    expect(await sessionUser(a, res)).toBeNull();
    expect(await identitiesOf(a.db, "ana@example.com")).toEqual([]);
  });

  it("refuses people who are not allowed, and lets organization members in with their organizations as groups", async () => {
    const bo = (orgs: string[]): FakeAccount => ({ id: 7, login: "bo", emails: [{ email: "bo@example.com", primary: true, verified: true }], orgs });
    const outsider = await setupGitHub(() => bo(["Elsewhere"]));
    const refused = (await signIn(outsider)).res;
    expect(refused.status).toBe(400);
    expect(await refused.text()).toMatch(/may not sign in/);

    const member = await setupGitHub(() => bo(["Acme", "Other"]), { orgs: ["acme"] });
    const { location, res } = await signIn(member);
    expect(location.searchParams.get("scope")).toBe("read:user user:email read:org");
    expect(await sessionUser(member, res)).toMatchObject({ email: "bo@example.com", groups: ["github:acme", "github:other"] });
  });

  it("refuses a callback whose state or code is wrong", async () => {
    const a = await setupGitHub(() => ana());
    const forged = (await signIn(a, { state: (s) => s.replace(/.$/, (ch) => (ch === "0" ? "1" : "0")) })).res;
    expect(forged.status).toBe(400);
    expect(await forged.text()).toMatch(/state does not match/);
    const badCode = (await signIn(a, { code: "stolen" })).res;
    expect(badCode.status).toBe(400);
    expect(await badCode.text()).toMatch(/bad_verification_code/);
    // Without the sign-in cookie, the callback is refused before GitHub is asked anything.
    const calls = a.calls.length;
    expect((await a.app.request("/auth/github/callback?code=good-code&state=x")).status).toBe(400);
    expect(a.calls.length).toBe(calls);
  });

  it("goes only to a page on this site after signing in", async () => {
    const a = await setupGitHub(() => ana());
    const { res } = await signIn(a, { next: "//evil.example.com/" });
    expect(res.headers.get("location")).toBe("/");
  });

  it("needs a full configuration, and someone allowed", () => {
    expect(githubProblem(SETTINGS)).toBe("");
    expect(githubProblem({ ...SETTINGS, clientSecret: "" })).toMatch(/BURNING_GITHUB_CLIENT_SECRET/);
    expect(githubProblem({ ...SETTINGS, allowedEmails: [], orgs: [] })).toMatch(/BURNING_GITHUB_ALLOWED_EMAILS or BURNING_GITHUB_ORGS/);
    expect(githubProblem({ ...SETTINGS, allowedEmails: ["*"] })).toBe("");
  });
});

describe("identities", () => {
  it("gives each person who signed in before identities an identity, once", async () => {
    const target = usingPostgres() ? await testPgUrl() : join(mkdtempSync(join(tmpdir(), "burning-")), "burning.db");
    const before = await openDb(target);
    // As a database from before identities: people who signed in, and no backfill yet.
    await before.run("DELETE FROM meta WHERE key = 'identities_backfilled'");
    const add = (email: string, issuer: string, subject: string) =>
      before.run("INSERT INTO users (email, username, issuer, subject, first_login, last_login) VALUES (?, ?, ?, ?, 1, 2)", email, email.split("@")[0]!, issuer, subject);
    await add("ana@example.com", "https://sso.example.com", "sso-ana");
    await add("bo@example.com", "password", "");
    await add("cy@example.com", "https://sso.example.com", "");
    await before.close();

    const after = await openDb(target);
    expect(await identitiesOf(after, "ana@example.com")).toMatchObject([{ provider: "oidc:https://sso.example.com", subject: "sso-ana", firstLogin: 1, lastLogin: 2 }]);
    expect(await identitiesOf(after, "bo@example.com")).toMatchObject([{ provider: "password", subject: "bo@example.com" }]);
    expect(await identitiesOf(after, "cy@example.com")).toMatchObject([{ provider: "oidc:https://sso.example.com", subject: "cy@example.com" }]);

    // Once only: an identity removed later does not come back on the next start.
    await after.run("DELETE FROM identities WHERE email = ?", "bo@example.com");
    await after.close();
    const again = await openDb(target);
    expect(await identitiesOf(again, "bo@example.com")).toEqual([]);
    await again.close();
  });

  it("finds the account by the provider's id, and links a new one by email", async () => {
    const db = await testDb();
    const id = { provider: "github", subject: "1", email: "Ana@Example.com", username: "ana" };
    expect(await linkIdentity(db, id)).toBe("ana@example.com");
    expect(await linkIdentity(db, { ...id, email: "ana@changed.example.com" })).toBe("ana@example.com");
    expect(await linkIdentity(db, { ...id, subject: "2", email: "bo@example.com" })).toBe("bo@example.com");
  });
});
