import { describe, expect, it } from "vitest";
import { setGrant } from "../src/access.js";
import { saveRouting, savePersonalRoutes } from "../src/notify/store.js";
import { as, json, pythonError, setup, signIn } from "./helpers.js";

const send = async (s: ReturnType<typeof setup>, event: object = pythonError) => {
  const res = await s.app.request(`/api/${s.project.id}/store/?sentry_key=${s.project.publicKey}`, {
    method: "POST",
    headers: { host: "burning.example.com" },
    body: JSON.stringify(event),
  });
  await s.queue.idle();
  return res;
};

const targets = (s: ReturnType<typeof setup>) => s.senders.sent.map((x) => `${x.d.kind}:${x.d.target}`).sort();

describe("alerts", () => {
  it("sends a new issue to members and admins by default, once per issue", async () => {
    const s = setup();
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    setGrant(s.db, s.project.id, "user", "bo@example.com", "member");
    setGrant(s.db, s.project.id, "user", "cy@example.com", "viewer");
    await send(s);
    await send(s);
    await s.outbox.drain();
    expect(targets(s)).toEqual(["email:ana@example.com", "email:bo@example.com"]);
    const m = s.senders.sent[0]!.m;
    expect(m.subject).toBe("New issue: ZeroDivisionError: division by zero");
    expect(m.text).toContain("http://burning.example.com/p/1/issues/1");
  });

  it("follows the project's routes and each person's own routing", async () => {
    const s = setup();
    signIn(s.db, "ana@example.com");
    signIn(s.db, "bo@example.com");
    saveRouting(s.db, s.project.id, [
      { name: "prod", matchers: [{ field: "type", op: "=", value: "ZeroDivisionError" }], sink: false, continue: false,
        receivers: [{ kind: "user", target: "ana@example.com" }, { kind: "user", target: "bo@example.com" }, { kind: "webhook", target: "https://hooks.example.com/x" }] },
    ]);
    // Ana wants it elsewhere; Bo turned everything off.
    savePersonalRoutes(s.db, "ana@example.com", [
      { name: "", matchers: [{ field: "project", op: "=", value: "web" }], sink: false, continue: false, receivers: [{ kind: "email", target: "ana+alerts@example.com" }] },
    ]);
    savePersonalRoutes(s.db, "bo@example.com", []);
    await send(s);
    await s.outbox.drain();
    expect(targets(s)).toEqual(["email:ana+alerts@example.com", "webhook:https://hooks.example.com/x"]);
    expect(JSON.parse(s.senders.sent.find((x) => x.d.kind === "webhook")!.m.json)).toMatchObject({ kind: "new", project: "web", issue_id: 1 });
  });

  it("drops what a sink route matches", async () => {
    const s = setup();
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    saveRouting(s.db, s.project.id, [{ name: "noise", matchers: [{ field: "level", op: "=", value: "error" }], sink: true, receivers: [], continue: false }]);
    await send(s);
    await s.outbox.drain();
    expect(targets(s)).toEqual([]);
  });

  it("serves and saves a person's notification routing", async () => {
    const s = setup({ auth: true });
    signIn(s.db, "ana@example.com", { preferred_username: "ana", name: "Ana" });
    const who = as("ana@example.com");
    const first = (await (await s.app.request("/api/profile/notifications", { headers: who })).json()) as { initial: boolean; routes: unknown[] };
    expect(first.initial).toBe(true);
    expect(first.routes).toHaveLength(1);
    const saved = await s.app.request("/api/profile/notifications", { method: "PUT", ...json({ routes: [] }, who) });
    expect(await saved.json()).toMatchObject({ initial: false, routes: [] });
    const test = await s.app.request("/api/profile/notifications/test", { method: "POST", ...json({ kind: "email", target: "ana@example.com" }, who) });
    expect(test.status).toBe(200);
    expect(targets(s)).toEqual(["email:ana@example.com"]);
  });

  it("lets only admins change a project's routing", async () => {
    const s = setup({ auth: true });
    setGrant(s.db, s.project.id, "user", "ana@example.com", "admin");
    setGrant(s.db, s.project.id, "user", "bo@example.com", "member");
    const put = (who: string) =>
      s.app.request(`/api/projects/${s.project.id}/routing`, { method: "PUT", ...json({ routes: [] }, as(who)) });
    expect((await put("bo@example.com")).status).toBe(403);
    const ok = (await (await put("ana@example.com")).json()) as { defaultRecipients: { email: string }[] };
    expect(ok.defaultRecipients.map((p) => p.email)).toEqual(["ana@example.com", "bo@example.com"]);
  });
});
