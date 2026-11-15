// Source is one repository Burning can read, whatever hosts it.
export interface ChangedFile {
  path: string;
  status: string; // added, modified, removed, renamed
  patch: string; // the diff, only for the paths asked about
}

export interface Source {
  resolve(ref: string): Promise<string | null>; // a commit, tag, or branch to a full commit id
  read(sha: string, path: string): Promise<string | null>; // null: no such file, or too big
  diff(base: string, head: string, paths: string[]): Promise<ChangedFile[]>;
  link(sha: string, path: string, line?: number): string; // "" when there is no web view
}

// Credentials maps a host to its token, from git-credentials lines like
// https://user:token@github.example.com. A line with only a user part uses it
// as the token.
export class Credentials {
  private byHost = new Map<string, string>();
  constructor(readonly lines: string) {
    for (const line of lines.split(/[\n,]/).map((l) => l.trim()).filter(Boolean)) {
      try {
        const u = new URL(line);
        const token = decodeURIComponent(u.password || u.username);
        if (token) this.byHost.set(u.hostname.toLowerCase(), token);
      } catch {
        // not a URL: skipped
      }
    }
  }
  token(host: string): string {
    const h = host.toLowerCase();
    // github.com tokens also serve its API host.
    return this.byHost.get(h) ?? (h === "api.github.com" ? (this.byHost.get("github.com") ?? "") : "");
  }
  get hosts(): string[] {
    return [...this.byHost.keys()].sort();
  }
}
