import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Select } from "../components/common/Select";
import { api, useApi, type ConfigView, type GroupingRule, type RuleField } from "../shared/api";
import { input, section } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Plus, X } from "../ui/icons";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";

const FIELDS: RuleField[] = ["path", "type", "message", "culprit", "tag"];
const blank = (): GroupingRule => ({ field: "message", pattern: "", fingerprint: "" });

function problems(r: GroupingRule): string {
  if (r.field === "tag" && !/^[\w.-]+$/.test((r.tag ?? "").trim())) return "Name the tag.";
  if (!r.pattern.trim()) return "Add a pattern.";
  try {
    new RegExp(r.pattern);
  } catch {
    return `"${r.pattern}" is not a valid regex.`;
  }
  if (!r.fingerprint.trim()) return "Write the fingerprint, like db-timeout or {{ type }} {{ tag.region }}.";
  return "";
}

export function GroupingPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data, error } = useApi<ConfigView>(`/projects/${id}/config`);
  const [view, setView] = useState<ConfigView | null>(null);
  const [rules, setRules] = useState<GroupingRule[]>([]);
  const [checked, setChecked] = useState(false);
  useEffect(() => setView(data), [data]);
  useEffect(() => {
    if (view) setRules(view.config.grouping.map((r) => ({ ...r })));
  }, [view]);
  const admin = view?.project.role === "admin";
  const dirty = !!view && JSON.stringify(rules) !== JSON.stringify(view.config.grouping);
  const save = async () => {
    setChecked(true);
    if (rules.some((r) => problems(r))) return;
    const body = rules.map((r) => ({ field: r.field, ...(r.field === "tag" ? { tag: r.tag!.trim() } : {}), pattern: r.pattern.trim(), fingerprint: r.fingerprint.trim() }));
    try {
      setView(await api<ConfigView>(`/projects/${id}/config/grouping`, { method: "PUT", body }));
      setChecked(false);
      toast("Saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const set = (i: number, patch: Partial<GroupingRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={(name) => `${name} grouping`}
      hint="Which events count as one issue."
      action={admin ? <Button variant="primary" disabled={!dirty} onClick={() => void save()}>Save</Button> : undefined}
    >
      {() =>
        !view ? null : (
          <section className={section}>
            <p className="mb-4 text-xs text-cinder">
              Events that match a rule get its fingerprint instead of the default grouping. Words in braces take the event's values: <span className="mono text-soot">{"{{ type }}"}</span>, <span className="mono text-soot">{"{{ message }}"}</span>, <span className="mono text-soot">{"{{ culprit }}"}</span>, <span className="mono text-soot">{"{{ tag.region }}"}</span>, and <span className="mono text-soot">{"{{ default }}"}</span> for the usual grouping. Rules apply to new events. To join issues that already exist, merge them from the list.
            </p>
            <ul className="m-0 grid list-none gap-3 p-0">
              {rules.map((r, i) => {
                const bad = checked ? problems(r) : "";
                return (
                  <li key={i} className="grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-6 text-xs text-cinder">{i + 1}</span>
                      <Select label="Field" hideLabel className="w-36" size="sm" value={r.field} disabled={!admin} options={FIELDS.map((f) => ({ value: f, label: f }))} onChange={(field) => set(i, { field, tag: field === "tag" ? r.tag : undefined })} />
                      {r.field === "tag" && <input aria-label="Tag name" className={`${input} mono h-8 w-32 py-1 text-xs`} placeholder="tag name" value={r.tag ?? ""} disabled={!admin} onChange={(e) => set(i, { tag: e.target.value })} />}
                      <input aria-label="Pattern" className={`${input} mono h-8 min-w-40 flex-1 py-1 text-xs`} placeholder="regex" value={r.pattern} disabled={!admin} onChange={(e) => set(i, { pattern: e.target.value })} />
                      <input aria-label="Fingerprint" className={`${input} mono h-8 w-64 py-1 text-xs`} placeholder="db-timeout {{ tag.region }}" value={r.fingerprint} disabled={!admin} onChange={(e) => set(i, { fingerprint: e.target.value })} />
                      {admin && <button type="button" className="grid size-8 cursor-pointer place-items-center rounded-control text-cinder hover:bg-rule-soft hover:text-soot" aria-label={`Remove rule ${i + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}><X size={14} /></button>}
                    </div>
                    {bad && <p className="m-0 pl-8 text-xs text-ember-ink">{bad}</p>}
                  </li>
                );
              })}
            </ul>
            {rules.length === 0 && <p className="text-xs text-cinder">No rules. Events use the default grouping.</p>}
            {admin && rules.length < 50 && (
              <button type="button" className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1 text-xs text-cinder hover:bg-rule-soft hover:text-soot" onClick={() => setRules([...rules, blank()])}>
                <Plus size={12} aria-hidden="true" />Add rule
              </button>
            )}
          </section>
        )
      }
    </SettingsFrame>
  );
}
