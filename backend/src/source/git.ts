import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES } from "./github.js";
import type { ChangedFile, Commit, Source } from "./source.js";

const FETCH_EVERY_MS = 5 * 60_000;
const CLONE_TIMEOUT_MS = 120_000;
const TIMEOUT_MS = 30_000;

export interface GitOptions {
  dir: string; // where mirrors live
  credentials: string; // git-credentials lines, may be ""
  sshKey: string; // path to a private key, may be ""
}

// One mirror per URL across the process, so clones and fetches are shared.
const mirrors = new Map<string, { ready: Promise<void> | null; fetchedAt: number; fetching: Promise<void> | null }>();

// GitMirror reads a repository on any git server from a bare, blobless
// clone on local disk: history comes down at once, file contents only when
// read. Unknown refs trigger a fetch, at most every few minutes.
export class GitMirror implements Source {
  private dir: string;
  private env: NodeJS.ProcessEnv;
  private config: string[];

  constructor(
    private url: string,
    private web: string, // link template, may be ""
    opts: GitOptions,
  ) {
    mkdirSync(opts.dir, { recursive: true });
    this.dir = path.join(opts.dir, `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.git`);
    this.env = { PATH: process.env.PATH, HOME: opts.dir, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };
    if (opts.sshKey) this.env.GIT_SSH_COMMAND = `ssh -i ${opts.sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(opts.dir, "known_hosts")}`;
    this.config = ["-c", "credential.helper=", "-c", "protocol.file.allow=never"];
    if (opts.credentials) {
      const file = path.join(opts.dir, ".credentials");
      writeFileSync(file, opts.credentials.split(/[\n,]/).map((l) => l.trim()).filter(Boolean).join("\n") + "\n", { mode: 0o600 });
      this.config.push("-c", `credential.helper=store --file=${file}`);
    }
  }

  private run(args: string[], timeout = TIMEOUT_MS, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", [...this.config, ...(cwd ? [] : ["-C", this.dir]), ...args], { env: this.env, cwd, timeout, maxBuffer: 8 * MAX_FILE_BYTES }, (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]}: ${(stderr || err.message).trim().split("\n").pop()}`));
        else resolve(stdout);
      });
    });
  }

  private state() {
    let s = mirrors.get(this.dir);
    if (!s) mirrors.set(this.dir, (s = { ready: null, fetchedAt: 0, fetching: null }));
    return s;
  }

  private ensure(): Promise<void> {
    const s = this.state();
    if (!s.ready) {
      s.ready = existsSync(this.dir)
        ? Promise.resolve()
        : this.run(["clone", "--bare", "--filter=blob:none", "--", this.url, this.dir], CLONE_TIMEOUT_MS, path.dirname(this.dir)).then(() => {
            s.fetchedAt = Date.now();
          });
      s.ready.catch(() => (s.ready = null));
    }
    return s.ready;
  }

  private fetch(): Promise<void> {
    const s = this.state();
    if (s.fetching) return s.fetching;
    if (Date.now() - s.fetchedAt < FETCH_EVERY_MS) return Promise.resolve();
    s.fetching = this.run(["fetch", "--prune", "--tags", "--filter=blob:none", "origin", "+refs/heads/*:refs/heads/*"], CLONE_TIMEOUT_MS)
      .then(() => undefined)
      .finally(() => {
        s.fetchedAt = Date.now();
        s.fetching = null;
      });
    return s.fetching;
  }

  private async revParse(ref: string): Promise<string | null> {
    const out = await this.run(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).catch(() => "");
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  }

  async resolve(ref: string): Promise<string | null> {
    await this.ensure();
    const found = await this.revParse(ref);
    if (found) return found;
    await this.fetch().catch(() => undefined);
    return this.revParse(ref);
  }

  async read(sha: string, file: string): Promise<string | null> {
    await this.ensure();
    const size = Number((await this.run(["cat-file", "-s", `${sha}:${file}`]).catch(() => "")).trim());
    if (!size || size > MAX_FILE_BYTES) return null;
    return this.run(["cat-file", "blob", `${sha}:${file}`]).catch(() => null);
  }

  async diff(base: string, head: string, paths: string[]): Promise<ChangedFile[]> {
    await this.ensure();
    const names = await this.run(["diff", "--name-status", "--no-renames", base, head]);
    const STATUS: Record<string, string> = { A: "added", M: "modified", D: "removed" };
    const files = names.split("\n").filter(Boolean).map((l) => {
      const [s, p] = l.split("\t");
      return { path: p ?? "", status: STATUS[s ?? ""] ?? "modified", patch: "" };
    });
    const wanted = files.filter((f) => paths.includes(f.path));
    for (const f of wanted) f.patch = await this.run(["diff", base, head, "--", f.path]).catch(() => "");
    return files;
  }

  async changes(base: string, head: string, paths: string[]): Promise<{ files: { path: string; status: string }[]; commits: Commit[] }> {
    if (!paths.length) return { files: [], commits: [] };
    await this.ensure();
    const STATUS: Record<string, string> = { A: "added", M: "modified", D: "removed" };
    const names = await this.run(["diff", "--name-status", "--no-renames", base, head, "--", ...paths]).catch(() => "");
    const files = names
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [st, p] = l.split("\t");
        return { path: p ?? "", status: STATUS[st ?? ""] ?? "modified" };
      });
    if (!files.length) return { files, commits: [] };
    const out = await this.run(["log", "--max-count=20", "--format=%H%x1f%an%x1f%s", `${base}..${head}`, "--", ...files.map((f) => f.path)]).catch(() => "");
    const commits = out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [sha = "", author = "", message = ""] = l.split("\x1f");
        return { sha, author, message, url: this.web ? this.web.replace(/\/(src|blob|tree)\/\{ref\}.*$/, `/commit/${sha}`) : "" };
      });
    return { files, commits };
  }

  compareLink(): string {
    return "";
  }

  link(sha: string, file: string, line?: number): string {
    if (!this.web) return "";
    return this.web.replaceAll("{ref}", sha).replaceAll("{path}", file).replaceAll("{line}", String(line ?? 1));
  }
}
