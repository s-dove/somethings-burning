import type { ChangedFile, Commit, Source } from "./source.js";

const TIMEOUT_MS = 10_000;
export const MAX_FILE_BYTES = 1_000_000;

// GitHubSource reads one repository on github.com or a GitHub Enterprise
// host through the REST API, so nothing is cloned.
export class GitHubSource implements Source {
  private host: string;
  private path: string; // owner/repo
  private api: string;

  constructor(
    repo: string, // host/owner/repo
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {
    const [host, ...rest] = repo.split("/");
    this.host = host!;
    this.path = rest.join("/");
    this.api = this.host === "github.com" ? "https://api.github.com" : `https://${this.host}/api/v3`;
  }

  private async get(path: string, accept: string): Promise<Response | null> {
    const headers: Record<string, string> = { Accept: accept, "User-Agent": "burning", "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchFn(`${this.api}/repos/${this.path}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new Error(`GitHub ${this.host} answered ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  // The "sha" media type answers with the bare commit id for any ref.
  async resolve(ref: string): Promise<string | null> {
    const res = await this.get(`/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha");
    const sha = res ? (await res.text()).trim() : "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  }

  async read(sha: string, path: string): Promise<string | null> {
    const res = await this.get(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`, "application/vnd.github.raw");
    if (!res) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return null;
    const text = await res.text();
    return text.length > MAX_FILE_BYTES ? null : text;
  }

  async diff(base: string, head: string, paths: string[]): Promise<ChangedFile[]> {
    const res = await this.get(`/compare/${base}...${head}`, "application/vnd.github+json");
    if (!res) return [];
    const body = (await res.json()) as { files?: { filename: string; status: string; patch?: string }[] };
    const wanted = new Set(paths);
    return (body.files ?? []).map((f) => ({ path: f.filename, status: f.status, patch: wanted.has(f.filename) ? (f.patch ?? "") : "" }));
  }

  /**
   * The stack's files that changed after base, and the commits that did it.
   * Asked per file, by date: the compare API lists at most 300 files, so a
   * long range between releases would miss them.
   */
  async changes(base: string, head: string, paths: string[]): Promise<{ files: { path: string; status: string }[]; commits: Commit[] }> {
    const b = await this.get(`/commits/${base}`, "application/vnd.github+json");
    const since = b ? ((await b.json()) as { commit?: { committer?: { date?: string } } }).commit?.committer?.date : undefined;
    if (!since) return { files: [], commits: [] };
    const files: { path: string; status: string }[] = [];
    const commits = new Map<string, Commit & { date: string }>();
    for (const p of paths.slice(0, 10)) {
      const r = await this.get(`/commits?sha=${head}&path=${encodeURIComponent(p)}&since=${encodeURIComponent(since)}&per_page=20`, "application/vnd.github+json");
      const list = r ? ((await r.json()) as { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } } }[]) : [];
      const after = list.filter((c) => c.sha !== base);
      if (!after.length) continue;
      files.push({ path: p, status: "modified" });
      for (const c of after) commits.set(c.sha, { sha: c.sha, message: c.commit.message.split("\n")[0]!, author: c.commit.author?.name ?? "", url: c.html_url, date: c.commit.author?.date ?? "" });
    }
    const sorted = [...commits.values()].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 20);
    return { files, commits: sorted.map(({ date: _, ...c }) => c) };
  }

  compareLink(base: string, head: string): string {
    return `https://${this.host}/${this.path}/compare/${base}...${head}`;
  }

  /** Opens an issue in this repository; returns its web URL. */
  async createIssue(title: string, body: string): Promise<string> {
    if (!this.token) throw new Error(`no token for ${this.host} (BURNING_GIT_CREDENTIALS)`);
    const res = await this.fetchFn(`${this.api}/repos/${this.path}/issues`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "User-Agent": "burning", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ title, body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub ${this.host} answered ${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { html_url: string }).html_url;
  }

  link(sha: string, path: string, line?: number): string {
    return `https://${this.host}/${this.path}/blob/${sha}/${path}${line ? `#L${line}` : ""}`;
  }
}
