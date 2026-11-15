import { randomUUID } from "node:crypto";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Db } from "./db.js";
import { parseEnvelope } from "./envelope.js";
import type { SentryEvent } from "./event.js";
import { getProject, type Project } from "./projects.js";
import type { IngestQueue, TokenBucket } from "./queue.js";
import { publicBase } from "./url.js";

// The two routes Sentry SDKs post to. Only error events are stored; other
// envelope items (transactions, sessions, client reports, ...) are accepted
// and dropped.

export const MAX_BODY = 10 * 1024 * 1024;
const RETRY_AFTER_SECONDS = 10;

/** Undoes Content-Encoding: gzip, deflate (zlib or raw), br, or zstd. */
export function decode(body: Buffer, encoding: string | undefined): Buffer {
  const opts = { maxOutputLength: MAX_BODY };
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
      return gunzipSync(body, opts);
    case "deflate":
      try {
        return inflateSync(body, opts);
      } catch {
        return inflateRawSync(body, opts);
      }
    case "br":
      return brotliDecompressSync(body, opts);
    case "zstd":
      return zstdDecompressSync(body, opts);
    default:
      return body;
  }
}

function rateLimited(c: Context, why: string) {
  c.header("Retry-After", String(RETRY_AFTER_SECONDS));
  // Empty categories means every category, so the SDK pauses everything.
  c.header("X-Sentry-Rate-Limits", `${RETRY_AFTER_SECONDS}::organization`);
  return c.json({ detail: why }, 429);
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

export function ingestRoutes(db: Db, opts: { queue: IngestQueue; limiter: TokenBucket; baseURL?: string }): Hono {
  const r = new Hono();

  // queue hands one event to the writer and answers with its id. The id is
  // settled here, since the event is written after the response.
  const queue = (c: Context, project: Project, event: SentryEvent): string | null => {
    const id = typeof event.event_id === "string" && event.event_id ? event.event_id.replaceAll("-", "") : randomUUID().replaceAll("-", "");
    const ok = opts.queue.push({ project, event: { ...event, event_id: id }, received: Date.now(), baseURL: publicBase(c, opts.baseURL) });
    return ok ? id : null;
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
    if (raw.length > MAX_BODY) throw new TooLarge();
    return decode(raw, c.req.header("content-encoding"));
  };

  const authorize = async (c: Context, dsn?: unknown) => {
    const projectId = Number(c.req.param("projectId"));
    const project = await getProject(db, projectId);
    if (!project) return { error: c.json({ detail: "unknown project" }, 404) };
    if (keyFrom(c, dsn) !== project.publicKey) return { error: c.json({ detail: "invalid key" }, 401) };
    return { project };
  };

  // Reads and decodes the body: a 413 when too large, a 400 when it cannot be read.
  const body = async (c: Context): Promise<Buffer | Response> => {
    try {
      return await readBody(c);
    } catch (err) {
      if (err instanceof TooLarge) return c.json({ detail: "body too large" }, 413);
      return c.json({ detail: "the body could not be decoded" }, 400);
    }
  };

  const envelope = async (c: Context) => {
    if (!opts.limiter.allow()) return rateLimited(c, "rate limited");
    const raw = await body(c);
    if (raw instanceof Response) return raw;
    let env;
    try {
      env = parseEnvelope(raw);
    } catch {
      return c.json({ detail: "malformed envelope" }, 400);
    }
    const auth = await authorize(c, env.header.dsn);
    if (auth.error) return auth.error;

    // Transactions, sessions, client reports and the rest are accepted and
    // dropped; only errors are tracked.
    const events: SentryEvent[] = [];
    const headerId = typeof env.header.event_id === "string" ? env.header.event_id : undefined;
    for (const item of env.items) {
      if (item.type !== "event") continue;
      try {
        events.push({ event_id: headerId, ...(JSON.parse(item.payload.toString("utf8")) as SentryEvent) });
      } catch {
        return c.json({ detail: "malformed event" }, 400);
      }
    }
    let id = headerId;
    for (const event of events) {
      const queued = queue(c, auth.project, event);
      if (!queued) return rateLimited(c, "ingest queue full");
      id = queued;
    }
    return c.json(id ? { id } : {});
  };

  const store = async (c: Context) => {
    if (!opts.limiter.allow()) return rateLimited(c, "rate limited");
    const auth = await authorize(c);
    if (auth.error) return auth.error;
    const raw = await body(c);
    if (raw instanceof Response) return raw;
    let event: SentryEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as SentryEvent;
    } catch {
      return c.json({ detail: "malformed event" }, 400);
    }
    const id = queue(c, auth.project, event);
    return id ? c.json({ id }) : rateLimited(c, "ingest queue full");
  };

  for (const suffix of ["", "/"]) {
    r.post(`/:projectId{[0-9]+}/envelope${suffix}`, envelope);
    r.post(`/:projectId{[0-9]+}/store${suffix}`, store);
  }
  return r;
}

class TooLarge extends Error {}
