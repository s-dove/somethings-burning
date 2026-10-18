import type { ChangedFile, Source } from "./source.js";

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

  link(sha: string, path: string, line?: number): string {
    return `https://${this.host}/${this.path}/blob/${sha}/${path}${line ? `#L${line}` : ""}`;
  }
}
