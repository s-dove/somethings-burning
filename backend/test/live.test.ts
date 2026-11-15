import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { createProject } from "../src/projects.js";
import { as, pythonError, setup } from "./helpers.js";

/** Opens the alert stream as `who` and collects what arrives until stopped. */
async function listen(s: ReturnType<typeof setup>, who: string) {
  const ctrl = new AbortController();
  const res = await s.app.request("/api/alerts", { headers: as(who), signal: ctrl.signal });
  const got: string[] = [];
  const reader = res.body!.getReader();
  const done = (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        got.push(dec.decode(value));
      }
    } catch {
      /* aborted */
    }
  })();
  // Wait until the stream is subscribed.
  while (!got.join("").includes("event: ready")) await new Promise((r) => setTimeout(r, 2));
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    data: () => got.join("").split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)) as { projectId: number }),
    stop: async () => {
      ctrl.abort();
      await reader.cancel().catch(() => undefined);
      await done;
    },
  };
}

describe("live alerts", () => {
  it("streams the project id when one of its issues alerts, only to people who can see it", async () => {
    const s = setup({ auth: true });
    const other = createProject(s.db, "api");
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    setGrant(s.db, other.id, "user", "bo@example.com", "admin");

    const ana = await listen(s, "ana@example.com");
    const bo = await listen(s, "bo@example.com");
    expect(ana.status).toBe(200);
    expect(ana.type).toContain("text/event-stream");
    expect(s.live.size).toBe(2);

    const send = (p: { id: number; publicKey: string }, body: object) =>
      s.app.request(`/api/${p.id}/store/?sentry_key=${p.publicKey}`, { method: "POST", body: JSON.stringify(body) });
    await send(s.project, pythonError); // a new issue: alerts
    await send(s.project, pythonError); // the same issue again: no alert
    await send(other, { message: "elsewhere" });
    await s.queue.idle();
    await new Promise((r) => setTimeout(r, 20));

    expect(ana.data()).toEqual([{ projectId: s.project.id }]);
    expect(bo.data()).toEqual([{ projectId: other.id }]);
    await ana.stop();
    await bo.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.live.size).toBe(0);
  });

  it("needs a session", async () => {
    const s = setup({ auth: true });
    expect((await s.app.request("/api/alerts")).status).toBe(401);
  });
});
