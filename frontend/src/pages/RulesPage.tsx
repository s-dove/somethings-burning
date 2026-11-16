import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Select, type SelectOption } from "../components/common/Select";
import { confirmDialog } from "../components/Confirm";
import { Sheet } from "../components/Sheet";
import { api, useApi, type ConfigView, type ProjectConfig, type RuleField } from "../shared/api";
import { t } from "../shared/i18n";
import { input } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { ChevronRight, GripVertical, Plus, Trash2 } from "../ui/icons";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";


const FIELD_OPTIONS: SelectOption<RuleField>[] = [
  { value: "path", label: "path", hint: t("Any in-app frame's file") },
  { value: "type", label: "type", hint: t("The exception type") },
  { value: "message", label: "message", hint: t("The exception value or log message") },
  { value: "culprit", label: "culprit", hint: t("The transaction, or the innermost frame of your code") },
  { value: "tag", label: "tag", hint: t("An SDK tag, by name") },
];

/** A project's settings sections: loads them, and saves one section at a time. */
function useConfig() {
  const { id } = useParams();
  const { data, error } = useApi<ConfigView>(`/projects/${id}/config`);
  const [view, setView] = useState<ConfigView | null>(null);
  useEffect(() => setView(data), [data]);
  const save = async <K extends keyof ProjectConfig>(section: K, value: ProjectConfig[K]): Promise<boolean> => {
    try {
      setView(await api<ConfigView>(`/projects/${id}/config/${section}`, { method: "PUT", body: value }));
      toast(t("Saved"));
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };
  return { view, error, save, admin: view?.project.role === "admin" };
}

const rowInput = `${input} mono h-8 py-1 text-xs`;

// ---- Rules (ownership and grouping) ----

export type Rule = { field: RuleField; tag?: string; pattern: string };
export type Target<R> = { key: keyof R & string; label: string; placeholder: string; hint: ReactNode; blank: () => R; mono?: boolean };

/** What is wrong with a rule, by where it shows, before it is saved. */
function ruleProblems<R extends Rule>(r: R, target: Target<R>): Map<string, string> {
  const out = new Map<string, string>();
  if (r.field === "tag" && !(r.tag ?? "").trim()) out.set("tag", t("Add the tag name."));
  if (!r.pattern.trim()) out.set("pattern", t("Add a pattern."));
  else {
    try {
      new RegExp(r.pattern);
    } catch {
      out.set("pattern", t("{v0} is not a valid regex.", { v0: r.pattern }));
    }
  }
  if (!String(r[target.key] ?? "").trim()) out.set("target", t("Fill in {label}.", { label: target.label }));
  return out;
}

// RuleSheet edits one rule on a copy, in the same full-screen sheet as a
// route. Done saves the list with it; Delete saves at once.
function RuleSheet<R extends Rule>({ rule, index, target, readOnly, onDone, onDelete, onClose }: {
  rule: R | null;
  index: number; // -1 for a new rule
  target: Target<R>;
  readOnly: boolean;
  onDone: (r: R) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<R | null>(rule);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(rule);
    setChecked(false);
  }, [rule]);
  const problems = checked && draft ? ruleProblems(draft, target) : new Map<string, string>();
  const isNew = index < 0;
  const set = (patch: Partial<R>) => draft && setDraft({ ...draft, ...patch });
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) onClose();
  };
  const bad = (k: string) => (problems.has(k) ? "border-ember-ink!" : "");
  const note = (k: string) => problems.has(k) && <p className="m-0 mt-1 text-xs text-ember-ink">{problems.get(k)}</p>;
  return (
    <Sheet
      open={!!rule}
      onClose={onClose}
      title={isNew ? t("New rule") : t("Rule {n}", { n: index + 1 })}
      back={t("Back to rules")}
      actions={
        readOnly ? (
          <Button size="sm" onClick={onClose}>{t("Close")}</Button>
        ) : (
          <>
            {!isNew && (
              <Button size="sm" variant="ghost" className="hover:text-ember-ink" icon={<Trash2 aria-hidden="true" />} disabled={busy}
                onClick={() => void confirmDialog({ title: t("Delete this rule?"), body: t("Events it matched follow the rules below it."), confirm: t("Delete"), danger: true }).then((ok) => { if (ok) void run(onDelete); })}>
                {t("Delete")}
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
            <Button size="sm" variant="primary" disabled={!draft || busy}
              onClick={() => {
                if (!draft) return;
                setChecked(true);
                if (ruleProblems(draft, target).size) return;
                void run(() => onDone(draft));
              }}>
              {busy ? t("Saving…") : isNew ? t("Add rule") : t("Done")}
            </Button>
          </>
        )
      }
    >
      {draft && (
        <div>
          <h3 className="mb-2 text-xs font-semibold">{t("When an event matches")}</h3>
          <div className="flex flex-wrap items-start gap-1.5">
            <Select label={t("Field")} hideLabel className="w-40" value={draft.field} options={FIELD_OPTIONS} disabled={readOnly} onChange={(field) => set({ field } as Partial<R>)} />
            {draft.field === "tag" && (
              <div className="w-36">
                <input aria-label={t("Tag name")} className={`${input} mono h-9 w-full text-xs ${bad("tag")}`} placeholder={t("tag name")} value={draft.tag ?? ""} disabled={readOnly} onChange={(e) => set({ tag: e.target.value } as Partial<R>)} />
                {note("tag")}
              </div>
            )}
            <span className="flex h-9 items-center px-1 text-xs text-cinder">{t("matches")}</span>
            <div className="min-w-48 flex-1">
              <input aria-label={t("Pattern")} className={`${input} mono h-9 w-full text-xs ${bad("pattern")}`} placeholder={t("regex, like ^app/payments/")} value={draft.pattern} disabled={readOnly} onChange={(e) => set({ pattern: e.target.value } as Partial<R>)} />
              {note("pattern")}
            </div>
          </div>
          <p className="mt-2 mb-0 text-xs text-cinder">{t("A regex matched anywhere in the value; ^ and $ pin it to the start and end.")}</p>

          <h3 className="mt-7 mb-2 text-xs font-semibold">{target.label}</h3>
          <input aria-label={target.label} className={`${input} ${target.mono ? "mono text-xs" : ""} h-9 w-full ${bad("target")}`} placeholder={target.placeholder} value={String(draft[target.key] ?? "")} disabled={readOnly}
            onChange={(e) => set({ [target.key]: e.target.value } as Partial<R>)} />
          {note("target")}
          <div className="mt-2 text-xs leading-relaxed text-cinder">{target.hint}</div>
        </div>
      )}
    </Sheet>
  );
}

// RulesPage is a list of rules, the first that matches wins: drag to
// reorder, open one to edit it in a sheet. Changes save as they are made.
export function RulesPage<R extends Rule>({ section: key, title, hint, intro, target }: {
  section: "owners" | "grouping";
  title: (name: string) => string;
  hint: string;
  intro: ReactNode;
  target: Target<R>;
}) {
  const settings = useSettings();
  const { view, error, save, admin } = useConfig();
  const rules = (view?.config[key] ?? []) as unknown as R[];
  const [editing, setEditing] = useState<{ index: number; rule: R } | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const persist = (next: R[]) => save(key, next as never);
  const drop = (to: number) => {
    if (from === null || from === to) return;
    const next = [...rules];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r!);
    void persist(next);
  };
  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={title}
      hint={hint}
      action={admin ? <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing({ index: -1, rule: target.blank() })}>{t("Add rule")}</Button> : undefined}
    >
      {() =>
        !view ? null : (
          <div className="pb-10">
            <div className="mb-5 text-[13px] leading-relaxed text-cinder">{intro}</div>
            {rules.length === 0 ? (
              <p className="rounded-card border border-dashed border-rule bg-ash px-4 py-6 text-center text-[13px] text-cinder">{t("No rules.")}</p>
            ) : (
              <ol className="m-0 list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">
                {rules.map((r, i) => (
                  <li key={i} draggable={admin}
                    onDragStart={() => setFrom(i)} onDragEnd={() => { setFrom(null); setOver(null); }}
                    onDragOver={(e) => { if (from !== null) { e.preventDefault(); setOver(i); } }}
                    onDrop={(e) => { e.preventDefault(); drop(i); setFrom(null); setOver(null); }}
                    className={`relative flex items-stretch gap-2 pr-4 hover:bg-smoke ${from === i ? "opacity-40" : ""} ${over === i && from !== null && from !== i ? "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-soot before:content-['']" : ""}`}>
                    {admin ? <span className="grid w-8 shrink-0 cursor-grab place-items-center text-cinder" aria-hidden="true"><GripVertical size={14} /></span> : <span className="w-3 shrink-0" />}
                    <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3.5 text-left" onClick={() => setEditing({ index: i, rule: r })}>
                      <span className="grid size-6 shrink-0 place-items-center rounded-control bg-smoke text-xs font-semibold tabular-nums">{i + 1}</span>
                      <span className="mono min-w-0 flex-1 truncate text-xs">
                        <span className="text-cinder">{r.field === "tag" ? `tag.${r.tag ?? ""}` : r.field}</span> {t("matches")} <span className="text-soot">{r.pattern}</span>
                      </span>
                      <span className="text-xs text-cinder">→</span>
                      <span className={`min-w-0 max-w-[45%] truncate text-xs font-medium ${target.mono ? "mono" : ""}`}>{String(r[target.key] ?? "")}</span>
                      <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {!admin && <p className="mt-4 text-xs text-cinder">{t("Only project admins change these rules.")}</p>}
            <RuleSheet<R>
              rule={editing?.rule ?? null}
              index={editing?.index ?? -1}
              target={target}
              readOnly={!admin}
              onClose={() => setEditing(null)}
              onDone={(r) => persist(editing && editing.index >= 0 ? rules.map((x, j) => (j === editing.index ? r : x)) : [...rules, r])}
              onDelete={() => persist(rules.filter((_, j) => j !== editing?.index))}
            />
          </div>
        )
      }
    </SettingsFrame>
  );
}

