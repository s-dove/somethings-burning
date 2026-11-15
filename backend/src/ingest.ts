import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { Hono, type Context } from "hono";
import type { Alerter } from "./alert.js";
import { cors } from "hono/cors";
import type { Db } from "./db.js";
import { parseEnvelope } from "./envelope.js";
import type { SentryEvent } from "./event.js";
import { recordEvent } from "./issues.js";
import { getProject, type Project } from "./projects.js";
import { publicBase } from "./url.js";

// The two routes Sentry SDKs post to. Only error events are stored; other
// envelope items (transactions, sessions, client reports, ...) are accepted
// and dropped.

const MAX_BODY = 20 * 1024 * 1024;

function decode(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
      return gunzipSync(body, { maxOutputLength: MAX_BODY });
    case "deflate":
      return inflateSync(body, { maxOutputLength: MAX_BODY });
    case "br":
      return brotliDecompressSync(body, { maxOutputLength: MAX_BODY });
    default:
      return body;
  }
}

/** sentry_key from the X-Sentry-Auth header, the query string, or the envelope's DSN. */
function keyFrom(c: Context, envelopeDsn?: unknown): string | undefined {
  const auth = c.req.header("x-sentry-auth") ?? c.req.header("authorization") ?? "";
  const m = /sentry_key=([^,\s]+)/.exec(auth);
  if (m) return m[1];
  const q = c.req.query("sentry_key");
  if (q) return q;
  if (typeof envelopeDsn === "string") {
    try {
      return new URL(envelopeDsn).username || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function ingestRoutes(db: Db, opts: { alerter?: Alerter; baseURL?: string } = {}): Hono {
  const r = new Hono();

  // record stores one event and alerts when it should: a new issue, one
  // firing again, or one firing after a mute.
  const record = (c: Context, project: Project, event: SentryEvent) => {
    const res = recordEvent(db, project.id, event);
    if (res.alert && opts.alerter) {
      try {
        opts.alerter.notify(project, res, event, publicBase(c, opts.baseURL));
      } catch (err) {
        console.error("alert failed:", err);
      }
    }
    return res.eventId;
  };

  // Browser SDKs post cross-origin.
  r.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Content-Encoding", "X-Sentry-Auth", "Authorization"],
      exposeHeaders: ["X-Sentry-Rate-Limits", "Retry-After"],
    }),
  );

  const readBody = async (c: Context) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (raw.length > MAX_BODY) throw new Error("too large");
    return decode(raw, c.req.header("content-encoding"));
  };

  const authorize = (c: Context, dsn?: unknown) => {
    const projectId = Number(c.req.param("projectId"));
    const project = getProject(db, projectId);
    if (!project) return { error: c.json({ detail: "unknown project" }, 404) };
    if (keyFrom(c, dsn) !== project.publicKey) return { error: c.json({ detail: "invalid key" }, 401) };
    return { project };
  };

  const envelope = async (c: Context) => {
    let body: Buffer;
    let env;
    try {
      body = await readBody(c);
      env = parseEnvelope(body);
    } catch {
      return c.json({ detail: "malformed envelope" }, 400);
    }
    const auth = authorize(c, env.header.dsn);
    if (auth.error) return auth.error;

    let id = typeof env.header.event_id === "string" ? env.header.event_id : undefined;
    for (const item of env.items) {
      if (item.type !== "event") continue;
      let event: SentryEvent;
      try {
        event = JSON.parse(item.payload.toString("utf8")) as SentryEvent;
      } catch {
        return c.json({ detail: "malformed event" }, 400);
      }
      id = record(c, auth.project, { event_id: id, ...event });
    }
    return c.json(id ? { id } : {});
  };

  const store = async (c: Context) => {
    const auth = authorize(c);
    if (auth.error) return auth.error;
    let event: SentryEvent;
    try {
      event = JSON.parse((await readBody(c)).toString("utf8")) as SentryEvent;
    } catch {
      return c.json({ detail: "malformed event" }, 400);
    }
    return c.json({ id: record(c, auth.project, event) });
  };

  for (const suffix of ["", "/"]) {
    r.post(`/:projectId{[0-9]+}/envelope${suffix}`, envelope);
    r.post(`/:projectId{[0-9]+}/store${suffix}`, store);
  }
  return r;
}
