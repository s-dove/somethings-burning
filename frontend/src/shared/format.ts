import type { Mute } from "./api";
import { t } from "./i18n";

const HOUR = 3_600_000;

export function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

export function ago(ms: number): string {
  if (!ms) return t("never");
  const d = Date.now() - ms;
  if (d < 60_000) return t("just now");
  if (d < HOUR) return t("{n}m ago", { n: Math.floor(d / 60_000) });
  if (d < 24 * HOUR) return t("{n}h ago", { n: Math.floor(d / HOUR) });
  if (d < 60 * 24 * HOUR) return t("{n}d ago", { n: Math.floor(d / (24 * HOUR)) });
  return new Date(ms).toISOString().slice(0, 10);
}

export const stamp = (ms: number): string => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "");
export const clock = (ms: number | null): string => (ms ? new Date(ms).toISOString().slice(11, 23) : "");

// heatLevel maps an hourly count to a step on the ember scale. The steps are
// absolute, so the same color means the same rate on every issue.
export function heatLevel(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n < 5) return 2;
  if (n < 20) return 3;
  if (n < 100) return 4;
  return 5;
}

// Full class names, so Tailwind can see them.
export const HEAT_BG = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

export const heatBg = (n: number): string => HEAT_BG[heatLevel(n)] ?? "bg-heat-0";

const DAY_SCALE = [
  { at: 0, rgb: [31, 138, 76] },
  { at: 10, rgb: [196, 146, 18] },
  { at: 100, rgb: [210, 59, 47] },
  { at: 999, rgb: [110, 16, 28] },
] as const;

// dayColor is green at 0, yellow at 10, red at 100, and deep red at 999.
// Anything above 999 stays deep red.
export function dayColor(n: number): string {
  const count = Math.max(n, 0);
  const last = DAY_SCALE[DAY_SCALE.length - 1] ?? DAY_SCALE[0];
  if (count >= last.at) return mix(last.rgb, last.rgb, 0);
  let i = 0;
  while (i < DAY_SCALE.length - 2 && count >= (DAY_SCALE[i + 1]?.at ?? last.at)) i++;
  const a = DAY_SCALE[i] ?? DAY_SCALE[0];
  const b = DAY_SCALE[i + 1] ?? last;
  return mix(a.rgb, b.rgb, (count - a.at) / (b.at - a.at));
}

function mix(a: readonly number[], b: readonly number[], f: number): string {
  const rgb = [0, 1, 2].map((k) => Math.round((a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * f));
  return `rgb(${rgb.join(" ")})`;
}

export function eventsTip(n: number): string {
  if (!n) return t("No unresolved events in the last 24 hours");
  return t("{n} unresolved events in the last 24 hours", { n });
}

type EdgeIssue = { hours: number[]; status: "open" | "resolved" | "muted" };

// edgeBg colors a row's left edge. Resolved is doused, muted is a flat rule,
// and an open issue takes the busiest of its last three hours.
export function edgeBg(issue: EdgeIssue): string {
  if (issue.status === "resolved") return "bg-doused";
  if (issue.status === "muted") return "bg-rule";
  return HEAT_BG[heatLevel(Math.max(0, ...issue.hours.slice(-3)))] ?? "bg-heat-0";
}

export function edgeTip(issue: EdgeIssue): string {
  if (issue.status === "resolved") return "Resolved. The edge stays blue until a new event fires it again.";
  if (issue.status === "muted") return "Muted. The edge stays gray while events keep counting.";
  const n = Math.max(0, ...issue.hours.slice(-3));
  if (n <= 0) return "No events in the last 3 hours.";
  return `Busiest hour of the last 3: ${plural(n, "event")}.`;
}

// splitTitle separates an exception title into its type and message, so the
// type can be set as code. Plain messages come back whole.
export function splitTitle(title: string): [string, string] {
  const i = title.indexOf(": ");
  const head = i < 0 ? "" : title.slice(0, i);
  if (!head || /\s/.test(head)) return ["", title];
  return [head, title.slice(i + 2)];
}

export const sentence = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// shortRelease drops the package prefix of a release, as Sentry does:
// "payments-api@2.16.0-rc.2" shows as "2.16.0-rc.2". The page already says
// which project it is. Scoped names ("@acme/web@1.2.0") keep only the version.
export function shortRelease(release: string): string {
  const at = release.lastIndexOf("@");
  return at > 0 && at < release.length - 1 ? release.slice(at + 1) : release;
}

function humanDuration(ms: number): string {
  if (ms < 60_000) return t("less than a minute");
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return t("{n} minutes", { n: minutes });
  const hours = Math.ceil(ms / HOUR);
  if (hours < 48) return t("{n} hours", { n: hours });
  return t("{n} days", { n: Math.ceil(ms / (24 * HOUR)) });
}

export function muteSummary(m: Mute): string {
  if (m.kind === "for") {
    const left = m.until - Date.now();
    return left <= 0 ? t("mute ending") : t("muted for {time} more", { time: humanDuration(left) });
  }
  if (m.kind === "release") return t("muted until a new release reports it");
  return t("muted until unmuted");
}
