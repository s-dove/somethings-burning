import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";

export type Project = {
  id: number;
  name: string;
  publicKey: string;
  createdAt: number;
};

export type ProjectSummary = Project & {
  issueCount: number;
  eventCount: number;
  lastSeen: number | null;
};

type ProjectRow = { id: number; name: string; public_key: string; created_at: number };

const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, publicKey: r.public_key, createdAt: r.created_at });

/** A project name is taken, ignoring case. */
export class NameTaken extends Error {}

export async function listProjects(db: Db): Promise<ProjectSummary[]> {
  const rows = await db.all<ProjectRow & { issue_count: number; event_count: number; last_seen: number | null }>(
    `SELECT p.id, p.name, p.public_key, p.created_at, COUNT(i.id) AS issue_count, COALESCE(SUM(i.count), 0) AS event_count,
            MAX(i.last_seen) AS last_seen
       FROM projects p LEFT JOIN issues i ON i.project_id = p.id
      GROUP BY p.id, p.name, p.public_key, p.created_at ORDER BY lower(p.name)`,
  );
  return rows.map((r) => ({ ...toProject(r), issueCount: r.issue_count, eventCount: r.event_count, lastSeen: r.last_seen }));
}

export async function getProject(db: Db, id: number): Promise<Project | undefined> {
  if (!Number.isSafeInteger(id)) return undefined;
  const row = await db.get<ProjectRow>("SELECT * FROM projects WHERE id = ?", id);
  return row && toProject(row);
}

export async function projectByKey(db: Db, key: string): Promise<Project | undefined> {
  const row = await db.get<ProjectRow>("SELECT * FROM projects WHERE public_key = ?", key);
  return row && toProject(row);
}

async function nameTaken(db: Db, name: string, except = 0): Promise<boolean> {
  return !!(await db.get("SELECT 1 AS t FROM projects WHERE lower(name) = lower(?) AND id != ?", name, except));
}

const unique = (err: unknown) => /UNIQUE|duplicate key/i.test(String(err));

/** Creates a project. Throws NameTaken when another has the name. */
export async function createProject(db: Db, name: string): Promise<Project> {
  if (await nameTaken(db, name)) throw new NameTaken();
  try {
    const row = await db.get<ProjectRow>(
      "INSERT INTO projects (name, public_key, created_at) VALUES (?, ?, ?) RETURNING *",
      name,
      randomBytes(16).toString("hex"),
      Date.now(),
    );
    return toProject(row!);
  } catch (err) {
    if (unique(err)) throw new NameTaken();
    throw err;
  }
}

export async function renameProject(db: Db, id: number, name: string): Promise<Project | undefined> {
  if (await nameTaken(db, name, id)) throw new NameTaken();
  try {
    const row = await db.get<ProjectRow>("UPDATE projects SET name = ? WHERE id = ? RETURNING *", name, id);
    return row && toProject(row);
  } catch (err) {
    if (unique(err)) throw new NameTaken();
    throw err;
  }
}

export async function deleteProject(db: Db, id: number): Promise<boolean> {
  return (await db.run("DELETE FROM projects WHERE id = ?", id)).changes > 0;
}
