import { exceptions, type Frame, type SentryEvent } from "./event.js";
import type { StoredEvent } from "./issues.js";

// EventView is a stored event shaped for the issue page: the fields people
// read, with stack frames newest call first and their source lines numbered.

export type FrameView = {
  location: string;
  function: string;
  lineno: number;
  inApp: boolean;
  lines: { no: number; text: string; current: boolean }[];
  vars: [string, string][];
  link: string; // the line in the repository, "" when no code source covers it
  linesFrom: string; // "repo@sha" when the code lines were read from a code source, not sent by the SDK
  changed: string; // added, modified, removed: how the file changed since the previous release
};

export type EventView = {
  id: number;
  eventId: string;
  receivedAt: number;
  release: string;
  environment: string;
  serverName: string;
  level: string; // as the SDK sent it; "" when it did not
  platform: string;
  sdk: string;
  message: string;
  tags: [string, string][];
  exceptions: { type: string; value: string; handled: string; frames: FrameView[] }[];
  breadcrumbs: { timestamp: number | null; category: string; level: string; message: string; data: string }[];
  context: [string, string][];
  raw: string;
};

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const pretty = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Sentry timestamps are seconds (a number) or an ISO string. */
function millis(v: unknown): number | null {
  if (typeof v === "number") return Math.round(v * 1000);
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function frameView(f: Frame & { vars?: Record<string, unknown> }): FrameView {
  const lineno = typeof f.lineno === "number" ? f.lineno : 0;
  const lines: FrameView["lines"] = [];
  if (f.context_line != null && lineno > 0) {
    const pre = f.pre_context ?? [];
    pre.forEach((t, i) => lines.push({ no: lineno - pre.length + i, text: t, current: false }));
    lines.push({ no: lineno, text: f.context_line, current: true });
    (f.post_context ?? []).forEach((t, i) => lines.push({ no: lineno + i + 1, text: t, current: false }));
  }
  return {
    location: f.filename || f.abs_path || f.module || "?",
    function: text(f.function),
    lineno,
    inApp: f.in_app === true,
    lines,
    vars: Object.entries(f.vars ?? {}).map(([k, v]) => [k, pretty(v)]),
    link: "",
    linesFrom: "",
    changed: "",
  };
}

function messageOf(e: SentryEvent): string {
  const m = e.logentry ?? e.message;
  if (!m) return "";
  return typeof m === "string" ? m : (m.formatted ?? m.message ?? "");
}

function tagsOf(e: SentryEvent): [string, string][] {
  const t = e.tags as Record<string, unknown> | [string, unknown][] | undefined;
  if (!t) return [];
  const pairs = Array.isArray(t) ? t : Object.entries(t);
  return pairs.map(([k, v]) => [text(k), text(v)]);
}

function breadcrumbsOf(e: SentryEvent): EventView["breadcrumbs"] {
  const b = e.breadcrumbs as { values?: unknown[] } | unknown[] | undefined;
  const list = (Array.isArray(b) ? b : (b?.values ?? [])) as Record<string, unknown>[];
  return list.map((c) => ({
    timestamp: millis(c.timestamp),
    category: text(c.category ?? c.type),
    level: text(c.level),
    message: text(c.message),
    data: c.data && Object.keys(c.data).length ? JSON.stringify(c.data) : "",
  }));
}

function contextOf(e: SentryEvent): [string, string][] {
  const out: [string, string][] = [];
  if (e.request) out.push(["request", pretty(e.request)]);
  if (e.user) out.push(["user", pretty(e.user)]);
  for (const [k, v] of Object.entries((e.contexts as Record<string, unknown>) ?? {})) out.push([k, pretty(v)]);
  if (e.extra && Object.keys(e.extra).length) out.push(["extra", pretty(e.extra)]);
  return out;
}

export function eventView(stored: StoredEvent): EventView {
  const e = stored.payload;
  const sdk = e.sdk as { name?: string; version?: string } | undefined;
  return {
    id: stored.id,
    eventId: stored.eventId,
    receivedAt: stored.receivedAt,
    release: text(e.release),
    environment: text(e.environment),
    serverName: text(e.server_name),
    level: text(e.level),
    platform: text(e.platform),
    sdk: sdk?.name ? `${sdk.name}${sdk.version ? ` ${sdk.version}` : ""}` : "",
    message: messageOf(e),
    tags: tagsOf(e),
    // Sentry lists chained exceptions oldest first: show the raised one first.
    exceptions: [...exceptions(e)].reverse().map((x) => {
      const handled = (x as { mechanism?: { handled?: boolean } }).mechanism?.handled;
      return {
        type: text(x.type),
        value: text(x.value),
        handled: handled === true ? "handled" : handled === false ? "unhandled" : "",
        frames: [...(x.stacktrace?.frames ?? [])].reverse().map(frameView),
      };
    }),
    breadcrumbs: breadcrumbsOf(e),
    context: contextOf(e),
    raw: JSON.stringify(e, null, 2),
  };
}
