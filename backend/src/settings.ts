import type { Db } from "./db.js";

// A project's settings that are not a table of their own, saved as one JSON
// row. Each section has its page and is saved on its own.

/** Who owns an issue: the first rule whose pattern matches. */
export interface OwnerRule {
  field: "path" | "type" | "message" | "culprit" | "tag"; // tag needs `tag`
  tag?: string; // the tag name, for field "tag"
  pattern: string; // a regex matched anywhere in the value
  owner: string; // an email
}

export interface ProjectConfig {
  owners: OwnerRule[];
  scrub: { defaults: boolean; fields: string[] };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  owners: [],
  scrub: { defaults: true, fields: [] },
};

const FIELDS = ["path", "type", "message", "culprit", "tag"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getConfig(db: Db, projectId: number): Promise<ProjectConfig> {
  const row = await db.get<{ config: string }>("SELECT config FROM project_settings WHERE project_id = ?", projectId);
  const saved = row ? (JSON.parse(row.config) as Partial<ProjectConfig>) : {};
  return {
    owners: saved.owners ?? [],
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

const regexError = (p: string): string => {
  if (!p) return "add a pattern";
  try {
    new RegExp(p);
    return "";
  } catch {
    return `"${p}" is not a valid regex`;
  }
};

/** The part every rule has: what it looks at, and the regex. */
function checkField(o: Record<string, unknown>, at: string): { error: string } | { field: (typeof FIELDS)[number]; tag?: string; pattern: string } {
  const field = String(o.field ?? "") as (typeof FIELDS)[number];
  if (!FIELDS.includes(field)) return { error: `${at}: choose path, type, message, culprit, or tag` };
  const tag = field === "tag" ? String(o.tag ?? "").trim() : undefined;
  if (field === "tag" && !/^[\w.-]+$/.test(tag ?? "")) return { error: `${at}: name the tag` };
  const pattern = String(o.pattern ?? "").trim().slice(0, 500);
  const bad = regexError(pattern);
  if (bad) return { error: `${at}: ${bad}` };
  return { field, ...(tag ? { tag } : {}), pattern };
}

/** Checks one section of the settings from its page; returns the cleaned section or an error. */
export function checkSection(section: string, input: unknown): { error: string } | { value: unknown } {
  const o = (input ?? {}) as Record<string, unknown>;
  switch (section) {
    case "owners": {
      const list = Array.isArray(input) ? input : [];
      if (list.length > 50) return { error: "at most 50 rules" };
      const out: OwnerRule[] = [];
      for (const [i, raw] of list.entries()) {
        const r = (raw ?? {}) as Record<string, unknown>;
        const f = checkField(r, `rule ${i + 1}`);
        if ("error" in f) return f;
        const owner = String(r.owner ?? "").trim().toLowerCase();
        if (!EMAIL.test(owner)) return { error: `rule ${i + 1}: the owner is an email` };
        out.push({ ...f, owner });
      }
      return { value: out };
    }
    case "scrub": {
      const fields = (Array.isArray(o.fields) ? o.fields : []).map((f) => String(f).trim().toLowerCase()).filter(Boolean);
      if (fields.length > 100) return { error: "at most 100 fields" };
      if (fields.some((f) => !/^[\w.-]+$/.test(f))) return { error: "field names are letters, digits, and _ . -" };
      return { value: { defaults: o.defaults !== false, fields: [...new Set(fields)] } };
    }
  }
  return { error: "unknown section" };
}
