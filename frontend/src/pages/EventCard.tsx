import { useState } from "react";
import { Check, Copy } from "../ui/icons";
import type { EventView } from "../shared/api";
import { copyText } from "../shared/clipboard";
import { ago } from "../shared/format";
import { section } from "../shared/ui";
import { Redacted } from "../components/Redacted";
import { Tag } from "../components/Tag";
import { Tip, TimeTip } from "../components/Tip";
import { t } from "../shared/i18n";

type Exception = EventView["exceptions"][number];

// EventCard is the event you are viewing: when it arrived, where it ran, the
// SDK's own tags, and the exception it raised (or its message).
export function EventCard({ event }: { event: EventView }) {
  // Where it ran, then the SDK's own tags, all in one row of chips.
  const tags: [string, string, string][] = [
    ["release", event.release, "release"],
    ["env", event.environment, "environment"],
    ["server", event.serverName, "server_name"],
    ["level", event.level, "level: how bad the SDK says it is"],
    ["sdk", event.sdk, "sdk.name and sdk.version"],
    ...event.tags.map(([k, v]): [string, string, string] => [k, v, `tags.${k}`]),
  ];
  const [main, ...causes] = event.exceptions;
  return (
    <section className={section}>
      <h2 className="mb-4 text-sm font-semibold">
        Event <span className="text-xs font-normal text-cinder">this one single event, received <TimeTip at={event.receivedAt}><span>{ago(event.receivedAt)}</span></TimeTip></span>
      </h2>

      <div className="flex flex-wrap gap-1.5">
        {tags.filter(([, v]) => v).map(([k, v, field]) => <Tag key={field} name={k} value={v} mono={k === "release"} title={field} />)}
      </div>

      <div className="pt-4">
        <dl className={facts}>
          <Fact label="id" field="event_id" value={event.eventId} />
          {main ? <ExceptionFacts exception={main} /> : <Fact label="message" field="message, or logentry.formatted" value={event.message} />}
        </dl>
        {causes.map((e, n) => (
          <div key={n} className="mt-4">
            <h3 className="mb-2 flex items-baseline gap-2 text-xs font-semibold">{t("Caused by")}<span className="font-normal text-cinder">{n + 2} of {event.exceptions.length}, raised before the one above</span></h3>
            <dl className={`${facts} rounded-control border border-rule bg-smoke/60 px-3.5 py-3`}><ExceptionFacts exception={e} /></dl>
          </div>
        ))}
      </div>
    </section>
  );
}

const facts = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-[13px] leading-5";

// ExceptionFacts is the rows of one exception, for a <dl>. Each field is named
// after the event JSON it comes from.
function ExceptionFacts({ exception: e }: { exception: Exception }) {
  const handled = e.handled === "handled" ? "true" : e.handled === "unhandled" ? "false" : "";
  const hint = { true: "your code caught it and reported it", false: "nothing in your code caught it", "": "not reported by the SDK" }[handled];
  return (
    <>
      <Fact label="type" field="exception.values[].type" value={e.type} />
      <Fact label="value" field="exception.values[].value" value={e.value} />
      <Fact label="handled" field="exception.values[].mechanism.handled" value={handled} hint={hint} />
    </>
  );
}

// Fact is one label and value, all in the same mono style. A copy button
// shows on hover (always on touch screens) when there is a value.
function Fact({ label, field, value, hint }: { label: string; field: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Tip content={field}><dt className="text-cinder">{label}</dt></Tip>
      <dd className="group m-0 flex min-w-0 items-start gap-2">
        <span className="min-w-0">
          {value ? <span className="mono whitespace-pre-wrap wrap-anywhere"><Redacted text={value} /></span> : !hint && <span className="text-cinder">{t("empty")}</span>}
          {hint && <span className="text-cinder">{value ? " · " : ""}{hint}</span>}
        </span>
        {value && (
          <Tip content={copied ? "Copied" : `Copy ${label}`}><button
            type="button"
            className="mt-px shrink-0 cursor-pointer rounded-control p-0.5 text-cinder opacity-0 group-hover:opacity-100 hover:bg-rule-soft hover:text-soot focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={`Copy ${label}`}
            onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button></Tip>
        )}
      </dd>
    </>
  );
}
