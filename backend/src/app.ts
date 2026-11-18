import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Access } from "./access.js";
import { Alerter } from "./alert.js";
import { apiRoutes } from "./api.js";
import { noAuth, type Authenticator } from "./auth.js";
import type { Db } from "./db.js";
import { readConfig, type Config } from "./env.js";
import { ingestRoutes } from "./ingest.js";
import { Outbox, Senders } from "./notify/deliver.js";
import { Mattermost } from "./notify/mattermost.js";
import { LiveAlerts } from "./live.js";
import { IngestQueue, TokenBucket } from "./queue.js";
import { selfReport } from "./self-report.js";
import { CodeSources } from "./source/index.js";

export interface AppDeps {
  auth?: Authenticator | null;
  config?: Config;
  senders?: Senders;
  code?: CodeSources;
}

/**
 * createApp puts it all together: Sentry ingest (by project key), sign-in,
 * and the web app's JSON API. With no auth, no one can sign in.
 */
export function createApp(db: Db, deps: AppDeps = {}): { app: Hono; outbox: Outbox; queue: IngestQueue; live: LiveAlerts; access: Access; senders: Senders } {
  const config = deps.config ?? readConfig({});
  const senders = deps.senders ?? new Senders(config.smtp, new Mattermost(config.mattermost));
  const outbox = new Outbox(db, senders);
  const app = new Hono();
  // A failure is logged, reported (self-report.ts), and answered with a plain 500.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`${c.req.method} ${c.req.path}:`, err);
    selfReport(err, { projectId: /^\/api\/(\d+)\/(envelope|store)\b/.exec(c.req.path)?.[1] });
    return c.text("Internal Server Error", 500);
  });

  // Sentry's ingest paths (/api/<project id>/envelope/ and /store/) and the
  // web app's own JSON API share the /api prefix, as they do in Sentry.
  const live = new LiveAlerts();
  const code = deps.code ?? new CodeSources({ ...config.git }, config.db);
  const queue = new IngestQueue(db, new Alerter(db, outbox), 2000, live);
  app.route("/api", ingestRoutes(db, { queue, limiter: new TokenBucket(config.rate, config.burst), baseURL: config.baseURL }));

  // Reject cross-site writes to the app and sign-in routes. Ingest is exempt:
  // browser SDKs post from other sites.
  app.use("*", async (c, next) => {
    const write = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (write) {
      const origin = c.req.header("Origin");
      const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host");
      if (origin && new URL(origin).host !== host) return c.text("cross-origin request rejected", 403);
    }
    return next();
  });
  const auth = deps.auth ?? noAuth;
  app.route("/", auth.routes());
  const access = new Access(db, config.siteAdmins);
  app.route("/api", apiRoutes(db, { auth, access, senders, baseURL: config.baseURL, config, live, code }));
  app.all("/api/*", (c) => c.json({ detail: "not found" }, 404));
  return { app, outbox, queue, live, access, senders };
}
