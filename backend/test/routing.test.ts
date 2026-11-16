import { describe, expect, it } from "vitest";
import { checkRoutes, evaluate, factsOf, matches, type Route } from "../src/notify/routing.js";
import { pythonError } from "./helpers.js";

const facts = (ev: object = pythonError) => factsOf("web", { environment: "production", release: "web@1.2.0", tags: { region: "eu" }, ...ev }, "new");

describe("routing", () => {
  it("matches fields, whole-value regexes, tags, and paths", async () => {
    const f = facts();
    expect(matches(f, { field: "env", op: "=", value: "production" })).toBe(true);
    expect(matches(f, { field: "env", op: "=~", value: "prod" })).toBe(false);
    expect(matches(f, { field: "env", op: "=~", value: "prod.*" })).toBe(true);
    expect(matches(f, { field: "type", op: "=", value: "ZeroDivisionError" })).toBe(true);
    expect(matches(f, { field: "culprit", op: "=", value: "app.views in ratio" })).toBe(true);
    expect(matches(f, { field: "path", op: "=~", value: "app/.*" })).toBe(true);
    expect(matches(f, { field: "tag.region", op: "=", value: "eu" })).toBe(true);
    expect(matches(f, { field: "tag.missing", op: "absent", value: "" })).toBe(true);
  });

  it("tells absent fields from empty ones", async () => {
    const f = factsOf("web", { message: "hi", environment: "" }, "new");
    expect(matches(f, { field: "env", op: "empty", value: "" })).toBe(true);
    expect(matches(f, { field: "env", op: "absent", value: "" })).toBe(false);
    expect(matches(f, { field: "release", op: "absent", value: "" })).toBe(true);
    expect(matches(f, { field: "release", op: "!value", value: "" })).toBe(true);
    expect(matches(f, { field: "type", op: "absent", value: "" })).toBe(true);
  });

  it("stops at the first match unless it says continue, and at any sink", async () => {
    const r = (name: string, env: string, extra: Partial<Route> = {}): Route => ({
      name,
      matchers: [{ field: "env", op: "=~", value: env }],
      sink: false,
      receivers: [{ kind: "email", target: `${name}@example.com` }],
      continue: false,
      ...extra,
    });
    const f = facts();
    expect(evaluate([r("a", "prod.*"), r("b", ".*")], f)!.map((x) => x.name)).toEqual(["a"]);
    expect(evaluate([r("a", "prod.*", { continue: true }), r("b", ".*")], f)!.map((x) => x.name)).toEqual(["a", "b"]);
    expect(evaluate([r("a", "prod.*", { sink: true, receivers: [] }), r("b", ".*")], f)!.map((x) => x.name)).toEqual(["a"]);
    expect(evaluate([r("a", "staging")], f)).toBeNull();
  });

  it("checks tables from the settings pages", async () => {
    const ok = checkRoutes([{ matchers: [{ field: "env", op: "=", value: "x" }], receivers: [{ kind: "email", target: "A@Example.com" }] }], "project");
    expect(ok).toEqual({ routes: [{ name: "", matchers: [{ field: "env", op: "=", value: "x" }], sink: false, receivers: [{ kind: "email", target: "a@example.com" }], continue: false }] });
    expect(checkRoutes([{ matchers: [], receivers: [] }], "project")).toEqual({ error: "route 1: add a receiver, or make it a sink to drop what matches" });
    expect(checkRoutes([{ matchers: [{ field: "env", op: "=~", value: "(" }], sink: true }], "project")).toMatchObject({ error: expect.stringMatching(/not a valid regex/) });
    expect(checkRoutes([{ matchers: [{ field: "project", op: "=", value: "x" }], sink: true }], "project")).toMatchObject({ error: expect.stringMatching(/unknown field/) });
    expect(checkRoutes([{ matchers: [{ field: "project", op: "=", value: "x" }], receivers: [{ kind: "webhook", target: "https://x" }] }], "personal")).toMatchObject({ error: expect.stringMatching(/unknown receiver kind/) });
  });
});
