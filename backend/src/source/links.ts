import type { Db } from "../db.js";
import { exceptions, type Frame, type SentryEvent } from "../event.js";
import type { EventView } from "../event-view.js";
import { inAppFrames } from "../grouping.js";
import type { SourceConfig } from "./config.js";
import { matchFrame, type CodeSources } from "./index.js";
import { applySourceMaps } from "./sourcemaps.js";
import type { Commit } from "./source.js";

const LINK_TIMEOUT_MS = 4000;
const CONTEXT = 5;

/** The event's tags as pairs, for release rules that read one. */
export function tagPairs(ev: SentryEvent): [string, string][] {
  const t = ev.tags as Record<string, unknown> | [string, unknown][] | undefined;
  if (!t) return [];
  return (Array.isArray(t) ? t : Object.entries(t)).map(([k, v]) => [String(k), String(v ?? "")]);
}

export const releaseOf = (ev: SentryEvent): string => (typeof ev.release === "string" ? ev.release : "");

/** Each exception of the view with its raw frames, in the view's order (newest call first). */
function pairs(view: EventView, ev: SentryEvent): { e: number; raw: Frame[] }[] {
  const chain = exceptions(ev);
  return view.exceptions.map((_, e) => ({ e, raw: [...(chain[chain.length - 1 - e]?.stacktrace?.frames ?? [])].reverse() }));
}

/**
 * Gives each frame of the issue page a link to its line in the repository,
 * at the commit the release resolves to, and the code around the line when
 * the SDK sent none. Only the app's own frames (every frame when the SDK
 * marked none): library frames are not in the repository even when a broad
 * mapping covers their path. It gives up quietly after a few seconds, so a
 * slow git host never holds the page.
 */
export async function attachLinks(view: EventView, ev: SentryEvent, sources: SourceConfig[], code: CodeSources): Promise<void> {
  if (!sources.length) return;
  const shas = new Map<number, Promise<string>>();
  const sha = (i: number) => {
    let p = shas.get(i);
    if (!p) shas.set(i, (p = code.resolve(sources[i]!, releaseOf(ev), tagPairs(ev)).then((r) => r.sha, () => "")));
    return p;
  };
  const work = pairs(view, ev).map(async ({ e, raw }) => {
    const app = new Set(inAppFrames(raw));
    await Promise.all(
      view.exceptions[e]!.frames.map(async (fv, k) => {
        const f = raw[k];
        if (!f || fv.mapped) return; // mapped frames are original code, not in this path
        const spot = app.has(f) && matchFrame(sources, f);
        if (!spot) return;
        const commit = await sha(spot.source);
        if (!commit) return;
        const src = sources[spot.source]!;
        fv.link = code.open(src).link(commit, spot.path, f.lineno || undefined);
        if (!fv.lines.length && fv.lineno > 0) {
          const text = await code.read(src, commit, spot.path);
          if (text !== null) {
            const at = fv.lineno;
            fv.lines = text
              .split("\n")
              .map((t, i) => ({ no: i + 1, text: t, current: i + 1 === at }))
              .slice(Math.max(0, at - 1 - CONTEXT), at + CONTEXT);
            fv.linesFrom = `${src.repo}@${commit.slice(0, 7)}`;
          }
        }
      }),
    );
  });
  await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, LINK_TIMEOUT_MS))]);
}

/** Source maps first (they change a frame's file and line), then repository links and lines. */
export async function enrichEvent(view: EventView, ev: SentryEvent, ctx: { db: Db; projectId: number; sources: SourceConfig[]; code: CodeSources }): Promise<void> {
  for (const { e, raw } of pairs(view, ev)) await applySourceMaps(ctx.db, ctx.projectId, releaseOf(ev), view.exceptions[e]!.frames, raw);
  await attachLinks(view, ev, ctx.sources, ctx.code);
}

export interface Suspects {
  from: { release: string; sha: string };
  to: { release: string; sha: string };
  repo: string;
  compareUrl: string;
  files: { path: string; status: string }[]; // files in the stack that changed
  commits: Commit[];
}

/**
 * Suspect changes: between the previous release and this event's, in the
 * project's primary source, the files of the stack that changed and the
 * commits that touched them. Frames on a changed file are marked.
 */
export async function suspectChanges(
  db: Db,
  projectId: number,
  view: EventView,
  ev: SentryEvent,
  sources: SourceConfig[],
  code: CodeSources,
): Promise<Suspects | null> {
  const primary = sources.findIndex((s) => s.primary);
  const release = releaseOf(ev);
  if (primary < 0 || !release) return null;
  const src = sources[primary]!;
  const cur = await db.get<{ first_seen: number; commit_sha: string }>("SELECT first_seen, commit_sha FROM releases WHERE project_id = ? AND version = ?", projectId, release);
  if (!cur) return null;
  const prev = await db.get<{ version: string; commit_sha: string }>(
    "SELECT version, commit_sha FROM releases WHERE project_id = ? AND first_seen < ? ORDER BY first_seen DESC LIMIT 1",
    projectId,
    cur.first_seen,
  );
  if (!prev) return null;
  const work = (async () => {
    const head = cur.commit_sha || (await code.resolve(src, release, tagPairs(ev))).sha;
    const base = prev.commit_sha || (await code.resolve(src, prev.version, [])).sha;
    if (!head || !base || head === base) return null;
    // The stack's files in this source, as paths in the repository.
    const spots = new Map<string, { e: number; k: number }[]>();
    for (const { e, raw } of pairs(view, ev)) {
      const app = new Set(inAppFrames(raw));
      raw.forEach((f, k) => {
        const spot = app.has(f) ? matchFrame(sources, f) : null;
        if (spot && spot.source === primary) spots.set(spot.path, [...(spots.get(spot.path) ?? []), { e, k }]);
      });
    }
    const paths = [...spots.keys()];
    const reader = code.open(src);
    const { files: changed, commits } = await reader.changes(base, head, paths);
    for (const f of changed) for (const { e, k } of spots.get(f.path) ?? []) view.exceptions[e]!.frames[k]!.changed = f.status;
    return {
      from: { release: prev.version, sha: base },
      to: { release, sha: head },
      repo: src.repo,
      compareUrl: reader.compareLink(base, head),
      files: changed.map((f) => ({ path: f.path, status: f.status })),
      commits,
    } satisfies Suspects;
  })().catch(() => null);
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), LINK_TIMEOUT_MS))]);
}
