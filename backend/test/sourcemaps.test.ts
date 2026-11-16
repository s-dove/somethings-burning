import { describe, expect, it } from "vitest";
import { recordEvent } from "../src/issues.js";
import { json, setup } from "./helpers.js";

type Frame = { location: string; function: string; lineno: number; mapped: string; lines: { text: string; current: boolean }[] };
const detail = async (s: Awaited<ReturnType<typeof setup>>, issueId: number) =>
  (await (await s.app.request(`/api/projects/${s.project.id}/issues/${issueId}`)).json()) as { event: { exceptions: { frames: Frame[] }[] } };

describe("JavaScript source maps", () => {
  // app.min.js line 1, column 0 is src/app.ts line 3 in function "boom".
  const map = JSON.stringify({
    version: 3,
    file: "app.min.js",
    sources: ["webpack://shop/./src/app.ts"],
    names: ["boom"],
    mappings: "AAEAA",
    sourcesContent: ["import x from 'y';\n\nexport function boom() { throw new Error('x'); }\nboom();"],
  });
  const jsEvent = {
    platform: "javascript",
    release: "shop@1.2.0",
    exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [{ filename: "/static/js/app.min.js", abs_path: "https://shop.example.com/static/js/app.min.js", function: "a", lineno: 1, colno: 1, in_app: true }] } }] },
  };

  it("maps a minified frame to its original file, line, function, and code", async () => {
    const s = await setup();
    const up = await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", ...json({ release: "shop@1.2.0", name: "~/static/js/app.min.js.map", content: map }) });
    expect(up.status).toBe(201);
    const { issueId } = await recordEvent(s.db, s.project.id, jsEvent);
    const f = (await detail(s, issueId)).event.exceptions[0]!.frames[0]!;
    expect(f).toMatchObject({ location: "src/app.ts", function: "boom", lineno: 3, mapped: "https://shop.example.com/static/js/app.min.js:1:1" });
    expect(f.lines.find((l) => l.current)!.text).toBe("export function boom() { throw new Error('x'); }");
    const list = (await (await s.app.request(`/api/projects/${s.project.id}/sourcemaps?release=shop@1.2.0`)).json()) as { artifacts: { name: string }[] };
    expect(list.artifacts.map((a) => a.name)).toEqual(["~/static/js/app.min.js.map"]);
  });

  it("takes multipart uploads and refuses what is not a source map", async () => {
    const s = await setup();
    const form = new FormData();
    form.set("release", "shop@1.2.0");
    form.set("prefix", "~/static/js/");
    form.append("file", new File([map], "app.min.js.map"));
    const res = await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", body: form });
    expect(await res.json()).toEqual({ release: "shop@1.2.0", uploaded: ["~/static/js/app.min.js.map"] });
    expect((await s.app.request(`/api/projects/${s.project.id}/sourcemaps`, { method: "POST", ...json({ release: "r", name: "x.map", content: "{}" }) })).status).toBe(400);
  });
});
