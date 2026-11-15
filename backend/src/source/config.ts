// A project's code sources: the repositories its stack frames come from.
// Each source maps frame path prefixes to directories in one repository and
// says how an event's release turns into a commit there.

export type SourceKind = "github" | "git";

// How a release becomes a ref to read code at. "auto" tries the usual shapes
// in turn; the others are one rule each. value is the rule's parameter: the
// tag template ("payments-api/v{version}"), the event tag name, or the regex.
export type ReleaseKind = "auto" | "sha" | "tag" | "vtag" | "template" | "event_tag" | "regex" | "branch";
export const RELEASE_KINDS: ReleaseKind[] = ["auto", "sha", "tag", "vtag", "template", "event_tag", "regex", "branch"];

export interface Mapping {
  prefix: string; // the start of the frame's path, as the SDK sends it
  dir: string; // where that is in the repository, "" for the root
}

export interface SourceConfig {
  kind: SourceKind;
  // github: host/owner/repo (github.com or an Enterprise host).
  // git: the clone URL, https or ssh.
  repo: string;
  branch: string; // used when the release gives no commit
  mappings: Mapping[];
  release: { kind: ReleaseKind; value: string };
  primary: boolean; // the service's own repository; diffs between releases use it
  context: string; // a file in the repo given to AI analysis, "" for none
  web: string; // git only: link template with {ref} {path} {line}, "" for no links
}

export const MAX_SOURCES = 20;

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// githubRepo accepts host/owner/repo or a web or clone URL and gives
// host/owner/repo, or "" when it is not one.
export function githubRepo(input: string): string {
  let s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  s = s.replace(/^git@([^:]+):/, "$1/").replace(/^(https?|ssh):\/\/(git@)?/, "");
  const parts = s.split("/");
  if (parts.length !== 3 || parts.some((p) => !/^[\w.-]+$/.test(p))) return "";
  return parts.join("/");
}

function gitURL(input: string): boolean {
  return /^(https?:\/\/|ssh:\/\/)[^\s]+$/.test(input) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(input);
}

// Paths in mappings and the context file must stay inside the repository.
const safePath = (p: string): boolean => !p.split("/").includes("..") && !p.startsWith("-");

// checkSources validates the whole list from the settings page.
export function checkSources(input: unknown): { sources: SourceConfig[] } | { error: string } {
  const list = (input as { sources?: unknown })?.sources;
  if (!Array.isArray(list)) return { error: "sources must be a list" };
  if (list.length > MAX_SOURCES) return { error: `at most ${MAX_SOURCES} sources` };
  const out: SourceConfig[] = [];
  for (const [i, raw] of list.entries()) {
    const n = `source ${i + 1}`;
    const o = (raw ?? {}) as Record<string, unknown>;
    const kind = o.kind === "git" ? "git" : o.kind === "github" ? "github" : null;
    if (!kind) return { error: `${n}: choose GitHub or Git` };
    let repo = str(o.repo);
    if (kind === "github") {
      repo = githubRepo(repo);
      if (!repo) return { error: `${n}: write the repository as host/owner/repo, like github.com/getsentry/sentry` };
    } else if (!gitURL(repo)) return { error: `${n}: write a clone URL, https:// or git@host:path` };
    const branch = str(o.branch, 200) || "main";
    if (!/^[\w./-]+$/.test(branch) || branch.startsWith("-")) return { error: `${n}: the branch name has characters git does not allow` };
    const mappings: Mapping[] = [];
    for (const m of Array.isArray(o.mappings) ? o.mappings : []) {
      const prefix = str((m as Mapping)?.prefix);
      const dir = str((m as Mapping)?.dir).replace(/^\/+|\/+$/g, "");
      if (!prefix) return { error: `${n}: each path mapping needs the start of the stack trace path` };
      if (!safePath(dir)) return { error: `${n}: the repository folder cannot contain ..` };
      mappings.push({ prefix, dir });
    }
    if (!mappings.length) return { error: `${n}: add at least one path mapping, so frames can find this repository` };
    const rk = RELEASE_KINDS.includes((o.release as { kind?: ReleaseKind })?.kind as ReleaseKind) ? (o.release as { kind: ReleaseKind }).kind : "auto";
    const rv = str((o.release as { value?: string })?.value, 200);
    if (rk === "template" && !rv.includes("{version}")) return { error: `${n}: the tag template needs {version}` };
    if (rk === "event_tag" && !rv) return { error: `${n}: name the event tag that holds the commit` };
    if (rk === "regex") {
      let ok = /\((?!\?)/.test(rv);
      try {
        new RegExp(rv);
      } catch {
        ok = false;
      }
      if (!ok) return { error: `${n}: the release regex needs one capture group around the commit or tag` };
    }
    const context = str(o.context, 300).replace(/^\/+/, "");
    if (!safePath(context)) return { error: `${n}: the context file path cannot contain ..` };
    const web = kind === "git" ? str(o.web) : "";
    if (web && !/^https?:\/\//.test(web)) return { error: `${n}: the link template must start with http:// or https://` };
    out.push({ kind, repo, branch, mappings, release: { kind: rk, value: rk === "template" || rk === "event_tag" || rk === "regex" ? rv : "" }, primary: o.primary === true, context, web });
  }
  if (out.filter((s) => s.primary).length > 1) return { error: "only one source can be the primary one" };
  if (out.length && !out.some((s) => s.primary)) out[0]!.primary = true;
  return { sources: out };
}
