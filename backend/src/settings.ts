import type { Db } from "./db.js";

// A project's settings that are not a table of their own, saved as one JSON
// row. Each section has its page and is saved on its own.

export interface ProjectConfig {
  scrub: { defaults: boolean; fields: string[] };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  scrub: { defaults: true, fields: [] },
};

export async function getConfig(db: Db, projectId: number): Promise<ProjectConfig> {
  const row = await db.get<{ config: string }>("SELECT config FROM project_settings WHERE project_id = ?", projectId);
  const saved = row ? (JSON.parse(row.config) as Partial<ProjectConfig>) : {};
  return {
    scrub: { ...DEFAULT_CONFIG.scrub, ...(saved.scrub ?? {}) },
  };
}

export async function saveConfig(db: Db, projectId: number, config: ProjectConfig): Promise<void> {
  await db.run(
    "INSERT INTO project_settings (project_id, config) VALUES (?, ?) ON CONFLICT (project_id) DO UPDATE SET config = excluded.config",
    projectId,
    JSON.stringify(config),
  );
}

/** Checks one section of the settings from its page; returns the cleaned section or an error. */
export function checkSection(section: string, input: unknown): { error: string } | { value: unknown } {
  const o = (input ?? {}) as Record<string, unknown>;
  switch (section) {
    case "scrub": {
      const fields = (Array.isArray(o.fields) ? o.fields : []).map((f) => String(f).trim().toLowerCase()).filter(Boolean);
      if (fields.length > 100) return { error: "at most 100 fields" };
      if (fields.some((f) => !/^[\w.-]+$/.test(f))) return { error: "field names are letters, digits, and _ . -" };
      return { value: { defaults: o.defaults !== false, fields: [...new Set(fields)] } };
    }
  }
  return { error: "unknown section" };
}
