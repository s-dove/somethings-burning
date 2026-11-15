import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/components/Button";
import { Check, Plus, Search, X } from "../ui/icons";
import { useApi } from "../shared/api";
import { Tip } from "./Tip";

interface Person {
  email: string;
  username: string;
  displayName: string;
  role: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const initial = (p: { displayName: string; email: string }) => (p.displayName || p.email).slice(0, 1).toUpperCase();

// PeopleInput picks people for a route. Each is stored by email and shown
// by name and @username. Typing (a name, or @username) or "Add people" opens
// a dialog to search and choose several at once.
export function PeopleInput({ values, onChange, project, disabled, invalid }: {
  values: string[]; // emails
  onChange: (emails: string[]) => void;
  project?: number; // puts the project's members first
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { data } = useApi<Person[]>(`/people${project ? `?project=${project}` : ""}`);
  const people = data ?? [];
  const byEmail = new Map(people.map(p => [p.email.toLowerCase(), p]));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const start = (q: string) => { setQuery(q); setOpen(true); };

  return (
    <div className={`flex min-h-8 min-w-48 flex-1 flex-wrap items-center gap-1 rounded-control border ${invalid ? "border-ember-ink" : "border-rule"} bg-ash px-1.5 py-1 ${disabled ? "opacity-60" : ""}`}>
      {values.map(email => {
        const p = byEmail.get(email.toLowerCase());
        return (
          <Tip key={email} content={email}><span className="inline-flex max-w-full items-center gap-1.5 rounded-[4px] bg-smoke py-0.5 pr-1 pl-1 text-xs">
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ash text-[9px] font-semibold" aria-hidden="true">{initial(p ?? { displayName: "", email })}</span>
            <span className="truncate">{p ? p.displayName : email}</span>
            {p && <span className="shrink-0 text-cinder">@{p.username}</span>}
            {!disabled && <button type="button" className="cursor-pointer rounded-[3px] p-0.5 text-cinder hover:bg-rule-soft hover:text-soot" aria-label={`Remove ${p?.displayName ?? email}`} onClick={() => onChange(values.filter(v => v !== email))}><X size={11} /></button>}
          </span></Tip>
        );
      })}
      {!disabled && <>
        <input
          aria-label="Find people"
          className="h-6 min-w-40 flex-1 border-0 bg-transparent px-1 py-0 text-xs text-soot outline-none placeholder:text-cinder focus:ring-0"
          placeholder={values.length ? "Add someone" : "Type a name or @username"}
          value=""
          onChange={e => e.target.value && start(e.target.value)}
          onKeyDown={e => { if (e.key === "Backspace" && values.length) onChange(values.slice(0, -1)); if (e.key === "Enter") { e.preventDefault(); start(""); } }}
        />
        <button type="button" className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1.5 text-xs text-cinder hover:bg-rule-soft hover:text-soot" onClick={() => start("")}>
          <Plus size={12} aria-hidden="true" />Add people
        </button>
      </>}
      <PeopleModal open={open} people={people} chosen={values} query={query} onQuery={setQuery}
        onClose={() => setOpen(false)} onDone={emails => { onChange(emails); setOpen(false); }} />
    </div>
  );
}

// PeopleModal is a searchable grid of people; click to choose or unchoose,
// then Done. A full email address that is not listed can be added as is.
function PeopleModal({ open, people, chosen, query, onQuery, onClose, onDone }: {
  open: boolean; people: Person[]; chosen: string[]; query: string; onQuery: (q: string) => void;
  onClose: () => void; onDone: (emails: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(chosen);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) { setWasOpen(open); if (open) setPicked(chosen); }
  // "@le" looks for usernames that start with "le"; anything else matches
  // the name, username, or email anywhere.
  const raw = query.trim().toLowerCase();
  const q = raw.replace(/^@/, "");
  const shown = people.filter(p => !q || (raw.startsWith("@")
    ? p.username.toLowerCase().startsWith(q)
    : p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)));
  const extra = EMAIL.test(query.trim()) && !people.some(p => p.email.toLowerCase() === query.trim().toLowerCase()) ? query.trim().toLowerCase() : "";
  const toggle = (email: string) => setPicked(ps => (ps.includes(email) ? ps.filter(x => x !== email) : [...ps, email]));

  // Keys work from the search box: arrows move a highlight over the panels,
  // Space checks or unchecks the highlighted one, and Enter closes with what
  // is checked, changing nothing. A search cannot hold a space.
  const items = [...(extra ? [extra] : []), ...shown.map(p => p.email)];
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setActive(0), [query, open]);
  useEffect(() => { refs.current[active]?.scrollIntoView({ block: "nearest" }); }, [active]);
  // Panels per row, read from the layout: those level with the first one.
  const perRow = () => {
    const top = refs.current[0]?.offsetTop;
    return Math.max(1, refs.current.slice(0, items.length).filter(el => el?.offsetTop === top).length);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow(), ArrowUp: -perRow() }[e.key];
    if (step !== undefined && items.length) {
      e.preventDefault();
      setActive(a => Math.min(items.length - 1, Math.max(0, a + step)));
    } else if (e.key === " ") {
      e.preventDefault();
      if (items[active]) toggle(items[active]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onDone(picked);
    }
  };
  const panel = (on: boolean, i: number) => `relative flex h-full w-full cursor-pointer items-start gap-3 rounded-card border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot ${on ? "border-soot bg-smoke shadow-[inset_0_0_0_1px_var(--color-soot)]" : "border-rule bg-ash hover:border-cinder hover:bg-smoke"} ${i === active ? "outline-2 outline-offset-2 outline-cinder" : ""}`;
  const at = (email: string) => items.indexOf(email);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-soot/30 data-closed:opacity-0 motion-safe:transition motion-safe:duration-100" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel transition className="flex h-[min(640px,85vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-card border border-rule bg-ash shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-100">
          <div className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-3">
            <DialogTitle className="text-sm font-semibold">Choose people</DialogTitle>
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-rule bg-ash px-2.5 focus-within:border-cinder">
              <Search size={14} className="shrink-0 text-cinder" aria-hidden="true" />
              <input autoFocus aria-label="Search people" className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] outline-none focus:ring-0" placeholder="Name, @username, or email"
                value={query} onChange={e => onQuery(e.target.value)} onKeyDown={onKey}
                aria-activedescendant={items[active] ? `person-${active}` : undefined} />
            </label>
            <button type="button" className="-mr-1 cursor-pointer rounded-control p-1 text-cinder hover:bg-rule-soft hover:text-soot" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {shown.length === 0 && !extra && <p className="py-10 text-center text-[13px] text-cinder">No one matches. People appear here once they have signed in; you can also type a full email address.</p>}
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {extra && (
                <li><button type="button" id="person-0" ref={el => { refs.current[0] = el; }} tabIndex={-1} className={panel(picked.includes(extra), 0)} aria-pressed={picked.includes(extra)} onMouseEnter={() => setActive(0)} onClick={() => toggle(extra)}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-rule text-cinder" aria-hidden="true"><Plus size={14} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">Add {extra}</span><span className="block text-xs text-cinder">Has not signed in yet</span></span>
                  {picked.includes(extra) && <Check size={14} className="shrink-0" aria-hidden="true" />}
                </button></li>
              )}
              {shown.map(p => {
                const on = picked.includes(p.email);
                return (
                  <li key={p.email} className="min-w-0"><button type="button" id={`person-${at(p.email)}`} ref={el => { refs.current[at(p.email)] = el; }} tabIndex={-1} className={panel(on, at(p.email))} aria-pressed={on} onMouseEnter={() => setActive(at(p.email))} onClick={() => toggle(p.email)}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-rule bg-smoke text-xs font-semibold" aria-hidden="true">{initial(p)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-medium">{p.displayName}</span>{p.role && <span className="shrink-0 rounded-control bg-rule-soft px-1.5 text-[10px] text-cinder">{p.role}</span>}</span>
                      <span className="block truncate text-xs text-cinder">@{p.username}</span>
                      <span className="block truncate text-[11px] text-cinder">{p.email}</span>
                    </span>
                    {on && <Check size={14} className="shrink-0" aria-hidden="true" />}
                  </button></li>
                );
              })}
            </ul>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-rule px-4 py-3">
            <span className="text-xs text-cinder">{picked.length ? `${picked.length} chosen` : "No one chosen"}</span>
            <span className="flex flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-cinder max-sm:hidden" aria-hidden="true">
              <span><Key>←</Key><Key>↑</Key><Key>↓</Key><Key>→</Key> move</span>
              <span><Key>Space</Key> check</span>
              <span><Key>Enter</Key> done</span>
              <span><Key>Esc</Key> close</span>
            </span>
            <Button size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => onDone(picked)}>Done</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="mx-px inline-grid min-w-5 place-items-center rounded-[4px] border border-rule bg-smoke px-1 font-[inherit] text-[10px] leading-4 text-soot">{children}</kbd>;
}

