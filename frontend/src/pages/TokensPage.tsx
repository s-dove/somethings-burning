import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { api, useApi, type TokenView } from "../shared/api";
import { copyText } from "../shared/clipboard";
import { ago } from "../shared/format";
import { input, section, sectionTitle } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Plus } from "../ui/icons";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";

export function TokensPage() {
  const { id } = useParams();
  const settings = useSettings();
  const admin = settings.data?.project.role === "admin";
  const { data, error, reload } = useApi<{ tokens: TokenView[] }>(admin ? `/projects/${id}/tokens` : null);
  const [name, setName] = useState("CI");
  const [made, setMade] = useState("");
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>(`/projects/${id}/tokens`, { method: "POST", body: { name } });
      setMade(r.token);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const revoke = async (tok: TokenView) => {
    if (!confirm(`Revoke ${tok.name}? Anything using it stops working at once.`)) return;
    try {
      await api(`/projects/${id}/tokens/${tok.id}`, { method: "DELETE" });
      if (made.startsWith(tok.prefix)) setMade("");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const origin = window.location.origin;
  const example = `BURNING=${origin}/api/projects/${id}
RELEASE="shop@$(git describe --tags --always)"

curl -fsS -X POST "$BURNING/releases" -H "Authorization: Bearer $BURNING_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"version":"'"$RELEASE"'","commit":"'"$(git rev-parse HEAD)"'"}'

curl -fsS -X POST "$BURNING/deploys" -H "Authorization: Bearer $BURNING_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"release":"'"$RELEASE"'","environment":"production"}'`;
  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={(n) => `${n} API tokens`}
      hint="Let CI create releases, mark deploys, and upload source maps."
    >
      {(s) =>
        s.project.role !== "admin" ? (
          <p className="text-[13px] text-cinder">Only project admins manage API tokens.</p>
        ) : (
          <div className="grid gap-6">
            <form className={`${section} flex flex-wrap items-end gap-2`} onSubmit={(e) => void create(e)}>
              <label className="grid min-w-56 flex-1 gap-1.5 text-xs font-medium">
                New token
                <input className={`${input} h-9`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
              </label>
              <Button variant="primary" type="submit" icon={<Plus aria-hidden="true" />}>Create</Button>
              {made && (
                <div className="mt-3 w-full rounded-control border border-[#f6cfae] bg-ember-soft p-3">
                  <p className="mb-2 text-xs font-semibold text-ember-ink">Copy it now: it is not shown again.</p>
                  <div className="flex gap-2">
                    <input readOnly className={`${input} mono min-w-0 flex-1`} value={made} onFocus={(e) => e.target.select()} />
                    <Button type="button" variant="secondary" onClick={() => void copyText(made)}>Copy</Button>
                  </div>
                </div>
              )}
            </form>
            <section className={section}>
              <h2 className={sectionTitle}>Tokens</h2>
              {!data?.tokens.length ? (
                <p className="text-[13px] text-cinder">No tokens.</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-rule-soft p-0">
                  {data.tokens.map((tok) => (
                    <li key={tok.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                      <span className="font-medium">{tok.name}</span>
                      <span className="mono text-xs text-cinder">{tok.prefix}…</span>
                      <span className="text-xs text-cinder">by {tok.createdBy || "?"} {ago(tok.createdAt)} · {tok.lastUsed ? `used ${ago(tok.lastUsed)}` : "never used"}</span>
                      <button type="button" className="ml-auto cursor-pointer text-xs text-cinder hover:text-ember-ink" onClick={() => void revoke(tok)}>Revoke</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={section}>
              <h2 className={sectionTitle}>What a token can do</h2>
              <p className="text-[13px] leading-relaxed text-cinder">Only this project's releases, deploys, and source maps. It cannot read issues or change settings. SDKs do not use it; they report with the DSN. The value is shown once and only a hash is kept.</p>
              <pre className="mono mt-4 overflow-x-auto rounded-control bg-smoke p-3 text-xs leading-relaxed">{example}</pre>
            </section>
          </div>
        )
      }
    </SettingsFrame>
  );
}
