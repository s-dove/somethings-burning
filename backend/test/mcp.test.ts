import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { getIssue, recordEvent } from "../src/issues.js";
import { createPersonalToken } from "../src/personal-tokens.js";
import { createProject } from "../src/projects.js";
import { recordLogin } from "../src/users.js";
import { pythonError, setup } from "./helpers.js";

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string; annotations: { readOnlyHint: boolean } }[]; protocolVersion?: string; serverInfo?: { name: string } }; error?: { code: number; message: string } };

async function world() {
  const s = await setup({ auth: true });
  await setGrant(s.db, s.project.id, "user", "ana@example.com", "member");
  await recordLogin(s.db, { email: "ana@example.com", issuer: "password", claims: {} });
  const read = (await createPersonalToken(s.db, "ana@example.com", { name: "r", scope: "read", days: 30 })).token;
  const write = (await createPersonalToken(s.db, "ana@example.com", { name: "w", scope: "write", days: 30 })).token;
  let n = 0;
  const rpc = async (token: string | null, method: string, params?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await s.app.request("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
    return { status: res.status, body: (res.status === 202 ? {} : await res.json()) as Rpc, res };
  };
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const { body } = await rpc(token, "tools/call", { name, arguments: args });
    if (body.error) return { error: body.error.message };
    const text = body.result!.content![0]!.text;
    return body.result!.isError ? { error: text } : { data: JSON.parse(text) as Record<string, any> };
  };
  return { s, read, write, rpc, tool };
}

describe("MCP", () => {
  it("needs a personal access token", async () => {
    const { rpc } = await world();
    const res = await rpc(null, "initialize", {});
    expect(res.status).toBe(401);
    expect(res.res.headers.get("www-authenticate")).toContain("Bearer");
    expect((await rpc("brp_" + "1".repeat(40), "tools/list")).status).toBe(401);
  });

  it("says hello, answers pings, and ignores notifications", async () => {
    const { s, read, rpc } = await world();
    const init = await rpc(read, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "burning" } });
    expect((await rpc(read, "initialize", { protocolVersion: "1999-01-01" })).body.result!.protocolVersion).toBe("2025-06-18");
    expect((await rpc(read, "ping")).body.result).toEqual({});
    const note = await s.app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${read}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    expect((await rpc(read, "nope")).body.error!.code).toBe(-32601);
    expect((await s.app.request("/mcp", { headers: { authorization: `Bearer ${read}` } })).status).toBe(405);
  });

  it("lists only read tools for a read token", async () => {
    const { read, write, rpc } = await world();
    const names = async (t: string) => (await rpc(t, "tools/list")).body.result!.tools!.map((x) => x.name);
    expect(await names(read)).toEqual(["list_projects", "search_issues", "get_issue", "list_events"]);
    expect(await names(write)).toContain("resolve_issue");
    expect((await rpc(read, "tools/call", { name: "resolve_issue", arguments: { issue: 1 } })).body.error!.message).toBe("resolve_issue needs a token with write access");
  });

  it("finds and reads issues the person can see", async () => {
    const { s, read, tool } = await world();
    const hidden = await createProject(s.db, "secret");
    const { issueId } = await recordEvent(s.db, s.project.id, { ...pythonError, tags: { region: "eu" } });
    await recordEvent(s.db, hidden.id, { message: "not yours" });

    expect((await tool(read, "list_projects")).data!.projects).toEqual([{ id: s.project.id, name: "web", role: "member" }]);
    const found = (await tool(read, "search_issues", { query: "ZeroDivision" })).data!;
    expect(found.issues.map((i: { issue: number }) => i.issue)).toEqual([issueId]);
    expect(found.issues[0].url).toBe(`http://localhost/issues/${issueId}`);
    expect((await tool(read, "search_issues", { project: "web" })).data!.total).toBe(1);
    expect((await tool(read, "search_issues", { project: "secret" })).error).toContain('no project named "secret"');

    const issue = (await tool(read, "get_issue", { issue: issueId })).data!;
    expect(issue.issue.title).toContain("ZeroDivisionError");
    expect(issue.event.exceptions[0].type).toBe("ZeroDivisionError");
    expect(issue.event.tags.region).toBe("eu");
    expect(issue.event).not.toHaveProperty("raw");
    expect((await tool(read, "list_events", { issue: issueId })).data!.events).toHaveLength(1);
    // Someone else's issue reads as not found.
    const other = (await s.db.get<{ id: number }>("SELECT id FROM issues WHERE project_id = ?", hidden.id))!.id;
    expect((await tool(read, "get_issue", { issue: other })).error).toBe("not found");
    expect((await tool(read, "get_issue", { issue: "x" })).error).toBe("issue must be a positive whole number");
  });

  it("triages with a write token, as the person", async () => {
    const { s, write, tool } = await world();
    const { issueId } = await recordEvent(s.db, s.project.id, pythonError);
    expect((await tool(write, "assign_issue", { issue: issueId, assignee: "me" })).data).toMatchObject({ assignee: "ana@example.com" });
    expect((await tool(write, "comment_on_issue", { issue: issueId, text: "looking" })).data).toMatchObject({ ok: true });
    expect((await tool(write, "mute_issue", { issue: issueId, for: "1d" })).data).toMatchObject({ status: "muted" });
    expect((await tool(write, "mute_issue", { issue: issueId, for: "3d" })).error).toBe("choose how long to mute");
    expect((await tool(write, "resolve_issue", { issue: issueId })).data).toMatchObject({ status: "resolved" });
    const issue = (await getIssue(s.db, s.project.id, issueId))!;
    expect([issue.status, issue.assignee]).toEqual(["resolved", "ana@example.com"]);
    const read = (await tool(write, "get_issue", { issue: issueId })).data!;
    expect(read.comments).toMatchObject([{ text: "looking" }]);
    expect(read.history.map((h: { by: string }) => h.by)).toContain("ana");
    // A viewer may read but not triage.
    await setGrant(s.db, s.project.id, "user", "ana@example.com", "viewer");
    expect((await tool(write, "reopen_issue", { issue: issueId })).error).toBe("triage needs the member role");
  });
});
