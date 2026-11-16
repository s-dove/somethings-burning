import { originalPositionFor, sourceContentFor, TraceMap } from "@jridgewell/trace-mapping";
import type { Db } from "../db.js";
import type { Frame } from "../event.js";
import type { FrameView } from "../event-view.js";

// JavaScript source maps, uploaded per release (see the source maps API).
// A minified frame finds its map by URL path: "~/static/js/app.js.map" (any
// host), the full URL plus ".map", or the file name plus ".map" (with or
// without "~/"). Mapping is
// done when the issue page is shown, so a map uploaded late still applies.

const CONTEXT = 5;
const cache = new Map<string, TraceMap | null>();

/** The names a map for this minified file may have been uploaded under. */
export function mapNames(absPath: string): string[] {
  let path = absPath;
  try {
    path = new URL(absPath).pathname;
  } catch {
    // not a URL: a path as is
  }
  const base = path.split("/").pop() ?? path;
  return [...new Set([`~${path}.map`, `${absPath}.map`, `${path}.map`, `~/${base}.map`, `${base}.map`])];
}

async function mapFor(db: Db, projectId: number, release: string, absPath: string): Promise<TraceMap | null> {
  const names = mapNames(absPath);
  const key = `${projectId}|${release}|${names[0]}`;
  if (cache.has(key)) return cache.get(key)!;
  const row = await db.get<{ content: string }>(
    `SELECT content FROM artifacts WHERE project_id = ? AND release = ? AND name IN (${names.map(() => "?").join(",")}) LIMIT 1`,
    projectId,
    release,
    ...names,
  );
  let map: TraceMap | null = null;
  try {
    map = row ? new TraceMap(row.content) : null;
  } catch {
    map = null;
  }
  cache.set(key, map);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return map;
}

/** Forgets cached maps of a release, after an upload or delete. */
export function forgetMaps(projectId: number, release: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${projectId}|${release}|`)) cache.delete(k);
}

const cleanSource = (s: string) => s.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "");

/**
 * Turns minified JavaScript frames into their original file, line, and
 * function, with the code around the line when the map carries it.
 */
export async function applySourceMaps(db: Db, projectId: number, release: string, view: FrameView[], raw: Frame[]): Promise<number> {
  if (!release) return 0;
  let mapped = 0;
  for (const [k, fv] of view.entries()) {
    const f = raw[k];
    const abs = f?.abs_path || f?.filename || "";
    if (!f || !f.lineno || !/\.m?js(\?|#|$)/.test(abs)) continue;
    const map = await mapFor(db, projectId, release, abs);
    if (!map) continue;
    const pos = originalPositionFor(map, { line: f.lineno, column: Math.max(0, (f.colno ?? 1) - 1) });
    if (!pos.source || !pos.line) continue;
    fv.mapped = `${abs}:${f.lineno}${f.colno ? `:${f.colno}` : ""}`;
    fv.location = cleanSource(pos.source);
    fv.lineno = pos.line;
    if (pos.name) fv.function = pos.name;
    fv.inApp = !/node_modules\//.test(pos.source);
    const content = sourceContentFor(map, pos.source);
    fv.lines = content
      ? content
          .split("\n")
          .map((text, i) => ({ no: i + 1, text, current: i + 1 === pos.line }))
          .slice(Math.max(0, pos.line - 1 - CONTEXT), pos.line + CONTEXT)
      : [];
    mapped++;
  }
  return mapped;
}
