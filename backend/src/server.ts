import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { Auth, OidcLogin, Sessions, sessionSecret } from "./auth.js";
import { isPostgresURL, openDb } from "./db.js";
import { loadEnvFile, readConfig } from "./env.js";
import { expireMutes, prune } from "./issues.js";
import { PasswordLogin } from "./passwords.js";

loadEnvFile(process.env.BURNING_ENV_FILE ?? ".env");
const config = readConfig();
const db = await openDb(config.db);
console.log(`database: ${isPostgresURL(config.db) ? "postgres" : `sqlite ${config.db}`}`);

// Sign-in: OIDC, passwords, both, or neither (then no one can use the app).
let sso: OidcLogin | null = null;
if (config.oidc.issuer) {
  const missing = (["clientId", "redirectURL"] as const).filter((k) => !config.oidc[k]);
  if (missing.length) throw new Error(`OIDC is half configured: set ${missing.join(", ")} too`);
  sso = await OidcLogin.create(config.oidc);
  console.log(`sign-in with OIDC: ${config.oidc.issuer}`);
}
const password = config.passwordFile ? new PasswordLogin(config.passwordFile) : null;
if (password) console.log(`sign-in with passwords: ${config.passwordFile}`);
if (!sso && !password) console.warn("no sign-in configured (BURNING_OIDC_ISSUER or BURNING_PASSWORD_FILE): no one can use the app");
const secure = (config.baseURL || config.oidc.redirectURL).startsWith("https:");
const auth = new Auth(new Sessions(db, await sessionSecret(db, config.sessionSecret), secure), sso, password);

const { app, outbox, live } = createApp(db, { auth, config });
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
  app.use("*", serveStatic({ root }));
  app.get("*", (c) => c.html(index));
  console.log(`web app from ${root}`);
}

// Background work: the outbox, timed mutes, and retention.
const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  const run = () => void fn().catch((err) => console.error(`${name}:`, err));
  run();
  return setInterval(run, ms).unref();
};
outbox.kick();
every(30_000, "outbox", async () => outbox.kick());
every(60_000, "expiring mutes", async () => {
  const n = await expireMutes(db);
  if (n) console.log(`mutes ended: ${n}`);
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
