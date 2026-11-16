import { Picker, type PickOption } from "../components/Picker";
import { TargetsInput } from "../components/TargetsInput";
import { PeopleInput } from "../components/PeopleInput";
import { badTarget, type Problems } from "./routeProblems";
import { Tip } from "../components/Tip";
import { Ban, Link2, Mail, MessageCircle, Plus, SendHorizontal, UserRound, X } from "../ui/icons";
import type { Matcher, MatchOp, Receiver, ReceiverKind, Route } from "../shared/api";
import { input } from "../shared/ui";

const FIELD_HINT: Record<string, string> = {
  project: "the project's name",
  trigger: "new, fired_again, or unmuted",
  env: "the event's environment",
  release: "the full release, e.g. api@2.1.0",
  level: "error, warning, fatal, …",
  type: "the exception type",
  message: "the exception value or log message",
  culprit: "the transaction, or the innermost in-app frame",
  path: "true if any in-app frame's file matches",
  tag: "an SDK tag, by name",
};
const PLACEHOLDER: Record<string, string> = {
  project: "payments-api", trigger: "new|fired_again", env: "production", release: "api@2\\..*", level: "error|fatal", type: "KeyError",
  message: ".*timeout.*", culprit: "POST /v2/.*", path: "payments/gateway/.*", tag: "us-east-.*",
};
export const OP_LABEL: Record<MatchOp, string> = {
  "=": "equals", "!=": "does not equal", "=~": "matches", "!~": "does not match",
  empty: "has an empty value", absent: "is absent", "!value": "is empty or absent",
  value: "has a non-empty value", "!absent": "is present",
};
// What a no-value condition means, in the space where a value would go.
const NO_VALUE_SAYS: Partial<Record<MatchOp, string>> = {
  value: "Sent with something in it",
  empty: "Sent, but blank",
  absent: "Not sent at all",
  "!value": "Blank, or not sent at all",
  "!absent": "Sent, blank or not",
};
// Operators that take no value. A field is sent with a value, sent blank
// (""), or absent (not sent at all); these pick among the three.
export const NO_VALUE: MatchOp[] = ["value", "empty", "!absent", "absent", "!value"];
const OP_HINT: Record<MatchOp, string> = {
  "=": "The value is exactly this text.",
  "!=": "The value is anything but this text.",
  "=~": "The whole value matches this regex: prod.* matches production, prod does not.",
  "!~": "The whole value does not match this regex.",
  empty: "Sent, but blank (\"\"). Not the same as absent.",
  "!value": "Empty or absent: either way there is nothing in it.",
  value: "Sent with something in it.",
  absent: "The event does not have this field at all. Not the same as empty.",
  "!absent": "Sent, empty or not.",
};

// "sink" is not stored as a receiver: a sink route has sink set and no
// receivers. The editor shows it as one more way to send, the only one on
// its route.
type Kind = ReceiverKind | "sink";
const RECEIVER: Record<Kind, { label: string; hint: string; placeholder: string; icon: React.ReactNode }> = {
  user: { label: "Person", hint: "Chosen by name; delivered the way they set up in their own routing", placeholder: "", icon: <UserRound size={14} /> },
  assignee: { label: "Assignee", hint: "Whoever the issue is assigned to, through their own routing", placeholder: "", icon: <UserRound size={14} /> },
  email: { label: "Email", hint: "Mailed to this address as is: a person or a list", placeholder: "team@example.com", icon: <Mail size={14} /> },
  slack: { label: "Slack", hint: "An incoming webhook", placeholder: "https://hooks.slack.com/services/...", icon: <Link2 size={14} /> },
  mattermost_dm: { label: "Mattermost message", hint: "A direct message to this username", placeholder: "Mattermost username", icon: <MessageCircle size={14} /> },
  mattermost: { label: "Mattermost channel", hint: "team-name/channel-name; add the bot first", placeholder: "team-name/alerts", icon: <MessageCircle size={14} /> },
  webhook: { label: "Webhook", hint: "Gets a JSON post", placeholder: "https://example.com/hook", icon: <Link2 size={14} /> },
  sink: { label: "Sink", hint: "Drop what matches, silently; matching stops here", placeholder: "", icon: <Ban size={14} /> },
};

export const RECEIVER_LABEL = Object.fromEntries(Object.entries(RECEIVER).map(([k, v]) => [k, v.label])) as Record<Kind, string>;
export const RECEIVER_ICON = Object.fromEntries(Object.entries(RECEIVER).map(([k, v]) => [k, v.icon])) as Record<Kind, React.ReactNode>;

const iconBtn = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-cinder hover:bg-rule-soft hover:text-soot disabled:cursor-not-allowed disabled:opacity-40";
const addBtn = "inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1 text-xs text-cinder hover:bg-rule-soft hover:text-soot";

