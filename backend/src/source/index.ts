import os from "node:os";
import path from "node:path";
import type { Frame } from "../event.js";
import type { SourceConfig } from "./config.js";
import { GitMirror } from "./git.js";
import { GitHubSource } from "./github.js";
import { refCandidates } from "./release.js";
import { Credentials, type Source } from "./source.js";

const RESOLVE_TTL_MS = 10 * 60_000;

export interface Resolved {
  sha: string; // "" when nothing resolved, not even the branch
  ref: string; // what was asked for
  how: string; // why: "commit after + in the release", "default branch", ...
  error: string; // the last failure, when nothing resolved
}

export interface FrameSpot {
  source: number; // index in the project's list
  path: string; // the file in the repository
}

type FramePath = Pick<Frame, "abs_path" | "filename">;

// The paths a frame can be matched by, most specific first.
const framePaths = (f: FramePath): string[] => [f.abs_path ?? "", f.filename ?? ""].filter(Boolean);

/**
 * Finds the source whose mapping has the longest prefix of the frame's path,
 * so a vendored library under the app's own folder still finds its own
 * repository. Frames no mapping covers get null.
 */
export function matchFrame(sources: SourceConfig[], f: FramePath): FrameSpot | null {
  let best: { len: number; spot: FrameSpot } | null = null;
  for (const p of framePaths(f)) {
    sources.forEach((s, i) => {
      for (const m of s.mappings) {
        if (!p.startsWith(m.prefix) || (best && best.len >= m.prefix.length)) continue;
        const rest = p.slice(m.prefix.length).replace(/^\/+/, "");
        const file = path.posix.normalize([m.dir, rest].filter(Boolean).join("/"));
        if (!rest || file.startsWith("..")) continue;
        best = { len: m.prefix.length, spot: { source: i, path: file } };
      }
    });
  }
  return (best as { spot: FrameSpot } | null)?.spot ?? null;
}

/**
 * CodeSources opens repositories and resolves releases for the whole server.
 * Readers and answers are cached: a page view does not call GitHub each time.
 */
export class CodeSources {
  readonly credentials: Credentials;
  readonly sshKey: boolean;
  private readers = new Map<string, Source>();
  private resolved = new Map<string, { at: number; value: Resolved }>();

  constructor(
    private git: { credentials: string; sshKey: string; dir: string },
    dbPath: string,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.credentials = new Credentials(git.credentials);
    this.sshKey = !!git.sshKey;
    // Mirrors are a cache next to the database file.
    this.git.dir = git.dir || (dbPath === ":memory:" ? path.join(os.tmpdir(), "burning-git") : path.join(path.dirname(path.resolve(dbPath)), "git"));
  }

  open(s: SourceConfig): Source {
    const key = `${s.kind}|${s.repo}|${s.web}`;
    let r = this.readers.get(key);
    if (!r) {
      r =
        s.kind === "github"
          ? new GitHubSource(s.repo, this.credentials.token(s.repo.split("/")[0]!), this.fetchFn)
          : new GitMirror(s.repo, s.web, { dir: this.git.dir, credentials: this.git.credentials, sshKey: this.git.sshKey });
      this.readers.set(key, r);
    }
    return r;
  }

  /** Turns an event's release into a commit in this source: each candidate from the release rule in turn, then the default branch. */
  async resolve(s: SourceConfig, release: string, tags: [string, string][]): Promise<Resolved> {
    const candidates = [...refCandidates(s.release, release, tags), { ref: s.branch, how: "default branch" }];
    const key = `${s.kind}|${s.repo}|${candidates.map((c) => c.ref).join(",")}`;
    const hit = this.resolved.get(key);
    if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;
    const reader = this.open(s);
    let value: Resolved = { sha: "", ref: s.branch, how: "default branch", error: "" };
    for (const c of candidates) {
      try {
        const sha = await reader.resolve(c.ref);
        if (sha) {
          value = { sha, ref: c.ref, how: c.how, error: "" };
          break;
        }
      } catch (err) {
        value.error = (err as Error).message;
      }
    }
    if (!value.sha && !value.error) value.error = `none of ${candidates.map((c) => c.ref).join(", ")} exists in ${s.repo}`;
    this.resolved.set(key, { at: Date.now(), value });
    return value;
  }
}
