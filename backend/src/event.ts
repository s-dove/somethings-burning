import { createHash } from "node:crypto";

// The parts of a Sentry event that Burning reads. Everything else is kept in
// the stored payload as is.
export type Frame = {
  filename?: string;
  abs_path?: string;
  module?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
};

export type ExceptionValue = {
  type?: string;
  value?: string;
  module?: string;
  stacktrace?: { frames?: Frame[] };
};

export type SentryEvent = {
  event_id?: string;
  timestamp?: number | string;
  level?: string;
  platform?: string;
  culprit?: string;
  transaction?: string;
  message?: string | { formatted?: string; message?: string };
  logentry?: { formatted?: string; message?: string };
  exception?: { values?: ExceptionValue[] } | ExceptionValue[];
  fingerprint?: string[];
  [key: string]: unknown;
};

export type Summary = {
  eventId: string;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  fingerprint: string;
};

export function exceptions(event: SentryEvent): ExceptionValue[] {
  const ex = event.exception;
  if (!ex) return [];
  return Array.isArray(ex) ? ex : (ex.values ?? []);
}

function messageOf(event: SentryEvent): { text: string; template: string } | undefined {
  const m = event.logentry ?? event.message;
  if (!m) return undefined;
  if (typeof m === "string") return { text: m, template: m };
  const text = m.formatted ?? m.message ?? "";
  return text ? { text, template: m.message ?? text } : undefined;
}

/** The frame where the error was raised: the innermost in-app frame, or the innermost one. */
function topFrame(ex: ExceptionValue | undefined): Frame | undefined {
  const frames = ex?.stacktrace?.frames ?? [];
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i]?.in_app) return frames[i];
  return frames[frames.length - 1];
}

function frameLabel(f: Frame): string {
  const where = f.module || f.filename || f.abs_path || "?";
  return f.function ? `${where} in ${f.function}` : where;
}

const sha1 = (parts: string[]) => createHash("sha1").update(parts.join("\n")).digest("hex");

/**
 * Groups events into issues. An explicit fingerprint wins; otherwise the
 * exception type and its in-app frames (so the same bug with a different
 * message is one issue), then the type and value, then the message template.
 */
function fingerprintOf(event: SentryEvent, main: ExceptionValue | undefined): string {
  const fp = event.fingerprint;
  if (fp && fp.length > 0 && !(fp.length === 1 && fp[0] === "{{ default }}")) {
    return sha1(["custom", ...fp]);
  }
  if (main) {
    const frames = main.stacktrace?.frames ?? [];
    const inApp = frames.filter((f) => f.in_app);
    const use = (inApp.length > 0 ? inApp : frames).map(
      (f) => `${f.module || f.filename || f.abs_path || ""}:${f.function ?? ""}`,
    );
    if (use.length > 0) return sha1(["stack", main.type ?? "", ...use]);
    return sha1(["exception", main.type ?? "", main.value ?? ""]);
  }
  return sha1(["message", messageOf(event)?.template ?? ""]);
}

export function summarize(event: SentryEvent): Summary {
  const all = exceptions(event);
  // Sentry lists chained exceptions oldest first; the last one is what was raised.
  const main = all[all.length - 1];
  const msg = messageOf(event);

  let title = "<unlabeled event>";
  if (main) title = main.value ? `${main.type ?? "Error"}: ${main.value}` : (main.type ?? "Error");
  else if (msg) title = msg.text;

  const frame = topFrame(main);
  const culprit = event.culprit || (frame ? frameLabel(frame) : "") || event.transaction || "";

  return {
    eventId: (event.event_id ?? crypto.randomUUID()).replaceAll("-", ""),
    title: title.split("\n")[0]!.slice(0, 500),
    culprit: culprit.slice(0, 500),
    level: event.level ?? "error",
    platform: event.platform ?? "",
    fingerprint: fingerprintOf(event, main),
  };
}
