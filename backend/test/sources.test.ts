import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { eventView } from "../src/event-view.js";
import { recordEvent } from "../src/issues.js";
import { checkSources, githubRepo, type SourceConfig } from "../src/source/config.js";
import { CodeSources, matchFrame } from "../src/source/index.js";
import { attachLinks } from "../src/source/links.js";
import { refCandidates, splitRelease } from "../src/source/release.js";
import { as, json, setup } from "./helpers.js";

const refs = (kind: Parameters<typeof refCandidates>[0]["kind"], release: string, value = "", tags: [string, string][] = []) =>
  refCandidates({ kind, value }, release, tags).map((c) => c.ref);

const src = (repo: string, mappings: SourceConfig["mappings"]): SourceConfig => ({
  kind: "github",
  repo,
  branch: "main",
  mappings,
  release: { kind: "auto", value: "" },
  primary: false,
  context: "",
  web: "",
});

const SHA = "b".repeat(40);
/** A GitHub API that knows one commit and one file. */
const fakeGitHub = (calls: string[] = []): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/commits/")) return url.includes("/commits/v9.9.9") ? new Response("", { status: 404 }) : new Response(SHA);
    if (url.includes("/contents/backend/app/x.py")) return new Response("print('hi')\n");
    return new Response("", { status: 404 });
  }) as typeof fetch;

const event = {
  release: "app@1.2.0+abc1234",
  exception: {
    values: [
      {
        type: "KeyError",
        value: "'id'",
        stacktrace: {
          frames: [
            { filename: "starlette/routing.py", abs_path: "/usr/lib/starlette/routing.py", lineno: 74, in_app: false },
            { filename: "app/x.py", abs_path: "/backend/app/x.py", lineno: 5, in_app: true },
          ],
        },
      },
    ],
  },
};

describe("code sources", () => {
  it("splits releases the Sentry way", () => {
    expect(splitRelease("payments-api@2.15.0+3e7cbf4")).toEqual({ version: "2.15.0+3e7cbf4", base: "2.15.0", build: "3e7cbf4" });
    expect(splitRelease("@scope/pkg@1.2.0").base).toBe("1.2.0");
    expect(splitRelease("v3").base).toBe("v3");
  });

  it("turns releases into refs under each rule", () => {
    expect(refs("auto", "api@2.15.0+3e7cbf4")).toEqual(["3e7cbf4", "2.15.0", "v2.15.0"]);
    expect(refs("auto", "3e7cbf44d1a2")).toEqual(["3e7cbf44d1a2", "v3e7cbf44d1a2"]);
    expect(refs("auto", "v2.1.0-12-g3e7cbf4")).toEqual(["3e7cbf4", "v2.1.0-12-g3e7cbf4"]);
    expect(refs("auto", "")).toEqual([]);
    expect(refs("sha", "api@2.15.0")).toEqual([]);
    expect(refs("tag", "api@2.15.0+abc1234")).toEqual(["2.15.0"]);
    expect(refs("vtag", "api@2.15.0")).toEqual(["v2.15.0"]);
    expect(refs("template", "api@v2.15.0", "payments-api/v{version}")).toEqual(["payments-api/v2.15.0"]);
    expect(refs("event_tag", "x", "commit", [["commit", "abcdef1"]])).toEqual(["abcdef1"]);
    expect(refs("regex", "build-77-sha-abcdef1", "sha-([0-9a-f]+)")).toEqual(["abcdef1"]);
    expect(refs("branch", "api@1.0")).toEqual([]);
    // Nothing that could be read as a git option or leave the ref space.
    expect(refs("event_tag", "x", "commit", [["commit", "--upload-pack=x"]])).toEqual([]);
    expect(refs("tag", "a..b")).toEqual([]);
  });

  it("matches frames by the longest prefix across sources", () => {
    const sources = [src("github.com/a/app", [{ prefix: "/srv/app/", dir: "backend" }]), src("github.com/a/lib", [{ prefix: "/srv/app/vendor/lib/", dir: "" }])];
    expect(matchFrame(sources, { abs_path: "/srv/app/pay/charge.py", filename: "pay/charge.py" })).toEqual({ source: 0, path: "backend/pay/charge.py" });
    expect(matchFrame(sources, { abs_path: "/srv/app/vendor/lib/x.py", filename: "" })).toEqual({ source: 1, path: "x.py" });
    expect(matchFrame(sources, { abs_path: "/usr/lib/python3/json.py", filename: "json.py" })).toBeNull();
    expect(matchFrame(sources, { abs_path: "/srv/app/../../etc/passwd", filename: "" })).toBeNull();
  });

  it("checks the list from the settings page", () => {
    expect(githubRepo("https://github.example.com/team/app.git")).toBe("github.example.com/team/app");
    expect(githubRepo("git@github.com:getsentry/sentry.git")).toBe("github.com/getsentry/sentry");
    expect(githubRepo("getsentry/sentry")).toBe("");
    const ok = checkSources({
      sources: [
        { kind: "github", repo: "https://github.com/a/b", mappings: [{ prefix: "/app/", dir: "/src/" }] },
        { kind: "git", repo: "git@git.example.com:team/lib.git", mappings: [{ prefix: "/lib/", dir: "" }], release: { kind: "template", value: "lib/v{version}" } },
      ],
    });
    expect("sources" in ok && ok.sources.map((s) => [s.repo, s.primary, s.mappings[0]!.dir, s.branch])).toEqual([
      ["github.com/a/b", true, "src", "main"],
      ["git@git.example.com:team/lib.git", false, "", "main"],
    ]);
    const bad = (s: unknown) => (checkSources({ sources: [s] }) as { error?: string }).error ?? "";
    expect(bad({ kind: "github", repo: "a/b", mappings: [{ prefix: "/a" }] })).toMatch(/host\/owner\/repo/);
    expect(bad({ kind: "git", repo: "/local/path", mappings: [{ prefix: "/a" }] })).toMatch(/clone URL/);
    expect(bad({ kind: "github", repo: "github.com/a/b", mappings: [] })).toMatch(/path mapping/);
    expect(bad({ kind: "github", repo: "github.com/a/b", mappings: [{ prefix: "/a", dir: "../x" }] })).toMatch(/\.\./);
    expect(bad({ kind: "github", repo: "github.com/a/b", mappings: [{ prefix: "/a" }], release: { kind: "regex", value: "no-group" } })).toMatch(/capture group/);
    expect(bad({ kind: "github", repo: "github.com/a/b", branch: "--evil", mappings: [{ prefix: "/a" }] })).toMatch(/branch/);
  });

  it("reads tokens by host from git-credentials lines", () => {
    const code = new CodeSources({ credentials: "https://x:tok1@github.example.com, https://tok2@github.com", sshKey: "", dir: "" }, ":memory:");
    expect(code.credentials.hosts).toEqual(["github.com", "github.example.com"]);
    expect(code.credentials.token("api.github.com")).toBe("tok2");
  });
});

