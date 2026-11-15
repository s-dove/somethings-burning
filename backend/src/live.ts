import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import pg from "pg";

type Listener = (projectId: number) => void;

const CHANNEL = "burning_live";
const RECONNECT_MS = 5000;

/**
 * LiveAlerts fans a project id out to the open browser streams when one of
 * its issues alerts. The payload stays that small on purpose: the sidebar dot
 * only needs to know which project fired. On Postgres it goes out through
 * NOTIFY, so the browsers connected to every server hear it, not only this
 * one's.
 */
export class LiveAlerts {
  private listeners = new Set<Listener>();
  private client: pg.Client | null = null;
  private stopped = false;

  publish(projectId: number): void {
    if (!this.client) return this.emit(projectId);
    this.client.query("SELECT pg_notify($1, $2)", [CHANNEL, String(projectId)]).catch((err: Error) => {
      console.error(`live notify failed, telling this server only: ${err.message}`);
      this.emit(projectId);
    });
  }

  private emit(projectId: number): void {
    for (const listener of this.listeners) listener(projectId);
  }

  /** Keeps one connection listening. If it drops, alerts reach this server's browsers only until it is back. */
  async listenPostgres(url: string): Promise<void> {
    const client = new pg.Client({ connectionString: url });
    const retry = () => {
      if (this.client === client) this.client = null;
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      if (!this.stopped) setTimeout(() => void this.listenPostgres(url), RECONNECT_MS).unref();
    };
    client.on("error", (err) => {
      console.error(`live listener: ${err.message}`);
      retry();
    });
    client.on("notification", (m) => {
      const id = Number(m.payload);
      if (m.channel === CHANNEL && Number.isInteger(id)) this.emit(id);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
    } catch (err) {
      console.error(`live listener: ${(err as Error).message}`);
      retry();
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    const c = this.client;
    this.client = null;
    c?.removeAllListeners();
    await c?.end().catch(() => undefined);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.listeners.size;
  }
}

/**
 * Keeps one server-sent events response open. Each alert the person may see
 * goes out as `{ "projectId": <id> }`; a ping every 25 seconds holds the
 * connection through proxies, and closing the browser unsubscribes it.
 */
export function alertEvents(c: Context, live: LiveAlerts, visible: (projectId: number) => boolean | Promise<boolean>, pingMs = 25_000): Response {
  return streamSSE(c, async (stream) => {
    const pending: number[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = live.subscribe((projectId) => {
      void Promise.resolve(visible(projectId)).then(
        (ok) => {
          if (!ok) return;
          pending.push(projectId);
          wake?.();
        },
        () => undefined,
      );
    });
    const stopped = new Promise<void>((resolve) => {
      if (c.req.raw.signal.aborted) resolve();
      else c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true });
      stream.onAbort(() => resolve());
    });
    try {
      // A first message, so the browser sees the stream open at once.
      await stream.writeSSE({ event: "ready", data: "1" });
      while (!c.req.raw.signal.aborted && !stream.aborted) {
        if (!pending.length) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, pingMs);
            }),
            stopped,
          ]);
          clearTimeout(timer);
          wake = null;
        }
        if (c.req.raw.signal.aborted || stream.aborted) break;
        const ids = pending.splice(0);
        if (!ids.length) {
          await stream.writeSSE({ event: "ping", data: "1" });
          continue;
        }
        for (const projectId of ids) await stream.writeSSE({ data: JSON.stringify({ projectId }) });
      }
    } finally {
      unsubscribe();
    }
  });
}
