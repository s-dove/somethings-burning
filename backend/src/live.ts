import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

type Listener = (projectId: number) => void;

/**
 * LiveAlerts fans a project id out to the open browser streams when one of
 * its issues alerts. The payload stays that small on purpose: the sidebar dot
 * only needs to know which project fired. One server, so it lives in memory.
 */
export class LiveAlerts {
  private listeners = new Set<Listener>();

  publish(projectId: number): void {
    for (const listener of this.listeners) listener(projectId);
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
