import type { SentryEvent } from "./event.js";
import { factsOf, type Facts } from "./notify/routing.js";
import type { GroupingRule, OwnerRule } from "./settings.js";

// Project rules that look at an event: grouping rules (which issue it joins)
// and ownership rules (who a new issue is assigned to). A rule matches when its regex finds
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

/**
 * The event with the first matching grouping rule's fingerprint, or as it
 * came. Variables in the fingerprint take the event's values; {{ default }}
 * stays for the default grouping to fill in.
 */
export function applyGrouping(ev: SentryEvent, rules: GroupingRule[]): SentryEvent {
  if (!rules.length) return ev;
  const f = facts(ev);
  const rule = rules.find((r) => ruleMatches(f, r));
  if (!rule) return ev;
  const parts = rule.fingerprint.match(/\{\{\s*[^}]+?\s*\}\}|\S+/g) ?? [];
  const fingerprint = parts.map((p) => {
    const v = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(p)?.[1];
    if (!v) return p;
    if (v === "default") return "{{ default }}";
    if (v === "type") return f.type;
    if (v === "message") return f.message;
    if (v === "culprit") return f.culprit;
    if (v.startsWith("tag.")) return f.tags[v.slice(4)] ?? "";
    return p;
  });
  return { ...ev, fingerprint };
}

/** The owner a new issue is assigned to: the first matching rule's, or null. */
export function ownerFor(ev: SentryEvent, rules: OwnerRule[]): { owner: string; rule: number } | null {
  if (!rules.length) return null;
  const f = facts(ev);
  const i = rules.findIndex((r) => ruleMatches(f, r));
  return i < 0 ? null : { owner: rules[i]!.owner, rule: i + 1 };
}
