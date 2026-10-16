import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// Times are Unix milliseconds.
const schema = `
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  public_key  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  title       TEXT NOT NULL,
  culprit     TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'error',
  platform    TEXT NOT NULL DEFAULT '',
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS issues_project_last_seen ON issues (project_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  release     TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_issue_id ON events (issue_id, id DESC);
CREATE INDEX IF NOT EXISTS events_project_received ON events (project_id, received_at);
`;

/** Opens the database at \`path\` (":memory:" for tests) and creates the tables. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(schema);
  return db;
}
