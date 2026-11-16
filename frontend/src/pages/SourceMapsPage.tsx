import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { TimeTip } from "../components/Tip";
import { api, useApi, type Artifact } from "../shared/api";
import { ago, plural } from "../shared/format";
import { input, section, sectionTitle } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Trash2, Upload } from "../ui/icons";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";
import { confirmDialog } from "../components/Confirm";
import { t } from "../shared/i18n";

export function SourceMapsPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data, error, reload } = useApi<{ artifacts: Artifact[] }>(`/projects/${id}/sourcemaps`);
  const admin = settings.data?.project.role === "admin";
  const [release, setRelease] = useState("");
  const [prefix, setPrefix] = useState("~/static/js/");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData();
    form.set("release", release.trim());
    form.set("prefix", prefix.trim());
    for (const f of files) form.append("file", f);
    try {
      const res = await fetch(`/api/projects/${id}/sourcemaps`, { method: "POST", body: form });
      const body = (await res.json()) as { detail?: string; uploaded?: string[] };
      if (!res.ok) throw new Error(body.detail ?? `Upload failed (${res.status}).`);
      toast(`Uploaded ${plural(body.uploaded?.length ?? 0, "map")}`);
      setFiles([]);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (a: Artifact) => {
    if (!(await confirmDialog({ title: t("Delete {name}?", { name: a.name }), body: t("Frames of {release} it mapped show minified again.", { release: a.release }), confirm: t("Delete"), danger: true }))) return;
    try {
      await api(`/projects/${id}/sourcemaps`, { method: "DELETE", body: { release: a.release, name: a.name } });
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const byRelease = new Map<string, Artifact[]>();
  for (const a of data?.artifacts ?? []) byRelease.set(a.release, [...(byRelease.get(a.release) ?? []), a]);
  const origin = window.location.origin;
  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={(name) => `${name} source maps`}
      hint="Turn minified JavaScript stack frames back into your code."
    >
      {() => (
        <div className="grid gap-6">
          <section className={section}>
            <h2 className={sectionTitle}>
              How it works <span className="text-xs font-normal text-cinder">{t("maps are per release")}</span>
            </h2>
            <p className="text-[13px] leading-relaxed text-cinder">
              Upload each <span className="mono">.map</span> under the URL path of its script, with <span className="mono">~</span> for any host. The map of <span className="mono">https://shop.example.com/static/js/app.min.js</span> is <span className="mono">~/static/js/app.min.js.map</span>. Events of that release then show the original file, line, function, and code, including events already stored.
            </p>
            <pre className="mono mt-3 overflow-x-auto rounded-control bg-smoke p-3 text-xs leading-relaxed">{`curl -X POST ${origin}/api/projects/${id}/sourcemaps \\
  -H "Authorization: Bearer $BURNING_TOKEN" \\
  -F release="$RELEASE" -F prefix="~/static/js/" \\
  -F file=@dist/app.min.js.map`}</pre>
            <p className="mt-2 text-xs text-cinder"><span className="mono">$RELEASE</span> must be exactly what the SDK reports. A map only applies to events of that release.</p>
          </section>
          {admin && (
            <form className={`${section} grid gap-3`} onSubmit={(e) => void upload(e)}>
              <h2 className={sectionTitle}>{t("Upload")}</h2>
              <div className="flex flex-wrap gap-2">
                <input className={`${input} mono h-9 min-w-48 flex-1`} placeholder="release, like shop@1.2.0" value={release} onChange={(e) => setRelease(e.target.value)} required />
                <input className={`${input} mono h-9 w-56`} placeholder="~/static/js/" aria-label="Path prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </div>
              <input type="file" accept=".map,application/json" multiple className="text-xs" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
              <div>
                <Button variant="primary" type="submit" disabled={busy || !files.length || !release.trim()} icon={<Upload aria-hidden="true" />}>
                  {busy ? "Uploading…" : files.length ? `Upload ${plural(files.length, "file")}` : "Upload"}
                </Button>
              </div>
            </form>
          )}
          <section className={section}>
            <h2 className={sectionTitle}>
              Uploaded <span className="text-xs font-normal text-cinder">{plural(data?.artifacts.length ?? 0, "map")}</span>
            </h2>
            {byRelease.size === 0 && <p className="text-[13px] text-cinder">{t("No source maps yet.")}</p>}
            {[...byRelease].map(([rel, list]) => (
              <div key={rel} className="mb-4 last:mb-0">
                <div className="mono mb-1 text-xs font-semibold">{rel}</div>
                <ul className="m-0 list-none divide-y divide-rule-soft p-0">
                  {list.map((a) => (
                    <li key={a.name} className="flex items-center gap-3 py-1.5 text-[13px]">
                      <span className="mono min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="text-xs text-cinder">{(a.size / 1024).toFixed(1)} KB</span>
                      <TimeTip at={a.createdAt}><span className="text-xs text-cinder">{ago(a.createdAt)}</span></TimeTip>
                      {admin && (
                        <button type="button" className="cursor-pointer text-cinder hover:text-ember-ink" aria-label={`Delete ${a.name}`} onClick={() => void remove(a)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </SettingsFrame>
  );
}