// RouteEditor edits one route: its name, its conditions (all must match),
// where matches go (or Sink to drop them), and whether matching continues
// below it. Choices show as values; clicking one opens them in a dialog.
// onTest, when given, adds a test button to each receiver.
export function RouteEditor({ route: r, fields, ops, kinds, readOnly, onChange, onTest, problems = new Map(), project, unavailable = [] }: {
  route: Route; fields: string[]; ops: MatchOp[]; kinds: ReceiverKind[]; readOnly: boolean; onChange: (r: Route) => void;
  onTest?: (x: Receiver) => void;
  problems?: Problems; // shown under the line they are about
  project?: number; // for the people picker: puts this project's members first
  unavailable?: ReceiverKind[]; // kinds this server cannot send (email or Mattermost not set up)
}) {
  const fieldOptions: PickOption<string>[] = [...fields, "tag"].map(f => ({ value: f, label: f, hint: FIELD_HINT[f] }));
  const opOptions: PickOption<MatchOp>[] = ops.map(o => ({ value: o, label: OP_LABEL[o], hint: OP_HINT[o] }));
  // A kind the server cannot send is only offered where a route already uses it.
  const inUse = new Set<Kind>(r.receivers.map(x => x.kind));
  const offered = kinds.filter(k => !unavailable.includes(k) || inUse.has(k));
  const kindOptions: PickOption<Kind>[] = [...offered, "sink" as const].map(k => ({
    value: k, label: RECEIVER[k].label, icon: RECEIVER[k].icon,
    hint: k !== "sink" && unavailable.includes(k) ? "Not set up on this server: messages are skipped" : RECEIVER[k].hint,
  }));
  const setMatcher = (i: number, m: Matcher) => onChange({ ...r, matchers: r.matchers.map((x, j) => (j === i ? m : x)) });
  // Receivers are edited one line per kind, each with any number of
  // targets, and stored flat. A line with no targets yet is kept as one
  // receiver with an empty target, so saving it asks for a value.
  const groups = toGroups(r.receivers);
  const setGroups = (gs: Group[]) => onChange({ ...r, receivers: fromGroups(gs) });
  const unused = offered.find(k => !groups.some(g => g.kind === k)) ?? offered[0]!;
  // Choosing Sink makes the route a sink with no receivers; choosing anything
  // else on a sink route turns it back into one empty line. Switching a line
  // to another kind clears it: an email address is no Mattermost channel.
  const setKind = (i: number, kind: Kind) => {
    if (kind === groups[i]?.kind) return;
    if (kind === "sink") onChange({ ...r, sink: true, continue: false, receivers: [] });
    else if (r.sink) onChange({ ...r, sink: false, receivers: [{ kind, target: "" }] });
    else setGroups(groups.map((g, j) => (j === i ? { kind, targets: [] } : g)));
  };
  const rows: Group[] = r.sink ? [{ kind: "sink", targets: [] }] : groups;

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold" htmlFor="route-name">Name</label>
      <input id="route-name" className={`${input} mb-6 h-8 w-full py-1`} placeholder="Optional, shown in the list" value={r.name} disabled={readOnly} maxLength={80} onChange={e => onChange({ ...r, name: e.target.value })} />

      <h3 className="mb-2 text-xs font-semibold">When all of these match</h3>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {r.matchers.map((m, i) => {
          const isTag = m.field.startsWith("tag.") || m.field === "tag";
          const base = isTag ? "tag" : m.field;
          // A missing tag name marks the name box; anything else, the value.
          const noName = isTag && m.field.length <= 4;
          const valueBad = problems.has(`m${i}`) && !noName;
          return (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <Picker label="Field" mono className="w-44" value={base} options={fieldOptions} disabled={readOnly}
                onChange={f => setMatcher(i, { ...m, field: f === "tag" ? "tag." : f })} />
              {isTag && <input aria-label="Tag name" aria-invalid={(noName && problems.has(`m${i}`)) || undefined} className={`${input} mono h-8 w-32 py-1 text-xs ${noName && problems.has(`m${i}`) ? "border-ember-ink!" : ""}`} placeholder="tag name" value={m.field.slice(4)} disabled={readOnly}
                onChange={e => setMatcher(i, { ...m, field: `tag.${e.target.value.trim()}` })} />}
              <Picker label="Operator" className="w-44" value={m.op} options={opOptions} disabled={readOnly} onChange={op => setMatcher(i, { ...m, op, value: NO_VALUE.includes(op) ? "" : m.value })} />
              {NO_VALUE.includes(m.op) ? <span className="flex h-8 min-w-40 flex-1 items-center rounded-control border border-dashed border-rule px-3 text-xs text-cinder">{NO_VALUE_SAYS[m.op]}</span> : <input aria-label="Value" aria-invalid={valueBad || undefined} className={`${input} mono h-8 min-w-40 flex-1 py-1 text-xs ${valueBad ? "border-ember-ink!" : ""}`} placeholder={PLACEHOLDER[base] ?? ""} value={m.value} disabled={readOnly}
                onChange={e => setMatcher(i, { ...m, value: e.target.value })} />}
              {!readOnly && <Tip content="Remove condition"><button type="button" className={iconBtn} aria-label="Remove condition" onClick={() => onChange({ ...r, matchers: r.matchers.filter((_, j) => j !== i) })}><X size={14} /></button></Tip>}
              {problems.has(`m${i}`) && <Problem text={problems.get(`m${i}`)!} />}
            </li>
          );
        })}
      </ul>
      {problems.has("m") && <Problem text={problems.get("m")!} />}
      {!readOnly && <button type="button" className={`${addBtn} mt-1.5`} onClick={() => onChange({ ...r, matchers: [...r.matchers, { field: "env", op: "=~", value: "" }] })}><Plus size={12} aria-hidden="true" />Add condition</button>}

      <h3 className="mt-6 mb-2 text-xs font-semibold">Send to</h3>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {rows.map((g, i) => (
          <li key={i} className="flex flex-wrap items-start gap-1.5">
            <Picker label="Send by" className="w-44" value={g.kind} options={kindOptions} disabled={readOnly} onChange={kind => setKind(i, kind)} />
            {g.kind === "sink"
              ? <span className="flex h-8 min-w-40 flex-1 items-center text-xs text-cinder">Alerts that match are dropped silently. Matching stops here.</span>
              : g.kind === "assignee"
              ? <span className="flex h-8 min-w-40 flex-1 items-center text-xs text-cinder">Whoever the issue is assigned to, through their own routing.</span>
              : g.kind === "user"
              ? <PeopleInput values={g.targets} project={project} disabled={readOnly} invalid={problems.has("r:user")}
                  onChange={targets => setGroups(groups.map((x, j) => (j === i ? { ...x, targets } : x)))} />
              : <TargetsInput label={`${RECEIVER[g.kind].label} addresses`} values={g.targets} placeholder={RECEIVER[g.kind].placeholder} disabled={readOnly}
                  check={t => badTarget({ kind: g.kind as ReceiverKind, target: t })}
                  invalid={problems.has(`r:${g.kind}`)} bad={problems.has(`r:${g.kind}`) ? t => !!badTarget({ kind: g.kind as ReceiverKind, target: t }) : undefined}
                  onChange={targets => setGroups(groups.map((x, j) => (j === i ? { ...x, targets } : x)))} />}
            {onTest && g.kind !== "sink" && g.kind !== "assignee" && <Tip content={g.targets.length > 1 ? "Send a test message to each" : "Send a test message"}><span className="inline-flex"><button type="button" className={iconBtn} aria-label={`Test ${RECEIVER[g.kind].label}`} disabled={g.targets.length === 0} onClick={() => g.targets.forEach(target => onTest({ kind: g.kind as ReceiverKind, target }))}><SendHorizontal size={14} /></button></span></Tip>}
            {!readOnly && !r.sink && <Tip content="Remove"><button type="button" className={iconBtn} aria-label={`Remove ${RECEIVER[g.kind].label}`} onClick={() => setGroups(groups.filter((_, j) => j !== i))}><X size={14} /></button></Tip>}
            {problems.has(`r:${g.kind}`) && <Problem text={problems.get(`r:${g.kind}`)!} />}
          </li>
        ))}
      </ul>
      {problems.has("r") && <Problem text={problems.get("r")!} />}
      {!readOnly && !r.sink && groups.length < offered.length && <button type="button" className={`${addBtn} mt-1.5`} onClick={() => setGroups([...groups, { kind: unused, targets: [] }])}><Plus size={12} aria-hidden="true" />Add receiver</button>}

      {!r.sink && (
        <label className="mt-6 flex w-fit cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={r.continue} disabled={readOnly} onChange={e => onChange({ ...r, continue: e.target.checked })} />
          Continue
          <span className="text-xs text-cinder">keep matching the routes below after this one</span>
        </label>
      )}
    </div>
  );
}

// Problem is a short red note under the line it is about. It takes the full
// width of the wrapping row, so it sits on its own line.
function Problem({ text }: { text: string }) {
  return <p className="m-0 w-full basis-full text-xs text-ember-ink">{text}</p>;
}

interface Group { kind: Kind; targets: string[] }

// toGroups puts receivers of one kind on one line, in order of first use.
function toGroups(receivers: Receiver[]): Group[] {
  const out: Group[] = [];
  for (const x of receivers) {
    let g = out.find(o => o.kind === x.kind);
    if (!g) out.push((g = { kind: x.kind, targets: [] }));
    if (x.target && !g.targets.includes(x.target)) g.targets.push(x.target);
  }
  return out;
}

function fromGroups(groups: Group[]): Receiver[] {
  return groups.flatMap(g => (g.targets.length ? g.targets : [""]).map(target => ({ kind: g.kind as ReceiverKind, target })));
}

