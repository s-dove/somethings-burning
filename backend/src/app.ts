import { Hono } from "hono";
import { apiRoutes } from "./api.js";
import type { Db } from "./db.js";
import { ingestRoutes } from "./ingest.js";

export function createApp(db: Db): Hono {
  const app = new Hono();
  // Sentry's ingest paths (/api/<project id>/envelope/ and /store/) and the
  // web app's own JSON API share the /api prefix, as they do in Sentry.
  app.route("/api", ingestRoutes(db));
  app.route("/api", apiRoutes(db));
  return app;
}
