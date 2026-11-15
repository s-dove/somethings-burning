// Fills the configured database (BURNING_DATABASE_URL or BURNING_DB) with
// demo projects and issues. It writes to the database directly, so run it
// while the server is stopped, or against a fresh database:
//
//   pnpm --filter backend seed
//   BURNING_SEED_ADMINS=you@example.com pnpm --filter backend seed
import { openDb } from "../src/db.js";
import { loadEnvFile, readConfig } from "../src/env.js";
import { seed } from "./data.js";

loadEnvFile(process.env.BURNING_ENV_FILE ?? ".env");
const config = readConfig();
const db = await openDb(config.db);
const admins = (process.env.BURNING_SEED_ADMINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const { created, skipped } = await seed(db, { admins, log: console.log });
await db.close();
console.log(`seeded: ${created.join(", ") || "nothing new"}${skipped.length ? ` (already there: ${skipped.join(", ")})` : ""}`);
