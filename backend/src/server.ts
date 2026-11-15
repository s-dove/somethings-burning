import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Auth, OidcLogin, Sessions, sessionSecret } from "./auth.js";
import { openDb } from "./db.js";
import { loadEnvFile, readConfig } from "./env.js";
import { expireMutes, prune } from "./issues.js";
import { requeueStuck } from "./notify/store.js";
import { PasswordLogin } from "./passwords.js";

loadEnvFile(".env");
const config = readConfig();
const db = openDb(config.db);

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
const auth = new Auth(new Sessions(db, sessionSecret(db, config.sessionSecret), secure), sso, password);

const { app, outbox } = createApp(db, { auth, config });
requeueStuck(db);
outbox.kick();
setInterval(() => outbox.kick(), 30_000).unref();
// Timed mutes end on the minute; the issue's next event alerts.
setInterval(() => {
  try {
    const n = expireMutes(db);
    if (n) console.log(`mutes ended: ${n}`);
  } catch (err) {
    console.error("expiring mutes:", err);
  }
}, 60_000).unref();
// Payloads older than the retention period go once an hour.
const pruneOld = () => {
  try {
    const n = prune(db, config.retentionDays * 86_400_000);
    if (n) console.log(`pruned events: ${n}`);
  } catch (err) {
    console.error("pruning events:", err);
  }
};
pruneOld();
setInterval(pruneOld, 3_600_000).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`backend listening on http://localhost:${info.port}`);
});
