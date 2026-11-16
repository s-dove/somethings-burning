import { useState, type DragEvent } from "react";
import { Tip } from "../components/Tip";
import { Activity, Braces, ChevronRight, Code, FileText, Filter, Folder, GripVertical, Layers, LockKeyhole as Lock, Package, Quote, Tag, TriangleAlert } from "../ui/icons";
import type { ReceiverKind } from "../shared/api";
import type { Route } from "../shared/api";
import { NO_VALUE, OP_LABEL, RECEIVER_ICON, RECEIVER_LABEL } from "./RouteEditor";


// Each condition gets an icon for its field, as each receiver has one for its kind.
const FIELD_ICON: Record<string, React.ReactNode> = {
  trigger: <Activity size={14} />, env: <Layers size={14} />, release: <Package size={14} />, level: <TriangleAlert size={14} />,
  type: <Braces size={14} />, message: <Quote size={14} />, culprit: <Code size={14} />, path: <FileText size={14} />,
  project: <Folder size={14} />, tag: <Tag size={14} />,
};
const fieldIcon = (field: string) => FIELD_ICON[field.startsWith("tag.") ? "tag" : field] ?? <Filter size={14} />;
// The drop marker: a 2px soot line on the top edge of the row it lands above.
const dropMark = "before:absolute before:inset-x-0 before:-top-px before:z-10 before:h-0.5 before:bg-soot before:content-['']";

