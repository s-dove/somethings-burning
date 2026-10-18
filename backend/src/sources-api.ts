import { Hono, type Context } from "hono";
import { atLeast, type Access } from "./access.js";
import type { AppEnv } from "./api.js";
import type { Db } from "./db.js";
import { exceptions, type SentryEvent } from "./event.js";
import { inAppFrames } from "./grouping.js";
import { getProject } from "./projects.js";
import { checkSources, RELEASE_KINDS, type SourceConfig } from "./source/config.js";
import { matchFrame, type CodeSources } from "./source/index.js";
import { releaseOf, tagPairs } from "./source/links.js";
import { getSources, saveSources } from "./sources.js";

const TEST_FRAMES = 12;

/** A project's code sources. Anyone with a role reads them; admins change and test them. */
export function sourcesRoutes(db: Db, access: Access, code: CodeSources): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const base = "/projects/:id{[0-9]+}/sources";

  const load = (c: Context<AppEnv>) => {
    const id = Number(c.req.param("id"));
    const project = getProject(db, id);
    const role = project ? access.role(id, c.get("user")) : null;
    return project && role ? { project: { id: project.id, name: project.name, role }, id } : null;
  };

  const view = (c: Context<AppEnv>, found: NonNullable<ReturnType<typeof load>>) =>
    c.json({
      project: found.project,
      sources: getSources(db, found.id),
      releaseKinds: RELEASE_KINDS,
      // Hosts with a token, so the page can say which repositories can be read.
      hosts: code.credentials.hosts,
      sshKey: code.sshKey,
    });

  app.get(base, (c) => {
    const found = load(c);
    return found ? view(c, found) : c.json({ detail: "project not found" }, 404);
  });

  app.put(base, async (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    if (!atLeast(found.project.role, "admin")) return c.json({ detail: "changing code sources needs the admin role" }, 403);
    const checked = checkSources(await c.req.json().catch(() => null));
    if ("error" in checked) return c.json({ detail: checked.error }, 400);
    saveSources(db, found.id, checked.sources);
    return view(c, found);
  });

  // The test runs the given list (the page's unsaved draft) against the
  // project's latest stored event: how each source resolves the release, and
  // where each in-app frame lands.
  app.post(`${base}/test`, async (c) => {
    const found = load(c);
    if (!found) return c.json({ detail: "project not found" }, 404);
    if (!atLeast(found.project.role, "admin")) return c.json({ detail: "testing code sources needs the admin role" }, 403);
    const checked = checkSources(await c.req.json().catch(() => null));
    if ("error" in checked) return c.json({ detail: checked.error }, 400);
    const row = db.prepare("SELECT payload, issue_id, event_id FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(found.id) as
      | { payload: string; issue_id: number; event_id: string }
      | undefined;
    if (!row) return c.json({ event: null, sources: [], frames: [] });
    const ev = JSON.parse(row.payload) as SentryEvent;
    return c.json({ event: { issueId: row.issue_id, eventId: row.event_id, release: releaseOf(ev) }, ...(await testSources(code, checked.sources, ev)) });
  });

  return app;
}

async function testSources(code: CodeSources, sources: SourceConfig[], ev: SentryEvent) {
  const resolved = await Promise.all(
    sources.map((s) => code.resolve(s, releaseOf(ev), tagPairs(ev)).catch((err: Error) => ({ sha: "", ref: "", how: "", error: err.message }))),
  );
  const frames = [];
  for (const exc of [...exceptions(ev)].reverse()) {
    for (const f of [...inAppFrames(exc.stacktrace?.frames ?? [])].reverse()) {
      if (frames.length >= TEST_FRAMES) break;
      const spot = matchFrame(sources, f);
      const sha = spot ? resolved[spot.source]!.sha : "";
      let found: boolean | null = null;
      if (spot && sha) found = (await code.open(sources[spot.source]!).read(sha, spot.path).catch(() => null)) !== null;
      frames.push({
        location: f.abs_path || f.filename || f.module || "?",
        line: f.lineno ?? 0,
        source: spot?.source ?? null,
        path: spot?.path ?? "",
        found, // null: not tried
        link: spot && sha && found ? code.open(sources[spot.source]!).link(sha, spot.path, f.lineno) : "",
      });
    }
  }
  return { sources: resolved, frames };
}
