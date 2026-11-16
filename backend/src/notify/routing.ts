import { exceptions, summarize, type SentryEvent } from "../event.js";

// Routing tables in the style of Alertmanager. There are two kinds:
//
// - A project's table decides who hears about an alert. When nothing
//   matches, its default route sends to the project's members and admins.
// - A person's own table decides how alerts that reach them as a person are
//   delivered to them. It has no default: nothing matching means nothing.
//
// Routes are tried top to bottom. A route matches when all its matchers do
// (AND; there is no OR); one with none matches every alert. A matching route sends to its receivers and stops
// there unless it says continue. A sink route drops what matches, silently,
// and always stops.

// A field is in one of three states: sent with a value, sent blank (""), or
// absent (not sent at all: a tag the SDK never set, no release, no exception
// for type, no stack frames for path). The last five operators take no value
// and pick states:
//
//   empty   has an empty value: sent blank   absent   is absent: not sent
//   !value  is empty or absent         value    has a non-empty value
//   !absent is present: sent, empty or not
//
// For =, !=, =~, and !~ an absent field reads as "".
export const OPS = ["=", "!=", "=~", "!~", "value", "empty", "!absent", "absent", "!value"] as const;
export const NO_VALUE: readonly Op[] = ["value", "empty", "!absent", "absent", "!value"];
export type Op = (typeof OPS)[number];

// Fields a matcher can test. "path" is true when any in-app frame's file
// matches; "tag.<name>" reads an SDK tag. A person's table can also test
// the project's name.
export const FIELDS = ["trigger", "env", "release", "level", "type", "message", "culprit", "path"] as const;
export const PERSONAL_FIELDS = ["project", ...FIELDS] as const;

// What fires an alert: a new issue, a resolved issue firing again, one
// firing after a mute, or a spike in its events.
export type Trigger = "new" | "fired_again" | "unmuted" | "spike";

// What a project route that takes spikes counts as one (project routes
// only): an issue's events in the last hour reach `events`, and `factor`
// times its hourly average over the 24 hours before. Spikes are routed like
// any alert, by trigger and the other conditions, and a route takes them only
// with these numbers; the default route has none, so it takes no spikes. Each
// route's numbers alert an issue at most every six hours. A person's own
// table matches spikes like any alert, by trigger.
export interface Spike {
  events: number;
  factor: number;
}
export const spikeKey = (s: Spike) => `${s.events}x${s.factor}`;
export const SPIKE_LIMITS = { events: 1_000_000, factor: 1000 };

export interface Matcher {
  field: string;
  op: Op;
  value: string;
}

// user: a person by email, reached through their own routing (project only).
// assignee: whoever the issue is assigned to, through their own routing (project only; no target).
// email: an address mailed as is: a person, a list, anything.
// mattermost: a channel, "team-name/channel-name" (project only).
// mattermost_dm: a direct message to a username (personal only).
// slack: a Slack incoming webhook URL (project only).
// webhook: a URL that gets a JSON post (project only).
export const PROJECT_KINDS = ["user", "assignee", "email", "mattermost", "slack", "webhook"] as const;
export const PERSONAL_KINDS = ["email", "mattermost_dm"] as const;
export type ReceiverKind = (typeof PROJECT_KINDS)[number] | (typeof PERSONAL_KINDS)[number];

export interface Receiver {
  kind: ReceiverKind;
  target: string;
}

export interface Route {
  name: string;
  matchers: Matcher[];
  sink: boolean; // drop what matches; receivers are ignored
  receivers: Receiver[];
  continue: boolean;
  spike?: Spike; // a spike condition; project routes only
}

export type Context = "project" | "personal";

