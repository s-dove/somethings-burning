import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pythonError, setup } from "./helpers.js";

const auth = (key: string) => ({ "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=test/1.0` });

function envelope(dsn: string, event: object, extra = ""): string {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: "abc", dsn }),
    JSON.stringify({ type: "event", length: Buffer.byteLength(payload) }),
    payload,
    extra,
  ].join("\n");
}

describe("ingest", () => {
  it("stores an envelope event and groups repeats into one issue", async () => {
    const { app, project } = setup();
    const dsn = `http://${project.publicKey}@localhost/${project.id}`;
    for (let i = 0; i < 2; i++) {
      const res = await app.request(`/api/${project.id}/envelope/`, {
        method: "POST",
        body: envelope(dsn, { ...pythonError, event_id: undefined }, `${JSON.stringify({ type: "session" })}\n{}`),
      });
      expect(res.status).toBe(200);
    }
    const { issues } = (await (await app.request(`/api/projects/${project.id}/issues`)).json()) as {
      issues: { id: number; title: string; culprit: string; count: number }[];
    };
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      title: "ZeroDivisionError: division by zero",
      culprit: "app.views in ratio",
      count: 2,
    });

    const detail = (await (await app.request(`/api/projects/${project.id}/issues/${issues[0]!.id}`)).json()) as {
      events: unknown[];
    };
    expect(detail.events).toHaveLength(2);
  });

  it("accepts the legacy store endpoint with gzip", async () => {
    const { app, project } = setup();
    const res = await app.request(`/api/${project.id}/store/`, {
      method: "POST",
      headers: { ...auth(project.publicKey), "content-encoding": "gzip" },
      body: gzipSync(JSON.stringify(pythonError)),
    });
    expect(await res.json()).toEqual({ id: pythonError.event_id });
  });

  it("takes the key from the query string, as browser SDKs send it", async () => {
    const { app, project } = setup();
    const res = await app.request(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong key and an unknown project", async () => {
    const { app, project } = setup();
    const wrong = await app.request(`/api/${project.id}/store/`, {
      method: "POST",
      headers: auth("nope"),
      body: JSON.stringify(pythonError),
    });
    expect(wrong.status).toBe(401);
    const unknown = await app.request(`/api/999/store/`, {
      method: "POST",
      headers: auth(project.publicKey),
      body: JSON.stringify(pythonError),
    });
    expect(unknown.status).toBe(404);
  });

  it("answers CORS preflight", async () => {
    const { app, project } = setup();
    const res = await app.request(`/api/${project.id}/envelope/`, {
      method: "OPTIONS",
      headers: { origin: "https://site.example", "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
