import { tx, type Db } from "./db.js";
import type { SourceConfig } from "./source/config.js";

/** A project's code sources, in the order the settings page shows them. */
export function getSources(db: Db, projectId: number): SourceConfig[] {
  const rows = db.prepare("SELECT config FROM project_sources WHERE project_id = ? ORDER BY position").all(projectId) as { config: string }[];
  return rows.map((r) => JSON.parse(r.config) as SourceConfig);
}

export function saveSources(db: Db, projectId: number, sources: SourceConfig[]): void {
  tx(db, () => {
    db.prepare("DELETE FROM project_sources WHERE project_id = ?").run(projectId);
    const insert = db.prepare("INSERT INTO project_sources (project_id, position, config) VALUES (?, ?, ?)");
    sources.forEach((s, i) => insert.run(projectId, i, JSON.stringify(s)));
  });
}
