import { useState } from "react";
import { Braces, ChevronRight } from "../ui/icons";
import { JsonModal } from "../components/JsonModal";
import { CodeBlock } from "../components/common/CodeBlock";
import { EventCard } from "./EventCard";
import { StackTrace } from "./StackTrace";
import type { EventView } from "../shared/api";
import { clock } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";

// EventPanels shows one stored event: the event card, a stack trace card per
// exception, breadcrumbs, and context. The raw JSON is in the sidebar.
export function EventPanels({ event }: { event: EventView }) {
  return (
    <>
      <EventCard event={event} />
      {event.exceptions.map((e, n) => e.frames.length > 0 && <StackTrace key={n} exception={e} platform={event.platform} causedBy={n > 0} />)}

      {event.breadcrumbs.length > 0 && (
        <section className={section}>
          <h2 className={sectionTitle}>
            Breadcrumbs <span className="text-xs font-normal text-cinder">what happened before the error</span>
          </h2>
          <div className="grid grid-cols-[max-content_max-content_minmax(0,1fr)] gap-x-4 text-xs wrap-anywhere max-sm:gap-x-2">
            {event.breadcrumbs.map((b, i) => (
              <div key={i} className="contents">
                <div className="mono border-t border-rule-soft py-1.5 text-xs text-cinder">{clock(b.timestamp)}</div>
                <div className="border-t border-rule-soft py-1.5">{b.category}</div>
                <div className="border-t border-rule-soft py-1.5">
                  {b.message}
                  {b.data && <span className="mono mt-0.5 block text-xs text-cinder">{b.data}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {event.context.length > 0 && (
        <section className={section}>
          <h2 className={sectionTitle}>
            Context <span className="text-xs font-normal text-cinder">the request, user, and runtime when the error happened</span>
          </h2>
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 text-[13px] wrap-anywhere max-sm:grid-cols-[80px_minmax(0,1fr)]">
            {event.context.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="m-0 border-t border-rule-soft py-2 text-cinder">{k}</dt>
                <dd className="m-0 min-w-0 border-t border-rule-soft py-2">
                  <CodeBlock code={v} className="rounded-control px-3.5 py-2.5" />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

// RawJson opens the event exactly as the SDK sent it, highlighted, in a modal.
export function RawJson({ event }: { event: EventView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="mb-6 flex w-full cursor-pointer items-center gap-3 rounded-card border border-rule bg-ash px-4 py-3.5 text-left hover:bg-rule-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-control border border-rule bg-smoke text-cinder"><Braces aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Raw event JSON</span>
          <span className="block text-xs text-cinder">The event exactly as the SDK sent it.</span>
        </span>
        <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
      </button>
      <JsonModal open={open} onClose={() => setOpen(false)} title="Raw event JSON" subtitle={event.eventId} json={event.raw} />
    </>
  );
}
