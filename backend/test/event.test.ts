import { describe, expect, it } from "vitest";
import { summarize } from "../src/event.js";
import { pythonError } from "./helpers.js";

describe("summarize", () => {
  it("groups the same stack with different messages together", async () => {
    const a = summarize(pythonError);
    const b = summarize({
      ...pythonError,
      exception: { values: [{ ...pythonError.exception.values[0]!, value: "other" }] },
    });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("uses an explicit fingerprint", async () => {
    const a = summarize({ ...pythonError, fingerprint: ["db-timeout"] });
    const b = summarize({ message: "x", fingerprint: ["db-timeout"] });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("titles message events with the formatted message", async () => {
    const s = summarize({ logentry: { message: "user %s failed", formatted: "user 7 failed" } });
    expect(s.title).toBe("user 7 failed");
    expect(s.fingerprint).toBe(summarize({ logentry: { message: "user %s failed", formatted: "user 9 failed" } }).fingerprint);
  });
});