// RouteList is a routing table: the routes in order and, for a project, the
// default route, which is always last. Drag a route by its handle to reorder
// it; it can be dropped anywhere above the default route.
export function RouteList({ routes, fallback, empty, readOnly, onReorder, onOpen, names = {}, unavailable = [] }: {
  routes: Route[];
  unavailable?: ReceiverKind[]; // kinds this server cannot send: routes using them get a warning
  names?: Record<string, string>; // display names of people, by email
  fallback?: { recipients: string[] }; // the project's default route: fixed, shown last
  empty: string; // shown when there are no routes and no default
  readOnly: boolean;
  onReorder: (from: number, to: number) => void; onOpen: (i: number) => void;
}) {
  if (routes.length === 0 && !fallback) {
    return <p className="rounded-card border border-dashed border-rule bg-ash px-4 py-6 text-center text-[13px] text-cinder">{empty}</p>;
  }
  const [armed, setArmed] = useState<number | null>(null); // handle pressed: this row may drag
  const [from, setFrom] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null); // insert position, 0..routes.length

  const end = () => { setArmed(null); setFrom(null); setAt(null); };
  const over = (e: DragEvent<HTMLLIElement>, i: number) => {
    if (from === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const box = e.currentTarget.getBoundingClientRect();
    setAt(i >= routes.length ? routes.length : e.clientY < box.top + box.height / 2 ? i : i + 1);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    if (from !== null && at !== null) {
      const to = at > from ? at - 1 : at;
      if (to !== from) onReorder(from, to);
    }
    end();
  };
  // No marker where the row would land back in its own place.
  const marked = (i: number) => at === i && from !== null && at !== from && at !== from + 1;

  return (
    <ol className="m-0 list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">
      {routes.map((r, i) => (
        <li
          key={i}
          draggable={armed === i}
          onDragStart={e => { setFrom(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
          onDragOver={e => over(e, i)}
          onDrop={drop}
          onDragEnd={end}
          className={`relative flex items-stretch gap-2 pr-4 hover:bg-smoke ${from === i ? "opacity-40" : ""} ${marked(i) ? dropMark : ""}`}
        >
          {readOnly
            ? <span className="w-3 shrink-0" />
            : <Tip content="Drag to reorder"><span
                className="grid w-8 shrink-0 cursor-grab place-items-center text-cinder hover:bg-rule-soft hover:text-soot active:cursor-grabbing"
                aria-hidden="true"
                onPointerDown={() => setArmed(i)}
                onPointerUp={() => from === null && setArmed(null)}
              ><GripVertical size={14} /></span></Tip>}
          <RouteSummary route={r} index={i} names={names} unavailable={unavailable} onOpen={() => onOpen(i)} />
        </li>
      ))}
      {fallback && <li onDragOver={e => over(e, routes.length)} onDrop={drop} className={`relative flex items-stretch gap-2 bg-smoke/60 pr-4 ${marked(routes.length) ? dropMark : ""}`}>
        <Tip content="The default route is fixed: always last, to the project's members and admins"><span className="grid w-8 shrink-0 place-items-center text-cinder"><Lock size={12} aria-hidden="true" /></span></Tip>
        <div className="flex min-w-0 flex-1 items-start gap-3 py-3">
          <span className="-mt-0.5 grid size-6 shrink-0 place-items-center rounded-control bg-rule-soft text-xs font-semibold text-cinder">∗</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <span className="truncate">Default route</span>
              <span className="shrink-0 rounded-control bg-rule-soft px-1.5 text-[11px] font-normal text-cinder">always last</span>
            </span>
            <Section title="Matches" items={[{ key: "none", icon: <Filter size={14} />, label: "Fallback", text: "when no route above matches" }]} />
            <Section title="Send to" items={[{ key: "members", icon: RECEIVER_ICON.user, label: "Person", text: "All members and admins" }]} />
          </span>
        </div>
      </li>}
    </ol>
  );
}

// RouteSummary is a route's line: number, name, conditions, and receivers.
function RouteSummary({ route: r, index, names, unavailable, onOpen }: { route: Route; index: number; names: Record<string, string>; unavailable: ReceiverKind[]; onOpen: () => void }) {
  const matches: Item[] = r.matchers.map((m, i) => ({ key: `${i}`, icon: fieldIcon(m.field), label: m.field, text: NO_VALUE.includes(m.op) ? `${m.field} ${OP_LABEL[m.op]}` : `${m.field} ${OP_LABEL[m.op]} ${m.value || '""'}`, mono: true }));
  // One line per kind of receiver, with its icon and all its targets; a sink
  // is one line too.
  const kinds = [...new Set(r.receivers.map(x => x.kind))];
  const sendTo: Item[] = r.sink
    ? [{ key: "sink", icon: RECEIVER_ICON.sink, label: "Sink", text: "Dropped silently" }]
    : kinds.map(kind => ({
        key: kind,
        icon: RECEIVER_ICON[kind],
        label: RECEIVER_LABEL[kind],
        text: kind === "assignee" ? "Whoever the issue is assigned to" : r.receivers.filter(x => x.kind === kind).map(x => (kind === "user" ? names[x.target] : "") || x.target || "(empty)").join(", "),
        warning: unavailable.includes(kind) ? `${RECEIVER_LABEL[kind]} is not set up on this server, so these messages are skipped.` : undefined,
      }));
  return (
    <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 text-left" onClick={onOpen}>
      <span className="-mt-0.5 grid size-6 shrink-0 place-items-center rounded-control bg-smoke text-xs font-semibold tabular-nums">{index + 1}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{r.name || `Route ${index + 1}`}</span>
          {r.continue && <span className="shrink-0 rounded-control bg-rule-soft px-1.5 text-[11px] font-normal text-cinder">continue</span>}
        </span>
        <Section title="Matches" items={matches} />
        <Section title={r.sink ? "Then" : "Send to"} items={sendTo} />
      </span>
      <ChevronRight className="shrink-0 self-center text-cinder" aria-hidden="true" />
    </button>
  );
}

interface Item { key: string; text: string; icon?: React.ReactNode; label?: string; mono?: boolean; warning?: string }

// Section is a small heading ("Matches", "Send to") with its items indented
// under it, one per line.
function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="mt-2.5">
      <span className="block text-[11px] text-cinder">{title}:</span>
      <ul className="m-0 mt-1 list-none space-y-1 p-0 pl-3">
        {items.map(it => (
          <li key={it.key} className="flex min-w-0 items-center gap-2 text-xs leading-5 text-soot">
            <span className="shrink-0 text-cinder" aria-label={it.label}>{it.icon}</span>
            <span className={`truncate ${it.mono ? "mono" : ""}`}>{it.text}</span>
            {it.warning && <Tip content={it.warning}><span className="shrink-0 text-ember-ink" aria-label={it.warning}><TriangleAlert size={14} /></span></Tip>}
          </li>
        ))}
      </ul>
    </div>
  );
}

