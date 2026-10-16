import { shortRelease } from "../shared/format";
import { Tip } from "./Tip";

// Muted hues for tag keys. Orange and red are left out: in Burning they mean
// heat, so a tag must never look like a warning.
const HUES = [205, 180, 150, 110, 250, 280, 225, 60, 320, 165];

// keyTint picks a soft background and a dark text color for a tag key from a
// hash of its name, so "environment" is always the same color everywhere.
export function keyTint(name: string): { backgroundColor: string; color: string } {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = HUES[(h >>> 0) % HUES.length]!;
  return { backgroundColor: `hsl(${hue} 28% 92%)`, color: `hsl(${hue} 30% 30%)` };
}

// Tag is a key and its value in one bordered chip, as in the event tags
// (release, environment, server, sdk, and the SDK's own tags). The key's tint
// comes from its name.
// With truncate, a long value stays on one line and shows in full on hover.
// A release shows without its package prefix; hover shows the full name.
export function Tag({ name, value, mono, title, truncate }: { name: string; value: string; mono?: boolean; title?: string; truncate?: boolean }) {
  const shown = name === "release" ? shortRelease(value) : value;
  const tip = shown !== value || truncate ? value : title;
  return (
    <Tip content={tip}><span className="inline-flex max-w-full overflow-hidden rounded-control border border-rule bg-ash text-xs">
      <span className="shrink-0 border-r border-rule-soft px-1.5 py-0.5" style={keyTint(name)}>{name}</span>
      <b className={`min-w-0 px-1.5 py-0.5 font-medium ${truncate ? "truncate" : "break-all"} ${mono ? "mono text-xs" : ""}`}>{shown}</b>
    </span></Tip>
  );
}
