import type { Receiver, ReceiverKind, Route } from "../shared/api";
import { t } from "../shared/i18n";

// Problems are keyed by where they show: "m<index>" for a condition, "r:<kind>"
// for a line of receivers. They mirror the server's checks so the editor can
// point at the line instead of naming it in a message.
export type Problems = Map<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNEL = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const USERNAME = /^@?[a-z0-9][a-z0-9._-]*$/i;

const LABEL: Record<ReceiverKind, string> = {
  user: t("Person"), assignee: t("Assignee"), email: t("Email"), mattermost: t("Mattermost channel"), slack: "Slack", mattermost_dm: t("Mattermost message"), webhook: "Webhook",
};

// badTarget says what is wrong with one receiver's address, or "".
export function badTarget(x: Receiver): string {
  if (x.kind === "assignee") return "";
  if ((x.kind === "user" || x.kind === "email") && !EMAIL.test(x.target)) return t("{target} is not an email address", { target: x.target });
  if (x.kind === "mattermost" && !CHANNEL.test(x.target)) return t("{target} should be team-name/channel-name", { target: x.target });
  if (x.kind === "mattermost_dm" && !USERNAME.test(x.target)) return t("{target} is not a Mattermost username", { target: x.target });
  if (x.kind === "webhook" && !/^https?:\/\/\S+$/.test(x.target)) return t("{target} is not an http(s) URL", { target: x.target });
  if (x.kind === "slack" && !/^https:\/\/\S+$/.test(x.target)) return t("{target} is not an https URL", { target: x.target });
  return "";
}

export function routeProblems(r: Route): Problems {
  const out: Problems = new Map();
  if (r.spike && !(r.spike.events >= 1)) out.set("spike", t("A spike needs at least 1 event in an hour."));
  else if (r.spike && !(r.spike.factor >= 1 && r.spike.factor <= 1000)) out.set("spike", t("The factor is between 1 and 1000."));
  r.matchers.forEach((m, i) => {
    if (m.field === "tag." || m.field === "tag") out.set(`m${i}`, t("Add the tag name."));
    else if (m.op === "=~" || m.op === "!~") {
      try { new RegExp(`^(?:${m.value})$`); } catch { out.set(`m${i}`, m.value ? t("{value} is not a valid regex.", { value: m.value }) : t("This is not a valid regex.")); }
    }
  });
  if (r.sink) return out;
  if (r.receivers.length === 0) out.set("r", t("Add a receiver, or choose Sink to drop what matches."));
  const kinds = [...new Set(r.receivers.map(x => x.kind))];
  for (const kind of kinds) {
    if (kind === "assignee") continue;
    const targets = r.receivers.filter(x => x.kind === kind && x.target);
    if (targets.length === 0) { out.set(`r:${kind}`, t("{kind}: add at least one address.", { kind: LABEL[kind] })); continue; }
    const bad = targets.map(badTarget).filter(Boolean);
    if (bad.length) out.set(`r:${kind}`, `${bad.join("; ")}.`);
  }
  return out;
}
