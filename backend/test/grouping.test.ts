import { describe, expect, it } from "vitest";
import { summarize, type SentryEvent } from "../src/event.js";
import { fingerprint, normalizeMessage } from "../src/grouping.js";

const frame = (filename: string, fn: string, lineno = 1, in_app = true) => ({ filename, function: fn, lineno, in_app });
const exc = (type: string, value: string, frames: object[] = []) => ({ type, value, stacktrace: { frames } }) as never;
const ev = (o: Partial<SentryEvent>): SentryEvent => o;

describe("grouping", () => {
  it("groups by message template", async () => {
    const a = ev({ logentry: { message: "user %s not found", formatted: "user 12 not found" } });
    const b = ev({ logentry: { message: "user %s not found", formatted: "user 13 not found" } });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("masks what changes per occurrence in a plain message", async () => {
    expect(fingerprint(ev({ message: "user 12 not found" }))).toBe(fingerprint(ev({ message: "user 13 not found" })));
    expect(normalizeMessage("order 3f2a1c9e-1b2c-4d5e-8f90-123456789abc for 'ana' cost 12.50 at 0x7ff3\nmore")).toBe(
      "order <uuid> for <str> cost <n> at <hex>",
    );
    expect(fingerprint(ev({ message: "disk full" }))).not.toBe(fingerprint(ev({ message: "disk empty" })));
  });

  it("groups by exception type and frames despite value and line changes", async () => {
    const e = (value: string, lineno: number) =>
      ev({ exception: { values: [{ type: "KeyError", value, stacktrace: { frames: [{ module: "app.views", function: "get", in_app: true, lineno }] } }] } });
    expect(fingerprint(e("'a'", 10))).toBe(fingerprint(e("'b'", 12)));
    expect(summarize(e("'a'", 10)).title).toBe("KeyError: 'a'");
    expect(summarize(e("'a'", 10)).culprit).toBe("app.views in get");
  });

  it("lets a custom fingerprint win, and expands {{ default }} inside it", async () => {
    expect(fingerprint(ev({ fingerprint: ["checkout-timeout"], message: "x" }))).toBe(fingerprint(ev({ fingerprint: ["checkout-timeout"], message: "y" })));
    const withDefault = (message: string) => ev({ fingerprint: ["{{ default }}", "eu"], message });
    expect(fingerprint(withDefault("x"))).not.toBe(fingerprint(withDefault("y")));
    expect(fingerprint(withDefault("x"))).not.toBe(fingerprint(ev({ fingerprint: ["{{ default }}", "us"], message: "x" })));
    expect(fingerprint(ev({ fingerprint: ["{{default}}"], message: "x" }))).toBe(fingerprint(ev({ message: "x" })));
  });

  it("uses only the five frames of your code closest to the error", async () => {
    const deep = (caller: string) =>
      ev({ exception: { values: [exc("Boom", "x", [frame(`app/${caller}.py`, caller), ...["a", "b", "c", "d", "e"].map((f) => frame(`app/${f}.py`, f))])] } });
    expect(fingerprint(deep("cron"))).toBe(fingerprint(deep("web")));
    const shallow = (caller: string) => ev({ exception: { values: [exc("Boom", "x", [frame(`app/${caller}.py`, caller), frame("app/a.py", "a")])] } });
    expect(fingerprint(shallow("cron"))).not.toBe(fingerprint(shallow("web")));
  });

  it("ignores library frames, and keeps only the file and its folder", async () => {
    const e = (root: string, lib: string) =>
      ev({ exception: { values: [exc("Boom", "x", [frame(`${root}/srv/app/views.py`, "get"), frame(`/usr/lib/${lib}/http.py`, "send", 1, false)])] } });
    expect(fingerprint(e("/home/ana", "py3.11"))).toBe(fingerprint(e("/opt/deploy", "py3.12")));
  });

  it("falls back to every frame when the SDK marks none as yours, and to the value with no frames", async () => {
    const lib = (fn: string) => ev({ exception: { values: [exc("Boom", "x", [frame("lib/a.py", fn, 1, false)])] } });
    expect(fingerprint(lib("one"))).not.toBe(fingerprint(lib("two")));
    const bare = (value: string) => ev({ exception: { values: [exc("Boom", value)] } });
    expect(fingerprint(bare("id 12 missing"))).toBe(fingerprint(bare("id 13 missing")));
    expect(fingerprint(bare("missing"))).not.toBe(fingerprint(bare("gone")));
  });

  it("includes every exception in the chain", async () => {
    const chain = (cause: string) => ev({ exception: { values: [exc(cause, "x", [frame("app/db.py", "q")]), exc("RequestFailed", "x", [frame("app/api.py", "h")])] } });
    expect(fingerprint(chain("Timeout"))).not.toBe(fingerprint(chain("ConnectionReset")));
  });
});

describe("culprit", () => {
  it("prefers the transaction, then the innermost frame of your code", () => {
    const e = { exception: { values: [{ type: "KeyError", value: "x", stacktrace: { frames: [{ module: "app.views", function: "get", in_app: true }] } }] } };
    expect(summarize({ ...e, transaction: "/manage/alerts/{alert_id}" }).culprit).toBe("/manage/alerts/{alert_id}");
    expect(summarize(e).culprit).toBe("app.views in get");
    expect(summarize({ message: "hi", culprit: "legacy.place" }).culprit).toBe("legacy.place");
  });
});
