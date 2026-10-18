import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Sheet } from "../components/Sheet";
import { Tip } from "../components/Tip";
import { Button } from "../ui/components/Button";
import { ChevronRight, CircleAlert, FlaskConical, Plus, Trash2 } from "../ui/icons";
import { api, useApi, type SourceConfig, type SourcesTest, type SourcesView } from "../shared/api";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";
import { credentialNote, KIND, RELEASE, SourceEditor } from "./SourceEditor";
import { SourceTestResult } from "./SourceTest";

const newSource = (first: boolean): SourceConfig => ({
  kind: "github", repo: "", branch: "main", mappings: [{ prefix: "", dir: "" }], release: { kind: "auto", value: "" }, primary: first, context: "", web: "",
});

// SourcesPage lists the repositories a project's stack frames come from.
// Each change saves the whole list, like the notification routes.
export function SourcesPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data, error } = useApi<SourcesView>(`/projects/${id}/sources`);
  const [view, setView] = useState<SourcesView | null>(null);
  useEffect(() => { if (data) setView(data); }, [data]);
  const [editing, setEditing] = useState<{ index: number; draft: SourceConfig } | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ result: SourcesTest; sources: SourceConfig[] } | null>(null);
  const admin = view?.project.role === "admin";
  const sources = view?.sources ?? [];

  // A source marked primary takes the mark from the others.
  const withDraft = (index: number, draft: SourceConfig | null) => {
    const list = index < 0 ? [...sources, draft!] : draft ? sources.map((s, j) => (j === index ? draft : s)) : sources.filter((_, j) => j !== index);
    const primary = draft?.primary ? (index < 0 ? list.length - 1 : index) : -1;
    return list.map((s, j) => (primary >= 0 ? { ...s, primary: j === primary } : s));
  };
  const save = async (next: SourceConfig[], done: string) => {
    setBusy(true);
    setProblem("");
    try {
      setView(await api<SourcesView>(`/projects/${id}/sources`, { method: "PUT", body: { sources: next } }));
      toast(done);
      setEditing(null);
      setTest(null);
    } catch (err) {
      setProblem((err instanceof Error ? err.message : String(err)).replace(/^source \d+: /, ""));
    } finally {
      setBusy(false);
    }
  };
  const runTest = async (list: SourceConfig[]) => {
    setBusy(true);
    setProblem("");
    try {
      setTest({ result: await api<SourcesTest>(`/projects/${id}/sources/test`, { method: "POST", body: { sources: list } }), sources: list });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={name => `${name} code`}
      hint="The repositories its stack frames come from, for source links and AI analysis."
      action={admin ? <div className="flex gap-2">
        {sources.length > 0 && <Button icon={<FlaskConical aria-hidden="true" />} disabled={busy} onClick={() => { setEditing(null); void runTest(sources); }}>Test</Button>}
        <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => { setProblem(""); setTest(null); setEditing({ index: -1, draft: newSource(sources.length === 0) }); }}>Add source</Button>
      </div> : undefined}
    >
      {() => !view ? null : (
        <div className="pb-10">
          {sources.length === 0
            ? <p className="rounded-card border border-dashed border-rule px-6 py-12 text-center text-[13px] text-cinder">No code sources. Stack frames show without links.</p>
            : <ul className="m-0 list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">
              {sources.map((s, i) => {
                const note = credentialNote(s, view.hosts, view.sshKey);
                return (
                  <li key={i}>
                    <button type="button" className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left hover:bg-rule-soft" onClick={() => { setProblem(""); setTest(null); setEditing({ index: i, draft: s }); }}>
                      <span className="grid size-9 shrink-0 place-items-center rounded-control border border-rule bg-smoke text-cinder">{KIND[s.kind].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="mono truncate text-[13px] font-semibold">{s.repo}</span>
                          {s.primary && <span className="shrink-0 rounded-control bg-rule-soft px-1.5 py-0.5 text-[11px] text-cinder">primary</span>}
                          {note && <Tip content={note}><CircleAlert size={14} className="shrink-0 text-ember-ink" aria-label={note} /></Tip>}
                        </span>
                        <span className="mt-1 block truncate text-xs text-cinder">
                          {s.mappings.map(m => m.prefix).join(", ")} · release: {RELEASE[s.release.kind].label}{s.release.value && ` ${s.release.value}`} · branch {s.branch}{s.context && ` · context ${s.context}`}
                        </span>
                      </span>
                      <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>}
          {!editing && problem && <p role="alert" className="mt-4 text-[13px] text-ember-ink">{problem}</p>}
          {!editing && test && <div className="mt-6"><SourceTestResult test={test.result} sources={test.sources} projectId={view.project.id} /></div>}
          {!admin && <p className="mt-6 text-xs text-cinder">Only project admins can change code sources.</p>}

          <Sheet open={!!editing} onClose={() => setEditing(null)} back="Back to code"
            title={editing?.index === -1 ? "New source" : editing?.draft.repo || "Source"}
            actions={!admin ? <Button size="sm" onClick={() => setEditing(null)}>Close</Button> : editing && <>
              {editing.index >= 0 && <Button size="sm" variant="ghost" className="hover:text-ember-ink" icon={<Trash2 aria-hidden="true" />} disabled={busy}
                onClick={() => { if (window.confirm("Delete this source?")) void save(withDraft(editing.index, null), "Source deleted"); }}>Delete</Button>}
              <Button size="sm" icon={<FlaskConical aria-hidden="true" />} disabled={busy} onClick={() => void runTest(withDraft(editing.index, editing.draft))}>Test</Button>
              <Button size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void save(withDraft(editing.index, editing.draft), editing.index < 0 ? "Source added" : "Source saved")}>{busy ? "Saving…" : editing.index < 0 ? "Add source" : "Done"}</Button>
            </>}>
            {problem && <p role="alert" className="mb-5 rounded-card border border-ember-ink/30 bg-ember-soft px-4 py-3 text-[13px] text-ember-ink">{problem}</p>}
            {editing && <SourceEditor source={editing.draft} hosts={view.hosts} sshKey={view.sshKey} readOnly={!admin} onChange={draft => { setEditing({ ...editing, draft }); setProblem(""); }} />}
            {editing && test && <div className="mt-8"><SourceTestResult test={test.result} sources={test.sources} projectId={view.project.id} /></div>}
          </Sheet>
        </div>
      )}
    </SettingsFrame>
  );
}
