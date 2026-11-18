import { Hono, type Context } from "hono";
import type { Db } from "./db.js";
import type { EventView } from "./event-view.js";
import { personalTokenUser, type Scope } from "./personal-tokens.js";
import { publicBase } from "./url.js";

// An MCP server (Model Context Protocol, Streamable HTTP) at /mcp, so AI
// agents can read and triage issues. It signs in with a personal access
// token (Authorization: Bearer brp_...). Each tool calls the app's own JSON
// API with that token, so it sees and may do exactly what the person may
// in the web app; a read token gets only the read tools.
//
// Stateless: every POST is one JSON-RPC message, answered with JSON. There
// are no sessions and no server-to-client stream, so GET is refused.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_FRAMES = 40;
const MAX_BREADCRUMBS = 30;

/** Calls the app's JSON API, as the request's token. */
export type ApiCall = (method: string, path: string, auth: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

type Json = Record<string, unknown>;
type ToolContext = { call: (method: string, path: string, body?: unknown) => Promise<Json>; base: string; me: string };
type Tool = {
  name: string;
  title: string;
  description: string;
  write: boolean;
  inputSchema: Json;
  run: (args: Json, t: ToolContext) => Promise<unknown>;
};

/** The API said no: shown to the agent as the tool's error. */
class ApiError extends Error {}
/** The agent sent bad arguments. */
class BadArgs extends Error {}

const issueArg = { issue: { type: "integer", description: "The issue number, as in /issues/<n>" } };
const num = (args: Json, key: string): number => {
  const n = Number(args[key]);
  if (!Number.isInteger(n) || n <= 0) throw new BadArgs(`${key} must be a positive whole number`);
  return n;
};
const str = (args: Json, key: string): string => (typeof args[key] === "string" ? (args[key] as string).trim() : "");

/** The project an issue number is in (following merges), and its current number. */
async function locate(t: ToolContext, issue: number): Promise<{ project: number; issue: number; merged: boolean }> {
  return (await t.call("GET", `/api/issues/${issue}`)) as { project: number; issue: number; merged: boolean };
}

/** An event, cut down for reading: the frames and breadcrumbs that matter most, no raw payload. */
function compactEvent(e: EventView) {
  return {
    id: e.id,
    eventId: e.eventId,
    receivedAt: new Date(e.receivedAt).toISOString(),
    release: e.release,
    environment: e.environment,
    serverName: e.serverName,
    level: e.level,
    platform: e.platform,
    message: e.message,
    tags: Object.fromEntries(e.tags),
    exceptions: e.exceptions.map((x) => ({
      type: x.type,
      value: x.value,
      handled: x.handled,
      // Newest call first, as on the issue page.
      frames: x.frames.slice(0, MAX_FRAMES).map((f) => ({
        at: `${f.location}:${f.lineno}`,
        function: f.function,
        inApp: f.inApp,
        ...(f.lines.length ? { code: f.lines.map((l) => `${l.current ? ">" : " "}${String(l.no).padStart(5)} ${l.text}`).join("\n") } : {}),
        ...(f.vars.length ? { vars: Object.fromEntries(f.vars) } : {}),
        ...(f.link ? { link: f.link } : {}),
        ...(f.mapped ? { minified: f.mapped } : {}),
      })),
      ...(x.frames.length > MAX_FRAMES ? { moreFrames: x.frames.length - MAX_FRAMES } : {}),
    })),
    breadcrumbs: e.breadcrumbs.slice(-MAX_BREADCRUMBS).map((b) => ({
      at: b.timestamp ? new Date(b.timestamp).toISOString() : null,
      category: b.category,
      level: b.level,
      message: b.message,
      ...(b.data ? { data: b.data } : {}),
    })),
    context: Object.fromEntries(e.context),
  };
}

type BoardIssue = { id: number; projectId: number; projectName: string; title: string; culprit: string; level: string; status: string; assignee: string; firstSeen: number; lastSeen: number; eventCount: number; hours: number[] };
const issueSummary = (i: BoardIssue, base: string) => ({
  issue: i.id,
  project: i.projectName,
  title: i.title,
  culprit: i.culprit,
  level: i.level,
  status: i.status,
  assignee: i.assignee,
  events: i.eventCount,
  eventsLast24h: i.hours.reduce((a, b) => a + b, 0),
  firstSeen: new Date(i.firstSeen).toISOString(),
  lastSeen: new Date(i.lastSeen).toISOString(),
  url: `${base}/issues/${i.id}`,
});

const TOOLS: Tool[] = [
  {
    name: "list_projects",
    title: "List projects",
    description: "The projects you can see, with your role in each (viewer, member, or admin).",
    write: false,
    inputSchema: { type: "object", properties: {} },
    run: async (_args, t) => {
      const { projects } = (await t.call("GET", "/api/projects")) as { projects: { id: number; name: string; role: string }[] };
      return { projects: projects.map((p) => ({ id: p.id, name: p.name, role: p.role })) };
    },
  },
  {
    name: "search_issues",
    title: "Search issues",
    description:
      "Find issues across your projects, or in one. Without arguments: open issues, hottest first (most events in the last hours). The query matches titles and culprits.",
    write: false,
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "A project name or id; omit for all your projects" },
        query: { type: "string", description: "Words to find in the title or culprit" },
        status: { type: "string", enum: ["open", "resolved", "muted", "all"], description: "Default open" },
        sort: { type: "string", enum: ["hot", "latest", "count"], description: "hot: busiest now (default); latest: last seen; count: most events" },
        assignee: { type: "string", description: '"me", "none", or an email' },
        release: { type: "string", description: "Only issues seen in this release" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20" },
      },
    },
    run: async (args, t) => {
      const q = new URLSearchParams();
      const project = str(args, "project");
      if (project) {
        let id = /^\d+$/.test(project) ? Number(project) : 0;
        if (!id) {
          const { projects } = (await t.call("GET", "/api/projects")) as { projects: { id: number; name: string }[] };
          id = projects.find((p) => p.name.toLowerCase() === project.toLowerCase())?.id ?? 0;
          if (!id) throw new BadArgs(`no project named "${project}" that you can see; list_projects shows them`);
        }
        q.set("project", String(id));
      }
      for (const key of ["query", "status", "sort", "assignee", "release"]) {
        const v = str(args, key);
        if (v) q.set(key === "query" ? "q" : key, v);
      }
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      const b = (await t.call("GET", `/api/board?${q}`)) as { issues: BoardIssue[] };
      return { total: b.issues.length, issues: b.issues.slice(0, limit).map((i) => issueSummary(i, t.base)) };
    },
  },
  {
    name: "get_issue",
    title: "Get an issue",
    description:
      "One issue in full: status, counts, tag breakdown, users affected, releases, history, comments, suspect changes, and its latest event (exception, stack frames with code, breadcrumbs, context). Pass event to read another stored event.",
    write: false,
    inputSchema: {
      type: "object",
      properties: { ...issueArg, event: { type: "integer", description: "A stored event id from list_events; default the latest" } },
      required: ["issue"],
    },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      const event = Number(args.event) || 0;
      const p = (await t.call("GET", `/api/projects/${at.project}/issues/${at.issue}${event ? `?event=${event}` : ""}`)) as Json & {
        project: { id: number; name: string; role: string };
        issue: Json & { hours?: number[]; firstSeen: number; lastSeen: number };
        event: EventView | null;
        activity: { kind: string; text: string; at: number; actorName: string }[];
        comments: { authorName: string; body: string; createdAt: number; editedAt?: number }[];
      };
      const { hours, ...issue } = p.issue;
      return {
        ...(at.merged ? { note: `issue ${num(args, "issue")} was merged into ${at.issue}` } : {}),
        url: `${t.base}/issues/${at.issue}`,
        project: p.project,
        issue: { ...issue, firstSeen: new Date(p.issue.firstSeen).toISOString(), lastSeen: new Date(p.issue.lastSeen).toISOString(), eventsLast24h: (hours ?? []).reduce((a, b) => a + b, 0) },
        tags: p.tags,
        usersAffected: p.users,
        releases: p.releases,
        latestRelease: p.latestRelease,
        storedEvents: p.storedEvents,
        merged: p.merged,
        suspects: p.suspects,
        githubIssues: p.githubIssues,
        history: p.activity.slice(-20).map((a) => ({ at: new Date(a.at).toISOString(), by: a.actorName, kind: a.kind, text: a.text })),
        comments: p.comments.map((x) => ({ by: x.authorName, at: new Date(x.createdAt).toISOString(), text: x.body })),
        event: p.event ? compactEvent(p.event) : null,
      };
    },
  },
  {
    name: "list_events",
    title: "List an issue's events",
    description: "The stored events of an issue, newest first, 10 at a time. Pass before (the last event id) for the next page. Read one in full with get_issue and event.",
    write: false,
    inputSchema: { type: "object", properties: { ...issueArg, before: { type: "integer", description: "Only events older than this event id" } }, required: ["issue"] },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      const before = Number(args.before) || 0;
      return t.call("GET", `/api/projects/${at.project}/issues/${at.issue}/events${before ? `?before=${before}` : ""}`);
    },
  },
  {
    name: "resolve_issue",
    title: "Resolve an issue",
    description: "Mark an issue resolved. A later event reopens it and alerts again. Needs the member role.",
    write: true,
    inputSchema: { type: "object", properties: issueArg, required: ["issue"] },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      await t.call("POST", `/api/projects/${at.project}/issues/${at.issue}/resolve`);
      return { ok: true, issue: at.issue, status: "resolved" };
    },
  },
  {
    name: "reopen_issue",
    title: "Reopen an issue",
    description: "Open a resolved or muted issue again. Needs the member role.",
    write: true,
    inputSchema: { type: "object", properties: issueArg, required: ["issue"] },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      await t.call("POST", `/api/projects/${at.project}/issues/${at.issue}/reopen`);
      return { ok: true, issue: at.issue, status: "open" };
    },
  },
  {
    name: "mute_issue",
    title: "Mute an issue",
    description: "Stop alerts for an issue for a while, or until something changes. Events are still counted. Needs the member role.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        ...issueArg,
        for: { type: "string", enum: ["1h", "1d", "1w", "release", "forever"], description: "1 hour, 1 day, 1 week, until the next release, or until unmuted" },
      },
      required: ["issue", "for"],
    },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      await t.call("POST", `/api/projects/${at.project}/issues/${at.issue}/mute`, { for: str(args, "for") });
      return { ok: true, issue: at.issue, status: "muted" };
    },
  },
  {
    name: "assign_issue",
    title: "Assign an issue",
    description: 'Give an issue to someone by email, to yourself with "me", or to no one with "". Needs the member role.',
    write: true,
    inputSchema: { type: "object", properties: { ...issueArg, assignee: { type: "string", description: 'An email, "me", or "" for no one' } }, required: ["issue", "assignee"] },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      let who = str(args, "assignee");
      if (who.toLowerCase() === "me") who = t.me;
      await t.call("POST", `/api/projects/${at.project}/issues/${at.issue}/assign`, { assignee: who });
      return { ok: true, issue: at.issue, assignee: who };
    },
  },
  {
    name: "comment_on_issue",
    title: "Comment on an issue",
    description: "Add a comment to an issue, as you. Markdown is shown as plain text.",
    write: true,
    inputSchema: { type: "object", properties: { ...issueArg, text: { type: "string", description: "The comment" } }, required: ["issue", "text"] },
    run: async (args, t) => {
      const at = await locate(t, num(args, "issue"));
      const text = str(args, "text");
      if (!text) throw new BadArgs("text is empty");
      await t.call("POST", `/api/projects/${at.project}/issues/${at.issue}/comments`, { body: text });
      return { ok: true, issue: at.issue };
    },
  },
];

