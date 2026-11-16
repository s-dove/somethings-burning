import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { listActivity } from "../src/activity.js";
import { board } from "../src/board.js";
import { sendDueDigests, digestFor } from "../src/digest.js";
import { recordEvent, getIssue, resolve } from "../src/issues.js";
import { mergedInto, tagBreakdown, usersAffected } from "../src/issue-extras.js";
import { planFor, summary } from "../src/notify/plan.js";
import { checkRoutes, factsOf } from "../src/notify/routing.js";
import { saveRouting, savePersonalRoutes } from "../src/notify/store.js";
import { listReleases } from "../src/releases.js";
import { FILTERED, scrubEvent } from "../src/scrub.js";
import { getConfig, saveConfig } from "../src/settings.js";
import { CodeSources } from "../src/source/index.js";
import { getUser } from "../src/users.js";
import { as, json, pythonError, setup, signIn } from "./helpers.js";

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

describe("1. code lines from the repository", () => {
  it("fills in the lines around a frame the SDK sent without them", async () => {
    const s = await withSource();
    const { issueId } = await recordEvent(s.db, s.project.id, appEvent("app@1.0.0"));
    const f = (await detail(s, issueId)).event.exceptions[0]!.frames[0]!;
    expect(f.linesFrom).toBe(`github.com/acme/app@${SHA1.slice(0, 7)}`);
    expect(f.lines.find((l) => l.current)).toEqual({ no: 5, text: "    return a / b", current: true });
    expect(f.lines[0]!.no).toBe(1);
  });
});

