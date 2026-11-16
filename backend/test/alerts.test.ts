import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { listActivity } from "../src/activity.js";
import { digestFor, sendDueDigests } from "../src/digest.js";
import { recordEvent } from "../src/issues.js";
import { planFor, summary } from "../src/notify/plan.js";
import { checkRoutes, factsOf } from "../src/notify/routing.js";
import { saveRouting } from "../src/notify/store.js";
import { pythonError, setup, signIn } from "./helpers.js";

describe("spikes and daily summaries", () => {
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

describe("Slack", () => {
  it("posts alerts to a Slack webhook", async () => {
    const s = await setup();
    await saveRouting(s.db, s.project.id, [{ name: "", matchers: [{ field: "level", op: "=~", value: ".*" }], sink: false, continue: false, receivers: [{ kind: "slack", target: "https://hooks.slack.com/services/T/B/x" }] }]);
    await s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, { method: "POST", body: JSON.stringify(pythonError) });
    await s.queue.idle();
    await s.outbox.drain();
    expect(s.senders.sent.map((x) => [x.d.kind, x.d.target])).toEqual([["slack", "https://hooks.slack.com/services/T/B/x"]]);
  });
});
