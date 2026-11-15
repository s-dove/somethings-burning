import type { Db } from "./db.js";
import type { SourceConfig } from "./source/config.js";

/** A project's code sources, in the order the settings page shows them. */
export async function getSources(db: Db, projectId: number): Promise<SourceConfig[]> {
  const rows = await db.all<{ config: string }>("SELECT config FROM project_sources WHERE project_id = ? ORDER BY position", projectId);
  return rows.map((r) => JSON.parse(r.config) as SourceConfig);
}

export function saveSources(db: Db, projectId: number, sources: SourceConfig[]): Promise<void> {
  return db.tx(async (t) => {
    await t.run("DELETE FROM project_sources WHERE project_id = ?", projectId);
    for (const [i, s] of sources.entries()) await t.run("INSERT INTO project_sources (project_id, position, config) VALUES (?, ?, ?)", projectId, i, JSON.stringify(s));
  });
}
