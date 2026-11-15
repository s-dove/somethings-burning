import { createHash } from "node:crypto";
import { exceptions, type Frame, type SentryEvent } from "./event.js";

// How many frames closest to the error decide the group. Deeper frames vary
// with the caller and would split one bug into many issues.
const GROUPING_FRAMES = 5;

/**
 * The grouping key of an event: events with the same fingerprint are one
 * issue. An SDK fingerprint wins, and "{{ default }}" inside it expands to
 * the default parts.
 */
export function fingerprint(e: SentryEvent): string {
  let parts = defaultParts(e);
  const custom = Array.isArray(e.fingerprint) ? e.fingerprint.map((p) => String(p)) : [];
  if (custom.length) parts = custom.flatMap((p) => (p.replaceAll(" ", "") === "{{default}}" ? parts : [`custom:${p}`]));
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/**
 * Each exception in the chain gives its type and the frames of your code
 * closest to where it was raised; with no frames, its message stands in.
 * Without an exception, the message template.
 */
function defaultParts(e: SentryEvent): string[] {
  const chain = exceptions(e);
  if (chain.length) {
    return chain.flatMap((exc) => {
      const frames = inAppFrames(exc.stacktrace?.frames ?? []).slice(-GROUPING_FRAMES);
      const parts = [`type:${exc.type ?? ""}`, ...frames.map((f) => `frame:${frameLocation(f)}:${f.function ?? ""}`)];
      if (!frames.length) parts.push(`value:${normalizeMessage(exc.value ?? "")}`);
      return parts;
    });
  }
  // The unformatted template groups "user 12 not found" with "user 13 not found".
  return [`message:${normalizeMessage(messageTemplate(e))}`];
}

/** The frames of your code, or every frame when the SDK marked none as yours. */
export function inAppFrames(frames: Frame[]): Frame[] {
  const app = frames.filter((f) => f.in_app);
  return app.length ? app : frames;
}

function frameLocation(f: Frame): string {
  if (f.module) return f.module;
  // Absolute paths differ per machine; keep the file and its directory.
  const parts = (f.filename || f.abs_path || "").replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function messageTemplate(e: SentryEvent): string {
  const m = e.logentry ?? e.message;
  if (!m) return "";
  if (typeof m === "string") return m;
  return m.message || m.formatted || "";
}

const firstLine = (s: string): string => s.trim().split("\n")[0]?.trim() ?? "";

/** Masks the parts of a message that change per occurrence. */
export function normalizeMessage(s: string): string {
  return firstLine(s)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/'[^']*'|"[^"]*"/g, "<str>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>");
}
