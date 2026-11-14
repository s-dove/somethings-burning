import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";

export type Project = {
  id: number;
  name: string;
  publicKey: string;
  createdAt: string;
};

export type ProjectSummary = Project & {
  issueCount: number;
  eventCount: number;
  lastSeen: string | null;
};

type ProjectRow = { id: number; name: string; public_key: string; created_at: string };

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  publicKey: r.public_key,
  createdAt: r.created_at,
});

export function listProjects(db: Db): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(i.id) AS issue_count, COALESCE(SUM(i.count), 0) AS event_count,
              MAX(i.last_seen) AS last_seen
         FROM projects p LEFT JOIN issues i ON i.project_id = p.id
        GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as (ProjectRow & { issue_count: number; event_count: number; last_seen: string | null })[];
  return rows.map((r) => ({
    ...toProject(r),
    issueCount: r.issue_count,
    eventCount: r.event_count,
    lastSeen: r.last_seen,
  }));
}

export function getProject(db: Db, id: number): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row && toProject(row);
}

export function createProject(db: Db, name: string): Project {
  const row = db
    .prepare("INSERT INTO projects (name, public_key, created_at) VALUES (?, ?, ?) RETURNING *")
    .get(name, randomBytes(16).toString("hex"), new Date().toISOString()) as ProjectRow;
  return toProject(row);
}

export function renameProject(db: Db, id: number, name: string): Project | undefined {
  const row = db.prepare("UPDATE projects SET name = ? WHERE id = ? RETURNING *").get(name, id) as
    | ProjectRow
    | undefined;
  return row && toProject(row);
}

export function deleteProject(db: Db, id: number): boolean {
  return Number(db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes) > 0;
}
