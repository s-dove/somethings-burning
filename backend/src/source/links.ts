import { exceptions, type SentryEvent } from "../event.js";
import type { EventView } from "../event-view.js";
import { inAppFrames } from "../grouping.js";
import type { SourceConfig } from "./config.js";
import { matchFrame, type CodeSources } from "./index.js";

const LINK_TIMEOUT_MS = 4000;

/** The event's tags as pairs, for release rules that read one. */
export function tagPairs(ev: SentryEvent): [string, string][] {
  const t = ev.tags as Record<string, unknown> | [string, unknown][] | undefined;
  if (!t) return [];
  return (Array.isArray(t) ? t : Object.entries(t)).map(([k, v]) => [String(k), String(v ?? "")]);
}

export const releaseOf = (ev: SentryEvent): string => (typeof ev.release === "string" ? ev.release : "");

/**
 * Gives each frame of the issue page a link to its line in the repository,
 * at the commit the release resolves to. Only the app's own frames get one
 * (every frame when the SDK marked none): library frames are not in the
 * repository even when a broad mapping covers their path. It gives up quietly
 * after a few seconds, so a slow git host never holds the page.
 */
export async function attachLinks(view: EventView, ev: SentryEvent, sources: SourceConfig[], code: CodeSources): Promise<void> {
  if (!sources.length) return;
  const chain = exceptions(ev);
  const shas = new Map<number, Promise<string>>();
  const sha = (i: number) => {
    let p = shas.get(i);
    if (!p) shas.set(i, (p = code.resolve(sources[i]!, releaseOf(ev), tagPairs(ev)).then((r) => r.sha, () => "")));
    return p;
  };
  const work = view.exceptions.map(async (exc, e) => {
    // The view lists exceptions and frames newest first; the event, oldest first.
    const raw = [...(chain[chain.length - 1 - e]?.stacktrace?.frames ?? [])].reverse();
    const app = new Set(inAppFrames(raw));
    await Promise.all(
      exc.frames.map(async (fv, k) => {
        const f = raw[k];
        const spot = f && app.has(f) && matchFrame(sources, f);
        if (!spot) return;
        const commit = await sha(spot.source);
        if (commit) fv.link = code.open(sources[spot.source]!).link(commit, spot.path, f.lineno || undefined);
      }),
    );
  });
  await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, LINK_TIMEOUT_MS))]);
}