const toolsFor = (scope: Scope) => TOOLS.filter((t) => scope === "write" || !t.write);

const describe = (t: Tool) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write || t.name !== "comment_on_issue", openWorldHint: false },
});

const INSTRUCTIONS =
  "Burning is an error tracker for Sentry SDKs. Issues are numbered across all projects; refer to one by its number. " +
  "Start with search_issues (open issues, busiest first) or list_projects, then get_issue for the stack trace, tags, and history. " +
  "You act as the person who made the token, with their roles.";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });

/** The /mcp endpoint. */
export function mcpRoutes(db: Db, deps: { call: ApiCall; baseURL: string; version: string }): Hono {
  const app = new Hono();

  const unauthorized = (c: Context, why: string) => {
    c.header("WWW-Authenticate", 'Bearer realm="burning", error="invalid_token"');
    return c.json(rpcError(null, -32001, `${why}. Make a personal access token on your profile in Burning and send it as Authorization: Bearer brp_...`), 401);
  };

  app.get("/mcp", (c) => {
    c.header("Allow", "POST");
    return c.json(rpcError(null, -32000, "this server answers POST only (no event stream)"), 405);
  });
  app.delete("/mcp", (c) => c.body(null, 405));

  app.post("/mcp", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(brp_\S+)$/i.exec(auth)?.[1];
    if (!token) return unauthorized(c, "no personal access token");
    const found = await personalTokenUser(db, token);
    if (!found) return unauthorized(c, "invalid or expired personal access token");

    let msg: RpcRequest;
    try {
      msg = (await c.req.json()) as RpcRequest;
    } catch {
      return c.json(rpcError(null, -32700, "parse error"), 400);
    }
    if (Array.isArray(msg)) return c.json(rpcError(null, -32600, "send one message per request"), 400);
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return c.json(rpcError(msg?.id, -32600, "invalid request"), 400);

    // Notifications and responses get no answer.
    if (msg.id === undefined || msg.id === null) return c.body(null, 202);
    const id = msg.id;
    const params = (msg.params ?? {}) as Json;
    const tools = toolsFor(found.scope);

    switch (msg.method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        return c.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "burning", title: "Something's burning", version: deps.version },
            instructions: INSTRUCTIONS,
          }),
        );
      }
      case "ping":
        return c.json(rpcResult(id, {}));
      case "tools/list":
        return c.json(rpcResult(id, { tools: tools.map(describe) }));
      case "tools/call": {
        const name = String(params.name ?? "");
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
          const hidden = TOOLS.some((t) => t.name === name);
          return c.json(rpcError(id, -32602, hidden ? `${name} needs a token with write access` : `no tool named ${name}`));
        }
        const ctx: ToolContext = {
          base: publicBase(c, deps.baseURL),
          me: found.user.email,
          call: async (method, path, body) => {
            const r = await deps.call(method, path, auth, body);
            if (r.status >= 400) throw new ApiError(String((r.data as { detail?: unknown })?.detail ?? `the API answered ${r.status}`));
            return (r.data ?? {}) as Json;
          },
        };
        try {
          const args = (params.arguments ?? {}) as Json;
          const out = await tool.run(args, ctx);
          return c.json(rpcResult(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false }));
        } catch (err) {
          if (err instanceof ApiError || err instanceof BadArgs) return c.json(rpcResult(id, { content: [{ type: "text", text: err.message }], isError: true }));
          throw err;
        }
      }
      default:
        return c.json(rpcError(id, -32601, `method not found: ${msg.method}`));
    }
  });

  return app;
}
