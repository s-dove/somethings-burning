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

-- Running counts, kept as events arrive, so heat and release numbers stay
-- right when payloads are sampled or pruned.
CREATE TABLE IF NOT EXISTS issue_hours (
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  hour        INTEGER NOT NULL, -- start of the hour, Unix ms
  event_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, hour)
);
CREATE INDEX IF NOT EXISTS issue_hours_hour ON issue_hours (hour);

CREATE TABLE IF NOT EXISTS issue_releases (
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  release     TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  PRIMARY KEY (issue_id, release, environment)
);

-- When each release was first seen in a project, so a "next release" mute
-- can tell a new release from one that was already running.
CREATE TABLE IF NOT EXISTS releases (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (project_id, version)
);

-- An issue's history: created, resolved, muted, fired again, notified, ...
-- actor is the email of who did it; empty for what Burning did on its own.
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  release     TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS activity_issue ON activity (issue_id, at DESC);

-- Comments on issues: Markdown, by the commenter's email. Earlier texts of
-- an edited comment are kept in comment_edits.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id   INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comments_by_issue ON comments (issue_id, created_at);

CREATE TABLE IF NOT EXISTS comment_edits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  replaced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_edits_by_comment ON comment_edits (comment_id, replaced_at);

-- A project's code sources (see source/config.ts), in order.
CREATE TABLE IF NOT EXISTS project_sources (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  config     TEXT NOT NULL,
  PRIMARY KEY (project_id, position)
);

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
  addColumns(db, "issues", ISSUE_TRIAGE_COLUMNS);
  addColumns(db, "issues", ISSUE_STORAGE_COLUMNS);
  backfillCounts(db);
  return db;
}

// How many payloads an issue keeps, and when it last kept one (sampling).
const ISSUE_STORAGE_COLUMNS: Record<string, string> = {
  stored_count: "INTEGER NOT NULL DEFAULT 0",
  last_stored: "INTEGER NOT NULL DEFAULT 0",
};

/**
 * A database from before the running counts gets them from its stored
 * events, once: then every event had its payload, so the events are the
 * counts.
 */
function backfillCounts(db: Db): void {
  const done = db.prepare("SELECT 1 FROM issue_hours LIMIT 1").get() || db.prepare("SELECT 1 FROM issue_releases LIMIT 1").get();
  const any = db.prepare("SELECT 1 FROM events LIMIT 1").get();
  if (done || !any) return;
  tx(db, () => {
    db.exec(`INSERT INTO issue_hours (issue_id, hour, event_count)
             SELECT issue_id, (received_at / 3600000) * 3600000, COUNT(*) FROM events GROUP BY issue_id, received_at / 3600000`);
    db.exec(`INSERT INTO issue_releases (issue_id, release, environment, event_count, first_seen, last_seen)
             SELECT issue_id, release, environment, COUNT(*), MIN(received_at), MAX(received_at) FROM events GROUP BY issue_id, release, environment`);
    db.exec(`UPDATE issues SET stored_count = (SELECT COUNT(*) FROM events e WHERE e.issue_id = issues.id),
                               last_stored = COALESCE((SELECT MAX(received_at) FROM events e WHERE e.issue_id = issues.id), 0)`);
  });
}

// Triage state, added to issues after the table first shipped. An issue is
// open, resolved, or muted; see triage.ts.
const ISSUE_TRIAGE_COLUMNS: Record<string, string> = {
  status: "TEXT NOT NULL DEFAULT 'open'",
  resolved_at: "INTEGER NOT NULL DEFAULT 0",
  mute_kind: "TEXT NOT NULL DEFAULT ''",
  mute_until: "INTEGER NOT NULL DEFAULT 0",
  muted_at: "INTEGER NOT NULL DEFAULT 0",
  notify_next: "INTEGER NOT NULL DEFAULT 0", // the next event alerts, because a mute ended
  reopen_reason: "TEXT NOT NULL DEFAULT ''", // why it last fired again
};

/** Adds the columns a table is missing, so an older database keeps working. */
function addColumns(db: Db, table: string, columns: Record<string, string>): void {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
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