describe("2. suspect changes", () => {
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

describe("3. tags and users", () => {
  it("counts each tag value and the distinct users an issue reached", async () => {
    const s = await setup();
    const ev = (browser: string, user: string) => ({ ...pythonError, environment: "production", tags: { region: "eu" }, contexts: { browser: { name: browser, version: "131" } }, user: { id: user } });
    let id = 0;
    for (const [b, u] of [["Chrome", "1"], ["Chrome", "2"], ["Firefox", "1"]] as const) id = (await recordEvent(s.db, s.project.id, ev(b, u))).issueId;
    const tags = await tagBreakdown(s.db, id);
    expect(tags.map((t) => t.key)).toEqual(["environment", "browser", "level", "region"]);
    expect(tags.find((t) => t.key === "browser")!.values).toEqual([{ value: "Chrome 131", count: 2 }, { value: "Firefox 131", count: 1 }]);
    expect(await usersAffected(s.db, id)).toBe(2);
    expect((await detail(s, id)).users).toBe(2);
    // No level sent: no level tag, rather than a made-up "error".
    const bare = await recordEvent(s.db, s.project.id, { message: "no level here" });
    expect((await tagBreakdown(s.db, bare.issueId)).map((t) => t.key)).not.toContain("level");
  });
});

describe("4. releases and deploys", () => {
  it("lists releases with their events, new issues, regressions, and deploys", async () => {
    const s = await setup();
    const t = Date.now();
    const a = await recordEvent(s.db, s.project.id, { ...pythonError, release: "web@1" }, t - 10_000);
    await resolve(s.db, s.project.id, a.issueId);
    await recordEvent(s.db, s.project.id, { ...pythonError, release: "web@2" }, t - 5000);
    await recordEvent(s.db, s.project.id, { message: "new in 2", release: "web@2" }, t - 4000);
    await s.app.request(`/api/projects/${s.project.id}/deploys`, { method: "POST", ...json({ release: "web@2", environment: "production" }) });
    const list = await listReleases(s.db, s.project.id);
    expect(list.map((r) => [r.version, r.events, r.issues, r.newIssues, r.regressions, r.deploys.length])).toEqual([
      ["web@2", 2, 2, 1, 1, 1],
      ["web@1", 1, 1, 1, 0, 0],
    ]);
    // The board narrows to one release's issues.
    expect((await board(s.db, { status: "all", sort: "latest", q: "", release: "web@1" })).issues).toHaveLength(1);
  });
});

describe("5. assignment and ownership", () => {
  it("assigns by hand and by ownership rule, and the assignee receiver reaches them", async () => {
    const s = await setup();
    await signIn(s.db, "ana@example.com");
    const cfg = await getConfig(s.db, s.project.id);
    await saveConfig(s.db, s.project.id, { ...cfg, owners: [{ field: "path", pattern: "^app/", owner: "ana@example.com" }] });
    await saveRouting(s.db, s.project.id, [{ name: "owner", matchers: [{ field: "level", op: "=~", value: ".*" }], sink: false, continue: false, receivers: [{ kind: "assignee", target: "" }] }]);
    await s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, { method: "POST", headers: { host: "b.example.com" }, body: JSON.stringify(pythonError) });
    await s.queue.idle();
    await s.outbox.drain();
    const issue = (await getIssue(s.db, s.project.id, 1))!;
    expect(issue.assignee).toBe("ana@example.com");
    expect(s.senders.sent.map((x) => x.d.target)).toEqual(["ana@example.com"]);
    expect((await listActivity(s.db, 1)).map((a) => a.text)).toContain("Assigned to ana@example.com by ownership rule 1");

    expect((await s.app.request(`/api/projects/${s.project.id}/issues/1/assign`, { method: "POST", ...json({ assignee: "bo@example.com" }) })).status).toBe(200);
    expect((await getIssue(s.db, s.project.id, 1))!.assignee).toBe("bo@example.com");
    expect((await board(s.db, { status: "all", sort: "latest", q: "", assignee: "bo@example.com" })).issues).toHaveLength(1);
    expect((await board(s.db, { status: "all", sort: "latest", q: "", assignee: "" })).issues).toHaveLength(0);
  });

  it("lets viewers see but not assign", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "cy@example.com", "viewer");
    const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
    expect((await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}/assign`, { method: "POST", ...json({ assignee: "" }, as("cy@example.com")) })).status).toBe(403);
  });
});

describe("6. spikes and digests", () => {
  /** One event an hour for a day, then `burst` events this hour; the alert of each. */
  const burst = async (s: Awaited<ReturnType<typeof setup>>, n: number) => {
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const out: { alert: string | null; spike?: { fresh: string[] } }[] = [];
    for (let h = 24; h >= 1; h--) out.push(await recordEvent(s.db, s.project.id, pythonError, hour - h * 3_600_000 + 1000));
    for (let i = 0; i < n; i++) out.push(await recordEvent(s.db, s.project.id, pythonError, hour + 1000 + i));
    return out;
  };
  const route = (name: string, receivers: { kind: "email" | "slack"; target: string }[], extra: object = {}) => ({ name, matchers: [], sink: false, continue: false, receivers, ...extra });

  it("alerts once when an hour meets a route's spike numbers, routed like any alert", async () => {
    const s = await setup();
    await saveRouting(s.db, s.project.id, [
      { ...route("pager", [{ kind: "email", target: "pager@example.com" }], { spike: { events: 5, factor: 3 } }), matchers: [{ field: "trigger", op: "=", value: "spike" }] },
      { ...route("all", [{ kind: "email", target: "team@example.com" }]), matchers: [{ field: "level", op: "=~", value: ".*" }] },
    ]);
    const res = await burst(s, 6);
    expect(res.filter((r) => r.alert === "spike")).toHaveLength(1);
    expect(res.findIndex((r) => r.alert === "spike")).toBe(24 + 4); // the fifth event this hour
    expect((await listActivity(s.db, 1)).find((a) => a.kind === "spike")!.text).toMatch(/^Spiking: 5 events in the last hour/);
    // The spike goes to the route with spike numbers; the new issue, by trigger, not.
    const spike = res.find((r) => r.alert === "spike")!;
    const facts = { ...factsOf(s.project.name, pythonError, "spike"), spike: { events: 5, usual: 1, fresh: spike.spike!.fresh } };
    expect((await planFor(s.db, s.project.id, facts)).deliveries.map((d) => d.target)).toEqual(["pager@example.com"]);
    expect((await planFor(s.db, s.project.id, factsOf(s.project.name, pythonError, "new"))).deliveries.map((d) => d.target)).toEqual(["team@example.com"]);
  });

  it("lets each spike condition alert on its own, and has no default route for spikes", async () => {
    const s = await setup();
    await saveRouting(s.db, s.project.id, [
      route("chat", [{ kind: "slack", target: "https://hooks.slack.com/services/T/B/x" }], { spike: { events: 5, factor: 2 } }),
      { ...route("pager", [{ kind: "email", target: "pager@example.com" }], { spike: { events: 20, factor: 2 } }), matchers: [{ field: "env", op: "=", value: "nowhere" }] },
    ]);
    const res = await burst(s, 25);
    const spikes = res.filter((r) => r.alert === "spike");
    expect(spikes.map((r) => r.spike!.fresh)).toEqual([["5x2"], ["20x2"]]);
    // The second meets only the pager route's spike, whose env does not match: no one, not the default route.
    const facts = { ...factsOf(s.project.name, pythonError, "spike"), spike: { events: 20, usual: 1, fresh: ["20x2"] } };
    const plan = await planFor(s.db, s.project.id, facts);
    expect(plan.deliveries).toEqual([]);
    expect(summary(plan)).toBe("No one notified: no route with a spike condition matched");
  });

  it("does not look for spikes when no route has a spike condition", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) expect((await recordEvent(s.db, s.project.id, pythonError)).alert).not.toBe("spike");
  });

  it("checks spike conditions when routes are saved", () => {
    const one = (r: object, ctx: "project" | "personal" = "project") => checkRoutes([{ name: "", matchers: [], sink: false, continue: false, receivers: [{ kind: "email", target: "a@example.com" }], ...r }], ctx);
    expect(one({ spike: { events: 10, factor: 4 } })).toEqual({ routes: [expect.objectContaining({ spike: { events: 10, factor: 4 } })] });
    expect(one({})).toHaveProperty("routes"); // no conditions: every alert
    expect(one({ spike: { events: 0, factor: 4 } })).toHaveProperty("error");
    expect(one({ spike: { events: 10, factor: 0.5 } })).toHaveProperty("error");
    expect(one({ spike: { events: 10, factor: 4 } }, "personal")).toEqual({ error: "route 1: spike conditions are for project routes" });
  });

  it("writes a daily digest and sends it once a day to people who want it", async () => {
    const s = await setup();
    await signIn(s.db, "ana@example.com");
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "member");
    await recordEvent(s.db, s.project.id, pythonError);
    const text = await digestFor(s.db, s.access, "ana@example.com", [], "http://b.example.com");
    expect(text).toContain("web\n  New (1):\n    ZeroDivisionError: division by zero");
    await s.db.run("UPDATE users SET digest = 1 WHERE email = ?", "ana@example.com");
    const access = s.access;
    const noon = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 12 * 3_600_000;
    expect(await sendDueDigests(s.db, access, s.senders, "http://b.example.com", 8, "groups", noon)).toBe(1);
    expect(await sendDueDigests(s.db, access, s.senders, "http://b.example.com", 8, "groups", noon + 60_000)).toBe(0);
    expect(s.senders.sent.map((x) => [x.d.target, x.m.subject])).toEqual([["ana@example.com", "Burning: your daily summary"]]);
  });
});

describe("7. data scrubbing", () => {
  it("filters secret fields and values before anything is stored", async () => {
    const ev = {
      message: "card 4111 1111 1111 1111 and token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz",
      request: { headers: { Authorization: "Bearer abcdefghijkl", "User-Agent": "x" }, cookies: "session=abc", data: { password: "hunter2", note: "ok" }, query_string: "q=shoes&api_key=s3cr3t" },
      extra: { customer_email: "a@b.example" },
      exception: { values: [{ type: "E", stacktrace: { frames: [{ function: "get_token", filename: "auth.py", vars: { token: "t0k", n: 1 } }] } }] },
    };
    const out = scrubEvent(ev as never, { defaults: true, fields: ["email"] }) as typeof ev;
    expect(out.message).toBe(`card ${FILTERED} and token ${FILTERED}`);
    expect(out.request.headers).toEqual({ Authorization: FILTERED, "User-Agent": "x" });
    expect(out.request.cookies).toBe(FILTERED);
    expect(out.request.data).toEqual({ password: FILTERED, note: "ok" });
    expect(out.request.query_string).toBe(`q=shoes&api_key=${FILTERED}`);
    expect(out.extra.customer_email).toBe(FILTERED);
    expect(out.exception.values[0]!.stacktrace.frames[0]).toMatchObject({ function: "get_token", vars: { token: FILTERED, n: 1 } });
    // Not a card: fails the Luhn check.
    expect((scrubEvent({ message: "order 1234 5678 9012 3456" } as never, { defaults: true, fields: [] }) as { message: string }).message).toBe("order 1234 5678 9012 3456");

    const s = await setup();
    await recordEvent(s.db, s.project.id, ev as never);
    const stored = (await s.db.get<{ payload: string }>("SELECT payload FROM events"))!.payload;
    expect(stored).not.toMatch(/hunter2|s3cr3t|4111 1111|abcdefghijkl/);
  });

  it("keeps everything when the defaults are off and no fields are set", () => {
    const ev = { request: { data: { password: "p" } } };
    expect(scrubEvent(ev as never, { defaults: false, fields: [] })).toEqual(ev);
  });
});

describe("8. JavaScript source maps", () => {
  // app.min.js line 1, column 0 is src/app.ts line 3 in function "boom".
  const map = JSON.stringify({
    version: 3,
    file: "app.min.js",
    sources: ["webpack://shop/./src/app.ts"],
    names: ["boom"],
    mappings: "AAEAA",
    sourcesContent: ["import x from 'y';\n\nexport function boom() { throw new Error('x'); }\nboom();"],
  });
  const jsEvent = {
    platform: "javascript",
    release: "shop@1.2.0",
    exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [{ filename: "/static/js/app.min.js", abs_path: "https://shop.example.com/static/js/app.min.js", function: "a", lineno: 1, colno: 1, in_app: true }] } }] },
  };

  it("maps a minified frame to its original file, line, function, and code", async () => {
    const s = await setup();
    const up = await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", ...json({ release: "shop@1.2.0", name: "~/static/js/app.min.js.map", content: map }) });
    expect(up.status).toBe(201);
    const { issueId } = await recordEvent(s.db, s.project.id, jsEvent);
    const f = (await detail(s, issueId)).event.exceptions[0]!.frames[0]!;
    expect(f).toMatchObject({ location: "src/app.ts", function: "boom", lineno: 3, mapped: "https://shop.example.com/static/js/app.min.js:1:1" });
    expect(f.lines.find((l) => l.current)!.text).toBe("export function boom() { throw new Error('x'); }");
    const list = (await (await s.app.request(`/api/projects/${s.project.id}/sourcemaps?release=shop@1.2.0`)).json()) as { artifacts: { name: string }[] };
    expect(list.artifacts.map((a) => a.name)).toEqual(["~/static/js/app.min.js.map"]);
  });

  it("takes multipart uploads and refuses what is not a source map", async () => {
    const s = await setup();
    const form = new FormData();
    form.set("release", "shop@1.2.0");
    form.set("prefix", "~/static/js/");
    form.append("file", new File([map], "app.min.js.map"));
    const res = await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", body: form });
    expect(await res.json()).toEqual({ release: "shop@1.2.0", uploaded: ["~/static/js/app.min.js.map"] });
    expect((await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", ...json({ release: "r", name: "x.map", content: "{}" }) })).status).toBe(400);
  });
});

describe("9. merging and grouping rules", () => {
  it("finds an issue by its number alone, follows merges, and hides issues of other projects", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "member");
    const a = await recordEvent(s.db, s.project.id, { message: "timeout talking to db" });
    const b = await recordEvent(s.db, s.project.id, { message: "db connection reset" });
    const get = async (n: number, who: string) => {
      const res = await s.app.request(`/api/issues/${n}`, { headers: as(who) });
      return res.status === 200 ? await res.json() : res.status;
    };
    expect(await get(b.issueId, "ana@example.com")).toEqual({ project: s.project.id, issue: b.issueId, merged: false });
    expect(await get(b.issueId, "eve@example.com")).toBe(404); // no role: as if there were no such issue
    expect(await get(999, "ana@example.com")).toBe(404);
    await s.app.request(`/api/projects/${s.project.id}/issues/merge`, { method: "POST", ...json({ into: a.issueId, issues: [a.issueId, b.issueId] }, as("ana@example.com")) });
    expect(await get(b.issueId, "ana@example.com")).toEqual({ project: s.project.id, issue: a.issueId, merged: true });
  });

  it("merges issues, sends later events of either to the one kept, and splits one back out", async () => {
    const s = await setup();
    const a = await recordEvent(s.db, s.project.id, { message: "timeout talking to db" });
    const b = await recordEvent(s.db, s.project.id, { message: "db connection reset", tags: { region: "eu" } });
    await recordEvent(s.db, s.project.id, { message: "db connection reset", tags: { region: "eu" } });
    const res = await s.app.request(`/api/projects/${s.project.id}/issues/merge`, { method: "POST", ...json({ into: a.issueId, issues: [a.issueId, b.issueId] }) });
    expect(await res.json()).toEqual({ into: a.issueId, merged: 1 });
    expect(await getIssue(s.db, s.project.id, b.issueId)).toBeUndefined();
    expect((await getIssue(s.db, s.project.id, a.issueId))!.eventCount).toBe(3);
    expect((await recordEvent(s.db, s.project.id, { message: "db connection reset" })).issueId).toBe(a.issueId);
    const merged = await mergedInto(s.db, a.issueId);
    expect(merged).toEqual([expect.objectContaining({ title: "db connection reset", events: 3 })]);

    const split = await s.app.request(`/api/projects/${s.project.id}/issues/${a.issueId}/unmerge`, { method: "POST", ...json({ fingerprint: merged[0]!.fingerprint }) });
    const { issue: back } = (await split.json()) as { issue: number };
    expect((await getIssue(s.db, s.project.id, back))).toMatchObject({ title: "db connection reset", eventCount: 3 });
    expect((await getIssue(s.db, s.project.id, a.issueId))!.eventCount).toBe(1);
    expect((await tagBreakdown(s.db, back)).find((t) => t.key === "region")!.total).toBe(2);
    expect((await recordEvent(s.db, s.project.id, { message: "db connection reset" })).issueId).toBe(back);
  });

  it("groups by the project's rules", async () => {
    const s = await setup();
    const cfg = await getConfig(s.db, s.project.id);
    await saveConfig(s.db, s.project.id, { ...cfg, grouping: [{ field: "message", pattern: "timeout", fingerprint: "timeouts {{ tag.region }}" }] });
    const a = await recordEvent(s.db, s.project.id, { message: "read timeout on /a", tags: { region: "eu" } });
    const b = await recordEvent(s.db, s.project.id, { message: "connect timeout to db", tags: { region: "eu" } });
    const c = await recordEvent(s.db, s.project.id, { message: "connect timeout to db", tags: { region: "us" } });
    expect(a.issueId).toBe(b.issueId);
    expect(c.issueId).not.toBe(a.issueId);
  });

  it("checks rules from the settings page", async () => {
    const s = await setup();
    const put = (section: string, body: unknown) => s.app.request(`/api/projects/${s.project.id}/config/${section}`, { method: "PUT", ...json(body) });
    expect((await put("grouping", [{ field: "message", pattern: "(", fingerprint: "x" }])).status).toBe(400);
    expect((await put("owners", [{ field: "path", pattern: "^app/", owner: "not-an-email" }])).status).toBe(400);
    expect((await put("spike", { threshold: 10, factor: 4 })).status).toBe(400); // spikes are route conditions now
  });
});

describe("languages", () => {
  it("keeps the language a person chooses, from the list only", async () => {
    const s = await setup({ auth: true });
    await signIn(s.db, "ana@example.com");
    const session = async () => (await getUser(s.db, "ana@example.com"))!.lang;
    expect(await session()).toBe(""); // not chosen yet: the app asks
    const put = (lang: string) => s.app.request("/api/profile/lang", { method: "PUT", ...json({ lang }, as("ana@example.com")) });
    expect((await put("ja")).status).toBe(200);
    expect(await session()).toBe("ja");
    expect((await put("xx")).status).toBe(400);
    expect(await session()).toBe("ja");
  });
});

describe("10. API tokens, GitHub issues, and Slack", () => {
  it("lets a token create releases, deploys, and source maps for its project only", async () => {
    const s = await setup({ auth: true });
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    const made = await s.app.request(`/api/projects/${s.project.id}/tokens`, { method: "POST", ...json({ name: "CI" }, as("ana@example.com")) });
    const { token } = (await made.json()) as { token: string };
    expect(token).toMatch(/^brn_[0-9a-f]{40}$/);
    const ci = (path: string, body: unknown) => s.app.request(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await ci(`/api/projects/${s.project.id}/releases`, { version: "web@3", commit: "abc1234" })).status).toBe(201);
    expect((await ci(`/api/projects/${s.project.id}/deploys`, { release: "web@3", environment: "production" })).status).toBe(201);
    // Nothing else, and not another project.
    expect((await s.app.request(`/api/projects/${s.project.id}/issues`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    expect((await ci(`/api/projects/999/releases`, { version: "x" })).status).toBe(403);
    expect((await s.app.request("/api/board", { headers: { authorization: "Bearer brn_" + "0".repeat(40) } })).status).toBe(401);
    expect((await listReleases(s.db, s.project.id))[0]).toMatchObject({ version: "web@3", commit: "abc1234", deploys: [{ environment: "production" }] });
    const tokens = (await (await s.app.request(`/api/projects/${s.project.id}/tokens`, { headers: as("ana@example.com") })).json()) as { tokens: { id: number; lastUsed: number }[] };
    expect(tokens.tokens[0]!.lastUsed).toBeGreaterThan(0);
    expect((await s.app.request(`/api/projects/${s.project.id}/tokens/${tokens.tokens[0]!.id}`, { method: "DELETE", headers: as("ana@example.com") })).status).toBe(204);
    expect((await ci(`/api/projects/${s.project.id}/releases`, { version: "web@4" })).status).toBe(401);
  });

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

  it("posts alerts to a Slack webhook", async () => {
    const s = await setup();
    await saveRouting(s.db, s.project.id, [{ name: "", matchers: [{ field: "level", op: "=~", value: ".*" }], sink: false, continue: false, receivers: [{ kind: "slack", target: "https://hooks.slack.com/services/T/B/x" }] }]);
    await s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, { method: "POST", body: JSON.stringify(pythonError) });
    await s.queue.idle();
    await s.outbox.drain();
    expect(s.senders.sent.map((x) => [x.d.kind, x.d.target])).toEqual([["slack", "https://hooks.slack.com/services/T/B/x"]]);
    void savePersonalRoutes;
  });
});
