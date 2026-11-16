import { describe, expect, it } from "vitest";
import { recordEvent } from "../src/issues.js";
import { FILTERED, scrubEvent } from "../src/scrub.js";
import { getConfig } from "../src/settings.js";
import { json, setup } from "./helpers.js";

describe("data scrubbing", () => {
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

  it("saves the project's fields from the settings page", async () => {
    const s = await setup();
    const put = (section: string, body: unknown) => s.app.request(`/api/projects/${s.project.id}/config/${section}`, { method: "PUT", ...json(body) });
    expect((await put("scrub", { defaults: true, fields: ["Email", "phone"] })).status).toBe(200);
    expect((await getConfig(s.db, s.project.id)).scrub).toEqual({ defaults: true, fields: ["email", "phone"] });
    expect((await put("scrub", { fields: ["bad field!"] })).status).toBe(400);
    expect((await put("nope", {})).status).toBe(400);
  });
});