// What an alert is matched on.
export interface Facts {
  absent: Set<string>; // fields the event did not send; tags are looked up
  project: string;
  trigger: Trigger;
  env: string;
  release: string;
  level: string;
  type: string;
  message: string;
  culprit: string;
  paths: string[];
  tags: Record<string, string>;
  // For a spike alert: this hour's events, the hourly average before, and the spike conditions it newly meets.
  spike?: { events: number; usual: number; fresh: string[] };
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function messageOf(e: SentryEvent): string | undefined {
  const m = e.logentry ?? e.message;
  if (m === undefined) return undefined;
  return typeof m === "string" ? m : (m.formatted ?? m.message ?? "");
}

export function factsOf(project: string, ev: SentryEvent, trigger: Trigger): Facts {
  const all = exceptions(ev);
  const exc = all[all.length - 1];
  const frames = all.flatMap((x) => x.stacktrace?.frames ?? []).filter((f) => f.in_app);
  const message = messageOf(ev);
  const s = summarize(ev);
  const absent = new Set<string>();
  if (ev.release === undefined) absent.add("release");
  if (ev.environment === undefined) absent.add("env");
  if (ev.level === undefined) absent.add("level");
  if (!exc) absent.add("type");
  if (!exc && message === undefined) absent.add("message");
  if (!s.culprit) absent.add("culprit");
  if (frames.length === 0) absent.add("path");
  const tags = ev.tags as Record<string, unknown> | [string, unknown][] | undefined;
  return {
    absent,
    project,
    trigger,
    env: str(ev.environment),
    release: str(ev.release),
    level: str(ev.level),
    type: str(exc?.type),
    message: str(exc?.value) || message || "",
    culprit: s.culprit,
    paths: [...new Set(frames.map((f) => f.filename || f.abs_path || "").filter(Boolean))],
    tags: Object.fromEntries((Array.isArray(tags) ? tags : Object.entries(tags ?? {})).map(([k, v]) => [str(k), str(v)])),
  };
}

const values = (f: Facts, field: string): string[] => {
  if (field === "path") return f.paths.length ? f.paths : [""];
  if (field.startsWith("tag.")) return [f.tags[field.slice(4)] ?? ""];
  return [String(f[field as keyof Facts] ?? "")];
};

// Regexes match the whole value, as in Alertmanager: "prod" does not match
// "production"; write "prod.*".
const regex = (v: string) => new RegExp(`^(?:${v})$`);

const isAbsent = (f: Facts, field: string) => (field.startsWith("tag.") ? !(field.slice(4) in f.tags) : f.absent.has(field));

export function matches(f: Facts, m: Matcher): boolean {
  const vals = values(f, m.field);
  const absent = isAbsent(f, m.field);
  const hasValue = vals.some((v) => v !== "");
  switch (m.op) {
    case "value":
      return hasValue;
    case "!value":
      return !hasValue;
    case "empty":
      return !absent && !hasValue;
    case "absent":
      return absent;
    case "!absent":
      return !absent;
    case "=":
      return vals.some((v) => v === m.value);
    case "!=":
      return vals.every((v) => v !== m.value);
    case "=~": {
      const re = regex(m.value);
      return vals.some((v) => re.test(v));
    }
    case "!~": {
      const re = regex(m.value);
      return vals.every((v) => !re.test(v));
    }
  }
}

/** A spike alert fits a route whose spike numbers it newly meets; other alerts fit any route. */
function spikeFits(r: Route, f: Facts): boolean {
  if (!f.spike) return true;
  return !!r.spike && f.spike.fresh.includes(spikeKey(r.spike));
}

/**
 * The routes that match, in order, or null when none does. A sink ends the
 * list. A project's table also matches spike conditions; a person's (spikes
 * false) does not have them and takes spikes like any alert.
 */
export function evaluate(routes: Route[], f: Facts, spikes = true): Route[] | null {
  const hit: Route[] = [];
  for (const r of routes) {
    if (spikes && !spikeFits(r, f)) continue;
    if (!r.matchers.every((m) => matches(f, m))) continue;
    hit.push(r);
    if (r.sink || !r.continue) break;
  }
  return hit.length ? hit : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNEL = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]*$/i;
export const LIMITS = { routes: 50, matchers: 20, receivers: 20, value: 500 };

export function receiverError(kind: string, target: string, ctx: Context): string {
  const kinds: readonly string[] = ctx === "project" ? PROJECT_KINDS : PERSONAL_KINDS;
  if (!kinds.includes(kind)) return `unknown receiver kind "${kind}"`;
  if (kind === "assignee") return "";
  if (!target) return "fill in every receiver, or remove the empty one";
  if ((kind === "user" || kind === "email") && !EMAIL.test(target)) return `"${target}" is not an email address`;
  if (kind === "mattermost" && !CHANNEL.test(target)) return `"${target}" should be team-name/channel-name`;
  if (kind === "mattermost_dm" && !USERNAME.test(target.replace(/^@/, ""))) return `"${target}" is not a Mattermost username`;
  if (kind === "webhook" && !/^https?:\/\/\S+$/.test(target)) return `"${target}" is not an http(s) URL`;
  if (kind === "slack" && !/^https:\/\/\S+$/.test(target)) return `"${target}" is not a Slack webhook URL (https://hooks.slack.com/...)`;
  return "";
}

/** Validates and cleans a routing table from the settings pages. */
export function checkRoutes(input: unknown, ctx: Context): { error: string } | { routes: Route[] } {
  if (!Array.isArray(input)) return { error: "routes must be a list" };
  if (input.length > LIMITS.routes) return { error: `at most ${LIMITS.routes} routes` };
  const fields: readonly string[] = ctx === "project" ? FIELDS : PERSONAL_FIELDS;
  const routes: Route[] = [];
  for (const [i, raw] of (input as unknown[]).entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const at = `route ${i + 1}`;
    const ms = Array.isArray(r.matchers) ? r.matchers : [];
    const sink = r.sink === true;
    const rs = sink ? [] : Array.isArray(r.receivers) ? r.receivers : [];
    let spike: Spike | undefined;
    if (r.spike != null) {
      if (ctx !== "project") return { error: `${at}: spike conditions are for project routes` };
      const s = r.spike as Record<string, unknown>;
      const events = Math.floor(Number(s.events));
      const factor = Number(s.factor);
      if (!Number.isFinite(events) || events < 1 || events > SPIKE_LIMITS.events) return { error: `${at}: a spike needs at least 1 event in an hour` };
      if (!Number.isFinite(factor) || factor < 1 || factor > SPIKE_LIMITS.factor) return { error: `${at}: the spike's factor is between 1 and ${SPIKE_LIMITS.factor}` };
      spike = { events, factor: Math.round(factor * 10) / 10 };
    }
    if (!sink && rs.length === 0) return { error: `${at}: add a receiver, or make it a sink to drop what matches` };
    if (ms.length > LIMITS.matchers || rs.length > LIMITS.receivers) return { error: `${at}: too many conditions or receivers` };
    const matchers: Matcher[] = [];
    for (const m of ms as Record<string, unknown>[]) {
      const field = String(m.field ?? "").trim();
      const op = String(m.op ?? "") as Op;
      const value = NO_VALUE.includes(op) ? "" : String(m.value ?? "");
      if (!fields.includes(field) && !/^tag\.[\w.-]+$/.test(field)) return { error: `${at}: unknown field "${field}"` };
      if (!OPS.includes(op)) return { error: `${at}: unknown operator "${op}"` };
      if (value.length > LIMITS.value) return { error: `${at}: value too long` };
      if (op === "=~" || op === "!~") {
        try {
          regex(value);
        } catch {
          return { error: `${at}: "${value}" is not a valid regex` };
        }
      }
      matchers.push({ field, op, value });
    }
    const receivers: Receiver[] = [];
    for (const x of rs as Record<string, unknown>[]) {
      const kind = String(x.kind ?? "") as ReceiverKind;
      let target = String(x.target ?? "").trim();
      const bad = receiverError(kind, target, ctx);
      if (bad) return { error: `${at}: ${bad}` };
      if (kind === "user" || kind === "email") target = target.toLowerCase();
      if (kind === "mattermost_dm") target = target.replace(/^@/, "");
      if (kind === "assignee") target = "";
      receivers.push({ kind, target });
    }
    routes.push({ name: String(r.name ?? "").trim().slice(0, 80), matchers, sink, receivers, continue: !sink && r.continue === true, ...(spike ? { spike } : {}) });
  }
  return { routes };
}