describe("frame links", () => {
  it("links the app's frames and leaves library frames alone, even under a broad mapping", async () => {
    const code = new CodeSources({ credentials: "", sshKey: "", dir: "" }, ":memory:", fakeGitHub());
    const view = eventView({ id: 1, eventId: "e", receivedAt: 0, release: "", environment: "", payload: event });
    await attachLinks(view, event, [src("github.com/a/app", [{ prefix: "/", dir: "" }])], code);
    expect(view.exceptions[0]!.frames.map((f) => f.link)).toEqual([`https://github.com/a/app/blob/${SHA}/backend/app/x.py#L5`, ""]);
  });

  it("serves sources to anyone with a role, lets admins save and test them, and links frames on the issue page", async () => {
    const calls: string[] = [];
    const s = setup({ auth: true, code: new CodeSources({ credentials: "https://x:tok@github.com", sshKey: "", dir: "" }, ":memory:", fakeGitHub(calls)) });
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    setGrant(s.db, s.project.id, "user", "bo@example.com", "member");
    const { issueId } = recordEvent(s.db, s.project.id, event);
    const url = `/api/projects/${s.project.id}/sources`;
    const list = [{ kind: "github", repo: "github.com/a/app", mappings: [{ prefix: "/", dir: "" }] }];

    expect((await s.app.request(url, { method: "PUT", ...json({ sources: list }, as("bo@example.com")) })).status).toBe(403);
    const saved = (await (await s.app.request(url, { method: "PUT", ...json({ sources: list }, as("ana@example.com")) })).json()) as {
      sources: SourceConfig[];
      hosts: string[];
    };
    expect(saved.sources[0]).toMatchObject({ repo: "github.com/a/app", primary: true, branch: "main" });
    expect(saved.hosts).toEqual(["github.com"]);
    expect(((await (await s.app.request(url, { headers: as("bo@example.com") })).json()) as { sources: unknown[] }).sources).toHaveLength(1);

    const test = (await (await s.app.request(`${url}/test`, { method: "POST", ...json({ sources: list }, as("ana@example.com")) })).json()) as {
      event: { release: string };
      sources: { sha: string; how: string }[];
      frames: { location: string; path: string; found: boolean | null }[];
    };
    expect(test.event.release).toBe("app@1.2.0+abc1234");
    expect(test.sources[0]).toMatchObject({ sha: SHA, how: "commit after + in the release" });
    expect(test.frames).toEqual([expect.objectContaining({ location: "/backend/app/x.py", path: "backend/app/x.py", found: true })]);

    const detail = (await (await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`, { headers: as("bo@example.com") })).json()) as {
      event: { exceptions: { frames: { link: string }[] }[] };
    };
    expect(detail.event.exceptions[0]!.frames[0]!.link).toBe(`https://github.com/a/app/blob/${SHA}/backend/app/x.py#L5`);
    // GitHub got the token for its host.
    expect(calls.some((u) => u.startsWith("https://api.github.com/repos/a/app/commits/abc1234"))).toBe(true);
  });
});
