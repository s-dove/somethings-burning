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

-- People who have signed in, from their ID token claims. notify_routes is
-- their own notification routing (JSON); NULL means never saved.
CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  display_name  TEXT NOT NULL DEFAULT '',
  issuer        TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  claims        TEXT NOT NULL DEFAULT '{}',
  token_expires INTEGER NOT NULL DEFAULT 0,
  first_login   INTEGER NOT NULL,
  last_login    INTEGER NOT NULL,
  notify_routes TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id      TEXT PRIMARY KEY,
  email   TEXT NOT NULL,
  name    TEXT NOT NULL DEFAULT '',
  groups  TEXT NOT NULL DEFAULT '[]',
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_access (
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL,
  subject      TEXT NOT NULL,
  role         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, subject_kind, subject)
);

CREATE TABLE IF NOT EXISTS project_routes (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  matchers   TEXT NOT NULL,
  receivers  TEXT NOT NULL,
  sink       INTEGER NOT NULL DEFAULT 0,
  cont       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, position)
);

-- The outbox: one row per message to send, retried until it goes out.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id   INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  target     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  text       TEXT NOT NULL,
  json       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS notifications_due ON notifications (status, next_at);
`;

/** Opens the database at \`path\` (":memory:" for tests) and creates the tables. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(schema);
  return db;
}

/** Runs fn in a transaction. node:sqlite is synchronous, so fn must be too. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
