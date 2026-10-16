import { useState } from "react";
import { Link, useParams } from "react-router";
import { useApi, type ExceptionValue, type Frame, type Issue, type SentryEvent, type StoredEvent } from "../lib/api";
import { ago, fullTime } from "../lib/time";
import { Card, ErrorNote, LevelDot } from "../ui";

function exceptionsOf(e: SentryEvent): ExceptionValue[] {
  const ex = e.exception;
  if (!ex) return [];
  return Array.isArray(ex) ? ex : (ex.values ?? []);
}

function messageOf(e: SentryEvent): string | undefined {
  const m = e.logentry ?? e.message;
  if (!m) return undefined;
  return typeof m === "string" ? m : (m.formatted ?? m.message);
}

function tagsOf(e: SentryEvent): [string, string][] {
  const t = e.tags;
  if (!t) return [];
  return Array.isArray(t) ? t : Object.entries(t);
}

function FrameRow({ frame, open }: { frame: Frame; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const hasContext = !!frame.context_line;
  const where = frame.filename || frame.abs_path || frame.module || "?";
  return (
    <li className={frame.in_app ? "" : "opacity-60"}>
      <button
        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-neutral-800/50"
        onClick={() => setExpanded((x) => !x)}
        disabled={!hasContext}
      >
        <span className="text-neutral-200">{where}</span>
        {frame.function && (
          <>
            <span className="text-neutral-500">in</span>
            <span className="text-orange-300">{frame.function}</span>
          </>
        )}
        {frame.lineno != null && <span className="text-neutral-500">line {frame.lineno}</span>}
        {frame.in_app && <span className="ml-auto rounded bg-neutral-800 px-1.5 text-[10px] text-neutral-400">in app</span>}
      </button>
      {expanded && hasContext && (
        <pre className="overflow-x-auto bg-neutral-950 py-2 font-mono text-xs leading-5">
          {(frame.pre_context ?? []).map((l, i) => (
            <div key={`pre${i}`} className="px-3 text-neutral-500">
              <span className="mr-3 inline-block w-8 text-right">{(frame.lineno ?? 0) - (frame.pre_context!.length - i)}</span>
              {l}
            </div>
          ))}
          <div className="bg-orange-950/60 px-3 text-orange-100">
            <span className="mr-3 inline-block w-8 text-right">{frame.lineno}</span>
            {frame.context_line}
          </div>
          {(frame.post_context ?? []).map((l, i) => (
            <div key={`post${i}`} className="px-3 text-neutral-500">
              <span className="mr-3 inline-block w-8 text-right">{(frame.lineno ?? 0) + i + 1}</span>
              {l}
            </div>
          ))}
        </pre>
      )}
    </li>
  );
}

function ExceptionView({ ex }: { ex: ExceptionValue }) {
  // Sentry lists frames oldest first; show the innermost call on top.
  const frames = [...(ex.stacktrace?.frames ?? [])].reverse();
  const firstInApp = frames.findIndex((f) => f.in_app);
  return (
    <div className="space-y-2">
      <div>
        <span className="font-semibold text-orange-400">{ex.type ?? "Error"}</span>
        {ex.value && <span className="text-neutral-300">: {ex.value}</span>}
      </div>
      {frames.length > 0 && (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-md border border-neutral-800">
          {frames.map((f, i) => (
            <FrameRow key={i} frame={f} open={i === (firstInApp < 0 ? 0 : firstInApp)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventView({ event }: { event: StoredEvent }) {
  const [raw, setRaw] = useState(false);
  const e = event.payload;
  const exs = [...exceptionsOf(e)].reverse();
  const msg = messageOf(e);
  const facts = [
    ["environment", e.environment],
    ["release", e.release],
    ["server", e.server_name],
    ["platform", e.platform],
  ].filter(([, v]) => v) as [string, string][];
  const tags = tagsOf(e);

  return (
    <Card
      title={
        <span>
          Event <span className="font-mono text-neutral-500">{event.eventId.slice(0, 12)}</span>
          <span className="ml-2 font-normal text-neutral-500">{fullTime(event.receivedAt)}</span>
        </span>
      }
      actions={
        <button className="text-xs text-neutral-400 hover:text-neutral-100" onClick={() => setRaw((r) => !r)}>
          {raw ? "Formatted" : "Raw JSON"}
        </button>
      }
    >
      {raw ? (
        <pre className="max-h-[600px] overflow-auto font-mono text-xs text-neutral-300">{JSON.stringify(e, null, 2)}</pre>
      ) : (
        <div className="space-y-5">
          {msg && exs.length === 0 && <p className="text-neutral-200">{msg}</p>}
          {exs.map((ex, i) => (
            <ExceptionView key={i} ex={ex} />
          ))}
          {(facts.length > 0 || tags.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {[...facts, ...tags].map(([k, v]) => (
                <span key={k} className="rounded border border-neutral-800 px-2 py-0.5 font-mono text-xs">
                  <span className="text-neutral-500">{k}</span> <span className="text-neutral-200">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function IssuePage() {
  const { projectId, issueId } = useParams();
  const { data, error } = useApi<{ issue: Issue; events: StoredEvent[] }>(`/projects/${projectId}/issues/${issueId}`, 5000);
  const [selected, setSelected] = useState(0);

  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const { issue, events } = data;
  const event = events[Math.min(selected, events.length - 1)];

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${projectId}`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Issues
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold tracking-tight">
          <LevelDot level={issue.level} />
          <span className="break-all">{issue.title}</span>
        </h1>
        <div className="mt-1 font-mono text-xs text-neutral-500">{issue.culprit}</div>
        <div className="mt-3 flex gap-6 text-sm text-neutral-400">
          <span>
            <span className="text-orange-400">{issue.count}</span> events
          </span>
          <span title={fullTime(issue.firstSeen)}>first seen {ago(issue.firstSeen)}</span>
          <span title={fullTime(issue.lastSeen)}>last seen {ago(issue.lastSeen)}</span>
        </div>
      </div>

      {events.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {events.map((ev, i) => (
            <button
              key={ev.id}
              onClick={() => setSelected(i)}
              className={`rounded px-2 py-1 font-mono text-xs ${i === selected ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-200"}`}
            >
              {i === 0 ? "latest" : ago(ev.receivedAt)}
            </button>
          ))}
        </div>
      )}

      {event && <EventView event={event} />}
    </div>
  );
}
