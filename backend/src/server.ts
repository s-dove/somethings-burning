import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const port = Number(process.env.PORT ?? 8195);
const db = openDb(process.env.DATABASE_PATH ?? "data/burning.db");

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`backend listening on http://localhost:${info.port}`);
});
