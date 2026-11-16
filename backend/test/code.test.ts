import { describe, expect, it } from "vitest";
import { getIssue, recordEvent } from "../src/issues.js";
import { CodeSources } from "../src/source/index.js";
import { json, setup } from "./helpers.js";

const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const APP_PY = ["import os", "", "def ratio(a, b):", "    # the bug", "    return a / b", "", "def main():", "    ratio(1, 0)"].join("\n");

/** A GitHub API for one repository: two releases, one file, a compare, and issues. */
function fakeGitHub(calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const ok = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body));
    if (/\/commits\/[0-9a-f]{40}$/.test(url)) return ok({ sha: url.slice(-40), commit: { committer: { date: "2026-01-01T00:00:00Z" } } });
    if (url.includes("/commits/")) {
      if (/commits\/(v?1\.0\.0)$/.test(url)) return ok(SHA1);
      if (/commits\/(v?2\.0\.0)$/.test(url)) return ok(SHA2);
      return new Response("", { status: 404 });
    }
    if (url.includes("/contents/app/views.py")) return ok(APP_PY);
    if (url.includes(`/compare/${SHA1}...${SHA2}`))
      return ok({ files: [{ filename: "app/views.py", status: "modified", patch: "@@" }, { filename: "README.md", status: "modified" }], commits: [{ sha: "c".repeat(40), html_url: "https://github.com/acme/app/commit/ccc", commit: { message: "Use a / b\n\nbody", author: { name: "Ana" } } }] });
    if (url.includes("/commits?sha=") && url.includes("path=app%2Fviews.py") && url.includes("since="))
      return ok([{ sha: "c".repeat(40), html_url: "https://github.com/acme/app/commit/ccc", commit: { message: "Use a / b\n\nbody", author: { name: "Ana", date: "2026-02-01T00:00:00Z" } } }]);
    if (url.includes("/commits?sha=")) return ok([]);
    if (url.endsWith("/repos/acme/app/issues") && init?.method === "POST") return ok({ html_url: "https://github.com/acme/app/issues/7" });
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

const source = { kind: "github", repo: "github.com/acme/app", branch: "main", mappings: [{ prefix: "/srv/", dir: "" }], release: { kind: "auto", value: "" }, primary: true };
const appEvent = (release: string) => ({
  release,
  exception: { values: [{ type: "ZeroDivisionError", value: "division by zero", stacktrace: { frames: [{ filename: "app/views.py", abs_path: "/srv/app/views.py", function: "ratio", lineno: 5, in_app: true }] } }] },
});

async function withSource() {
  const calls: string[] = [];
  const s = await setup({ code: new CodeSources({ credentials: "https://x:tok@github.com", sshKey: "", dir: "" }, ":memory:", fakeGitHub(calls)) });
  await s.app.request(`/api/projects/${s.project.id}/sources`, { method: "PUT", ...json({ sources: [source] }) });
  return { ...s, calls };
}

type Detail = {
  issue: { id: number; assignee: string; externalUrl: string };
  event: { exceptions: { frames: { location: string; function: string; lineno: number; lines: { no: number; text: string; current: boolean }[]; linesFrom: string; mapped: string; changed: string; link: string }[] }[] };
  tags: { key: string; total: number; values: { value: string; count: number }[] }[];
  users: number;
  merged: { fingerprint: string; title: string }[];
  suspects: { from: { release: string }; to: { release: string }; files: { path: string; status: string }[]; commits: { message: string; author: string }[]; compareUrl: string } | null;
  github: boolean;
};
const detail = async (s: Awaited<ReturnType<typeof setup>>, issueId: number) => (await (await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`)).json()) as Detail;

describe("code lines from the repository", () => {
  it("fills in the lines around a frame the SDK sent without them", async () => {
    const s = await withSource();
    const { issueId } = await recordEvent(s.db, s.project.id, appEvent("app@1.0.0"));
    const f = (await detail(s, issueId)).event.exceptions[0]!.frames[0]!;
    expect(f.linesFrom).toBe(`github.com/acme/app@${SHA1.slice(0, 7)}`);
    expect(f.lines.find((l) => l.current)).toEqual({ no: 5, text: "    return a / b", current: true });
    expect(f.lines[0]!.no).toBe(1);
  });
});

describe("suspect changes", () => {
  it("names the stack's files that changed since the previous release, and the commits", async () => {
    const s = await withSource();
    const t = Date.now();
    await recordEvent(s.db, s.project.id, { message: "older" , release: "app@1.0.0" }, t - 60_000);
    const { issueId } = await recordEvent(s.db, s.project.id, appEvent("app@2.0.0"), t);
    const d = await detail(s, issueId);
    expect(d.suspects).toMatchObject({ from: { release: "app@1.0.0" }, to: { release: "app@2.0.0" }, files: [{ path: "app/views.py", status: "modified" }] });
    expect(d.suspects!.commits).toEqual([expect.objectContaining({ message: "Use a / b", author: "Ana" })]);
    expect(d.suspects!.compareUrl).toBe(`https://github.com/acme/app/compare/${SHA1}...${SHA2}`);
    // Asked per file since the base commit, not through the compare API (300 files at most).
    expect(s.calls.some((c) => c.includes("/commits?sha=") && c.includes("since="))).toBe(true);
    expect(d.event.exceptions[0]!.frames[0]!.changed).toBe("modified");
  });

  it("has nothing to say without a previous release", async () => {
    const s = await withSource();
    const { issueId } = await recordEvent(s.db, s.project.id, appEvent("app@2.0.0"));
    expect((await detail(s, issueId)).suspects).toBeNull();
  });
});

describe("GitHub issues", () => {
  it("opens a GitHub issue from an issue, once", async () => {
    const s = await withSource();
    const { issueId } = await recordEvent(s.db, s.project.id, appEvent("app@1.0.0"));
    expect((await detail(s, issueId)).github).toBe(true);
    const res = await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/github`, { method: "POST" });
    expect(await res.json()).toEqual({ url: "https://github.com/acme/app/issues/7" });
    expect((await getIssue(s.db, s.project.id, issueId))!.externalUrl).toBe("https://github.com/acme/app/issues/7");
    expect(s.calls.some((c) => c.startsWith("POST https://api.github.com/repos/acme/app/issues"))).toBe(true);
    expect((await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/github`, { method: "POST" })).status).toBe(409);
    // Another one, asked for on purpose; both are listed, newest first.
    const again = await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/github`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ again: true }) });
    expect(again.status).toBe(200);
    const list = ((await detail(s, issueId)) as unknown as { githubIssues: { url: string; at: number }[] }).githubIssues;
    expect(list.map((g) => g.url)).toEqual(["https://github.com/acme/app/issues/7", "https://github.com/acme/app/issues/7"]);
    expect(list[0]!.at).toBeGreaterThanOrEqual(list[1]!.at);
  });
});
