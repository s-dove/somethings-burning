import { lang, t } from "./i18n";

// The server writes an issue's history in English. In another language the
// known sentences are translated here. Names, counts, and releases stay as written.

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const people = (s: string) => s.replace(/ and (\d+) more$/, (_, n: string) => " " + t("and {n} more", { n }));
const via = (v: string) => (v === "the default route" ? t("the default route") : t("route {routes}", { routes: v.replace(/^route /, "") }));

const RULES: Rule[] = [
  [/^Assigned to (.+) by ownership rule (\d+)$/, (m) => t("Assigned to {who} by ownership rule {n}", { who: m[1], n: m[2] })],
  [/^Assigned to (.+)$/, (m) => t("Assigned to {who}", { who: m[1] })],
  [/^Muted for (.+)$/, (m) => t("Muted for {time}", { time: t(m[1]!) })],
  [/^Merged "(.+)" into this issue$/, (m) => t("Merged \"{title}\" into this issue", { title: m[1] })],
  [/^Split "(.+)" back out into its own issue$/, (m) => t("Split \"{title}\" back out into its own issue", { title: m[1] })],
  [/^GitHub issue (https?:\/\/\S+)$/, (m) => t("GitHub issue {url}", { url: m[1] })],
  [/^Spiking: (\d+) events in the last hour, none in the day before$/, (m) => t("Spiking: {n} events in the last hour, none in the day before", { n: m[1] })],
  [/^Spiking: (\d+) events in the last hour, about ([\d.]+) an hour before$/, (m) => t("Spiking: {n} events in the last hour, about {usual} an hour before", { n: m[1], usual: m[2] })],
  [/^Fired again: a new event arrived in release (\S+) \(([^)]+)\) after it was resolved$/, (m) => t("Fired again: a new event arrived in release {release} ({env}) after it was resolved", { release: m[1], env: m[2] })],
  [/^Fired again: a new event arrived in release (\S+) after it was resolved$/, (m) => t("Fired again: a new event arrived in release {release} after it was resolved", { release: m[1] })],
  [/^Fired again: a new event arrived \(([^)]+)\) after it was resolved$/, (m) => t("Fired again: a new event arrived ({env}) after it was resolved", { env: m[1] })],
  [/^An event arrived from release (\S+), which is newer than the mute$/, (m) => t("An event arrived from release {release}, which is newer than the mute", { release: m[1] })],
  [/^No one notified: (.+) sends to no one$/, (m) => t("No one notified: {via} sends to no one", { via: via(m[1]!) })],
  [/^Dropped by route (.+)$/, (m) => t("Dropped by route {routes}", { routes: m[1] })],
  [
    /^Notified (.+?) by (route .+|the default route)(, then dropped)?(?:\. Nothing sent to (.+) by their own routing)?$/,
    (m) => {
      let s = t("Notified {who} by {via}", { who: people(m[1]!), via: via(m[2]!) });
      if (m[3]) s += t(", then dropped");
      if (m[4]) s += t(". Nothing sent to {who} by their own routing", { who: people(m[4]!) });
      return s;
    },
  ],
];

/** A history line or reopen reason, in the current language when we know the sentence. */
export function translateActivity(text: string): string {
  if (!text || lang === "en") return text;
  const fixed = t(text);
  if (fixed !== text) return fixed;
  for (const [re, f] of RULES) {
    const m = text.match(re);
    if (m) return f(m);
  }
  return text;
}
