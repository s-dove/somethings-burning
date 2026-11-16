import type { SentryEvent } from "./event.js";
import { factsOf, type Facts } from "./notify/routing.js";
import type { OwnerRule } from "./settings.js";

// Project rules that look at an event. A rule matches when its regex finds
// the value anywhere; "path" matches any in-app frame's file.

type FieldRule = { field: OwnerRule["field"]; tag?: string; pattern: string };

function values(f: Facts, r: FieldRule): string[] {
  switch (r.field) {
    case "path":
      return f.paths;
    case "type":
      return [f.type];
    case "message":
      return [f.message];
    case "culprit":
      return [f.culprit];
    case "tag":
      return r.tag && r.tag in f.tags ? [f.tags[r.tag]!] : [];
  }
}

export function ruleMatches(f: Facts, r: FieldRule): boolean {
  let re: RegExp;
  try {
    re = new RegExp(r.pattern);
  } catch {
    return false;
  }
  return values(f, r).some((v) => re.test(v));
}

export const facts = (ev: SentryEvent) => factsOf("", ev, "new");

/** The owner a new issue is assigned to: the first matching rule's, or null. */
export function ownerFor(ev: SentryEvent, rules: OwnerRule[]): { owner: string; rule: number } | null {
  if (!rules.length) return null;
  const f = facts(ev);
  const i = rules.findIndex((r) => ruleMatches(f, r));
  return i < 0 ? null : { owner: rules[i]!.owner, rule: i + 1 };
}
