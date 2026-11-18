import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: unknown[] = [];
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: (err: unknown) => captured.push(err),
}));

const { createApp } = await import("../src/app.js");
const { ownProject, selfReport, startSelfReport, webSettingsTag } = await import("../src/self-report.js");
const { testDb } = await import("./helpers.js");

const settings = { dsn: "https://key@burning.example.com/7", webDSN: "", environment: "test", release: "burning@1.2.3" };

describe("Burning's own errors", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("knows its own project only on its own host", () => {
    expect(ownProject("https://k@burning.example.com/7", "https://burning.example.com")).toEqual({ host: "burning.example.com", project: "7" });
    expect(ownProject("https://k@other.example.com/7", "https://burning.example.com")).toBeNull();
    expect(ownProject("https://k@other.example.com/7", "")).toEqual({ host: "", project: "7" });
  });

  it("reports a failed request, and answers it with a plain 500", async () => {
    startSelfReport(settings, "https://burning.example.com");
    const { app } = createApp(await testDb());
    app.get("/boom", () => {
      throw new TypeError("boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
    expect(captured).toEqual([new TypeError("boom")]);
  });

  it("does not report a failure with its own project's events", () => {
    startSelfReport(settings, "https://burning.example.com");
    selfReport(new Error("own"), { projectId: 7 });
    selfReport(new Error("other"), { projectId: 8 });
    expect(captured.map((e) => (e as Error).message)).toEqual(["other"]);
  });

  it("hands the page its settings, escaped, only with a web DSN", () => {
    expect(webSettingsTag(settings)).toBe("");
    const tag = webSettingsTag({ ...settings, webDSN: "https://k@b.example.com/8", release: 'x"<y' });
    expect(tag).toBe(
      '<meta name="burning-sentry" content="{&quot;dsn&quot;:&quot;https://k@b.example.com/8&quot;,&quot;environment&quot;:&quot;test&quot;,&quot;release&quot;:&quot;x\\&quot;&lt;y&quot;}" />',
    );
  });
});
