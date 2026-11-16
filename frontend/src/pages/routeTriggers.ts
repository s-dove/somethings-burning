import type { Matcher, Route } from "../shared/api";

// What fires an alert. The route editor picks these at the top instead of
// as conditions; they are stored as one "trigger" condition. A project route
// takes spikes when it has spike numbers; a person's route takes them by trigger.

export const TRIGGERS = ["new", "fired_again", "unmuted", "spike"] as const;
export type Trigger = (typeof TRIGGERS)[number];
const PLAIN: Trigger[] = ["new", "fired_again", "unmuted"];
export const TRIGGER_LABEL: Record<Trigger, string> = { new: "New issue", fired_again: "Fired again", unmuted: "After a mute", spike: "Spike" };
export const TRIGGER_HINT: Record<Trigger, string> = {
  new: "The first event of an issue",
  fired_again: "An event after the issue was resolved",
  unmuted: "The first event after a mute ended",
  spike: "An issue's events in an hour jump well above its usual rate",
};
export const DEFAULT_SPIKE = { events: 50, factor: 5 };

const passes = (m: Matcher, t: string): boolean => {
  switch (m.op) {
    case "=": return t === m.value;
    case "!=": return t !== m.value;
    case "=~": try { return new RegExp(`^(?:${m.value})$`).test(t); } catch { return false; }
    case "!~": try { return !new RegExp(`^(?:${m.value})$`).test(t); } catch { return true; }
    case "value": case "!absent": return true;
    default: return false;
  }
};

/** The triggers a route takes. */
export function triggersOf(r: Route, project: boolean): Set<Trigger> {
  const ms = r.matchers.filter((m) => m.field === "trigger");
  const out = new Set<Trigger>(PLAIN.filter((t) => ms.every((m) => passes(m, t))));
  if (project ? !!r.spike : ms.every((m) => passes(m, "spike"))) out.add("spike");
  return out;
}

/** The route with these triggers: one trigger condition first, or none when it takes them all. */
export function withTriggers(r: Route, on: Set<Trigger>, project: boolean): Route {
  const rest = r.matchers.filter((m) => m.field !== "trigger");
  const allPlain = PLAIN.every((t) => on.has(t));
  const needed = !(allPlain && (on.has("spike") || project));
  const list = TRIGGERS.filter((t) => on.has(t));
  const matchers = needed ? [{ field: "trigger", op: (list.length === 1 ? "=" : "=~") as Matcher["op"], value: list.join("|") }, ...rest] : rest;
  const next: Route = { ...r, matchers };
  if (project) {
    if (on.has("spike")) next.spike = r.spike ?? DEFAULT_SPIKE;
    else delete next.spike;
  }
  return next;
}
