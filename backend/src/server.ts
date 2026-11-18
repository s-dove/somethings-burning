import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { Auth, OidcLogin, Sessions, sessionSecret } from "./auth.js";
import { isPostgresURL, openDb } from "./db.js";
import { loadEnvFile, readConfig } from "./env.js";
import { sendDueDigests } from "./digest.js";
import { expireMutes, prune } from "./issues.js";
import { GitHubLogin, githubProblem } from "./github.js";
import { PasswordLogin } from "./passwords.js";
import { selfReport, startSelfReport, webSettingsTag } from "./self-report.js";

loadEnvFile(process.env.BURNING_ENV_FILE ?? ".env");
const config = readConfig();
startSelfReport(config.sentry, config.baseURL);
const db = await openDb(config.db);
console.log(`database: ${isPostgresURL(config.db) ? "postgres" : `sqlite ${config.db}`}`);

// Sign-in: any of OIDC, passwords, and GitHub, or none (then no one can use the app).
let sso: OidcLogin | null = null;
if (config.oidc.issuer) {
  const missing = (["clientId", "redirectURL"] as const).filter((k) => !config.oidc[k]);
  if (missing.length) throw new Error(`OIDC is half configured: set ${missing.join(", ")} too`);
  sso = await OidcLogin.create(config.oidc);
  console.log(`sign-in with OIDC: ${config.oidc.issuer}`);
}
const password = config.passwordFile ? new PasswordLogin(config.passwordFile) : null;
if (password) console.log(`sign-in with passwords: ${config.passwordFile}`);
let github: GitHubLogin | null = null;
if (config.github.clientId) {
  const problem = githubProblem(config.github);
  if (problem) throw new Error(problem);
  github = new GitHubLogin(config.github);
  console.log(`sign-in with GitHub: ${config.github.webURL}`);
}
if (!sso && !password && !github) {
  console.warn("no sign-in configured (BURNING_OIDC_ISSUER, BURNING_PASSWORD_FILE, or BURNING_GITHUB_CLIENT_ID): no one can use the app");
}
const secure = (config.baseURL || config.oidc.redirectURL || config.github.redirectURL).startsWith("https:");
const auth = new Auth(new Sessions(db, await sessionSecret(db, config.sessionSecret), secure), sso, password, github);

const { app, outbox, live, access, senders } = createApp(db, { auth, config });
// With Postgres, alerts reach the browsers connected to every server.
if (isPostgresURL(config.db)) await live.listenPostgres(config.db);

app.get("/healthz", (c) => c.text("ok"));

// The web app: hashed assets are cached for good; every other path gets
// index.html, so client-side routes load on refresh. Without a build (the dev
// server serves the app), the API runs alone.
const root = path.resolve(config.staticDir);
let index = "";
try {
  index = readFileSync(path.join(root, "index.html"), "utf8");
  // Where the page reports its own errors (frontend/src/shared/sentry.ts).
  index = index.replace("</head>", `${webSettingsTag(config.sentry)}</head>`);
} catch {
  console.log(`no web app at ${root}: serving the API only`);
}
if (index) {
  app.use(
    "/assets/*",
    async (c, next) => {
      await next();
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
    serveStatic({ root }),
  );
  // index.html always comes from memory, with the settings put in above.
  app.get("/", (c) => c.html(index));
  app.get("/index.html", (c) => c.html(index));
  app.use("*", serveStatic({ root }));
  app.get("*", (c) => c.html(index));
  console.log(`web app from ${root}`);
}

// Background work: the outbox, timed mutes, and retention.
const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  const run = () =>
    void fn().catch((err) => {
      console.error(`${name}:`, err);
      selfReport(err);
    });
  run();
  return setInterval(run, ms).unref();
};
outbox.kick();
every(30_000, "outbox", async () => outbox.kick());
every(60_000, "expiring mutes", async () => {
  const n = await expireMutes(db);
  if (n) console.log(`mutes ended: ${n}`);
});
// Daily digests, from BURNING_DIGEST_HOUR (UTC) on, to people who turned them on.
every(15 * 60_000, "digests", async () => {
  if (!senders.emailEnabled) return;
  const n = await sendDueDigests(db, access, senders, config.baseURL || `http://localhost:${config.port}`, config.digestHour, config.oidc.groupsClaim);
  if (n) console.log(`digests sent: ${n}`);
});
every(3_600_000, "pruning events", async () => {
  const n = await prune(db, config.retentionDays * 86_400_000);
  if (n) console.log(`pruned events: ${n}`);
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`burning listening on http://${config.host}:${info.port}`);
});

const stop = async () => {
  server.close();
  await live.close();
  await db.close();
  process.exit(0);
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
