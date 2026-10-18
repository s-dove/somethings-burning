import type { ReactNode } from "react";
import { Picker, type PickOption } from "../components/Picker";
import { Tip } from "../components/Tip";
import { ArrowRight, CircleAlert, GitBranch, Github, Plus, X } from "../ui/icons";
import type { ReleaseKind, SourceConfig, SourceKind } from "../shared/api";
import { input } from "../shared/ui";

const iconBtn = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-cinder hover:bg-rule-soft hover:text-soot disabled:cursor-not-allowed disabled:opacity-40";

export const KIND: Record<SourceKind, { label: string; hint: string; icon: ReactNode; placeholder: string }> = {
  github: { label: "GitHub", hint: "github.com or GitHub Enterprise, read through its API", icon: <Github size={14} />, placeholder: "github.com/getsentry/sentry" },
  git: { label: "Git", hint: "Any git server, read from a local mirror", icon: <GitBranch size={14} />, placeholder: "git@git.example.com:team/repo.git" },
};

export const RELEASE: Record<ReleaseKind, { label: string; hint: string; value?: string }> = {
  auto: { label: "Auto", hint: "Commit in the release, then a tag named like it, then the branch" },
  sha: { label: "Commit in release", hint: "api@2.15.0+3e7cbf4, or a bare commit" },
  tag: { label: "Tag = release", hint: "Release 2.15.0 reads tag 2.15.0" },
  vtag: { label: "Tag = v + version", hint: "Release 2.15.0 reads tag v2.15.0" },
  template: { label: "Tag template", hint: "Per-service tags in a monorepo", value: "payments-api/v{version}" },
  event_tag: { label: "Event tag", hint: "The commit from a tag the SDK sends", value: "commit" },
  regex: { label: "Regex", hint: "One capture group picks the commit or tag", value: "sha-([0-9a-f]+)" },
  branch: { label: "Default branch", hint: "Always the branch, for code without versions" },
};

// hostOf gives the host a source reads from, to say whether it has a token.
export function hostOf(s: SourceConfig): string {
  if (s.kind === "github") return s.repo.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return /^[\w.-]+@([\w.-]+):/.exec(s.repo)?.[1] ?? (() => { try { return new URL(s.repo).hostname; } catch { return ""; } })();
}

export function credentialNote(s: SourceConfig, hosts: string[], sshKey: boolean): string {
  const host = hostOf(s).toLowerCase();
  if (!host) return "";
  const ssh = s.kind === "git" && !/^https?:\/\//.test(s.repo);
  if (ssh) return sshKey ? "" : "No SSH key on the server (BURNING_GIT_SSH_KEY)";
  return hosts.includes(host) ? "" : `No token for ${host}: only public repositories can be read`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-1.5 text-xs font-semibold">{label}{hint && <span className="ml-2 font-normal text-cinder">{hint}</span>}</div>
      {children}
    </div>
  );
}

// SourceEditor edits one code source.
export function SourceEditor({ source: s, hosts, sshKey, readOnly, onChange }: {
  source: SourceConfig; hosts: string[]; sshKey: boolean; readOnly: boolean; onChange: (s: SourceConfig) => void;
}) {
  const kinds: PickOption<SourceKind>[] = (["github", "git"] as const).map(k => ({ value: k, label: KIND[k].label, hint: KIND[k].hint, icon: KIND[k].icon }));
  const rules: PickOption<ReleaseKind>[] = (Object.keys(RELEASE) as ReleaseKind[]).map(k => ({ value: k, label: RELEASE[k].label, hint: RELEASE[k].hint }));
  const note = credentialNote(s, hosts, sshKey);
  const set = (patch: Partial<SourceConfig>) => onChange({ ...s, ...patch });
  const setMapping = (i: number, patch: Partial<SourceConfig["mappings"][number]>) => set({ mappings: s.mappings.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const rule = RELEASE[s.release.kind];

  return (
    <>
      <Field label="Repository">
        <div className="flex flex-wrap items-center gap-2">
          <Picker label="Kind" className="w-32" value={s.kind} options={kinds} disabled={readOnly} onChange={kind => set({ kind, web: "" })} />
          <input aria-label="Repository" className={`${input} mono h-8 min-w-60 flex-1 py-1 text-xs`} placeholder={KIND[s.kind].placeholder} value={s.repo} disabled={readOnly} onChange={e => set({ repo: e.target.value })} />
        </div>
        {note && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ember-ink"><CircleAlert size={13} aria-hidden="true" />{note}</p>}
      </Field>

      <Field label="Default branch" hint="read when the release gives no commit">
        <input aria-label="Default branch" className={`${input} mono h-8 w-56 py-1 text-xs`} placeholder="main" value={s.branch} disabled={readOnly} onChange={e => set({ branch: e.target.value })} />
      </Field>

      <Field label="Path mappings" hint="stack trace path → folder in the repository">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {s.mappings.map((m, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label="Stack trace path starts with" className={`${input} mono h-8 min-w-48 flex-1 py-1 text-xs`} placeholder="/srv/app/" value={m.prefix} disabled={readOnly} onChange={e => setMapping(i, { prefix: e.target.value })} />
              <ArrowRight size={14} className="shrink-0 text-cinder" aria-hidden="true" />
              <input aria-label="Folder in the repository" className={`${input} mono h-8 min-w-48 flex-1 py-1 text-xs`} placeholder="(repository root)" value={m.dir} disabled={readOnly} onChange={e => setMapping(i, { dir: e.target.value })} />
              {!readOnly && <Tip content="Remove mapping"><button type="button" className={iconBtn} aria-label="Remove mapping" onClick={() => set({ mappings: s.mappings.filter((_, j) => j !== i) })}><X size={14} /></button></Tip>}
            </li>
          ))}
        </ul>
        {!readOnly && <button type="button" className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1.5 text-xs text-cinder hover:bg-rule-soft hover:text-soot" onClick={() => set({ mappings: [...s.mappings, { prefix: "", dir: "" }] })}><Plus size={14} aria-hidden="true" />Add mapping</button>}
      </Field>

      <Field label="Release → code">
        <div className="flex flex-wrap items-center gap-2">
          <Picker label="Release rule" className="w-44" value={s.release.kind} options={rules} disabled={readOnly}
            onChange={kind => set({ release: { kind, value: RELEASE[kind].value && s.release.kind !== kind ? "" : s.release.value } })} />
          {rule.value !== undefined
            ? <input aria-label={rule.label} className={`${input} mono h-8 min-w-48 flex-1 py-1 text-xs`} placeholder={rule.value} value={s.release.value} disabled={readOnly} onChange={e => set({ release: { ...s.release, value: e.target.value } })} />
            : <span className="flex h-8 min-w-48 flex-1 items-center rounded-control border border-dashed border-rule px-3 text-xs text-cinder">{rule.hint}</span>}
        </div>
      </Field>

      <Field label="Context file" hint="given to AI analysis, read at the same commit">
        <input aria-label="Context file" className={`${input} mono h-8 w-72 py-1 text-xs`} placeholder="AGENTS.md (empty: none)" value={s.context} disabled={readOnly} onChange={e => set({ context: e.target.value })} />
      </Field>

      {s.kind === "git" && (
        <Field label="Link template" hint="{ref} {path} {line}; empty: no links">
          <input aria-label="Link template" className={`${input} mono h-8 w-full py-1 text-xs`} placeholder="https://git.example.com/team/repo/src/{ref}/{path}#L{line}" value={s.web} disabled={readOnly} onChange={e => set({ web: e.target.value })} />
        </Field>
      )}

      <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" className="size-4 cursor-pointer" checked={s.primary} disabled={readOnly} onChange={e => set({ primary: e.target.checked })} />
        Primary: the service's own repository
        <span className="text-xs text-cinder">diffs between releases come from it</span>
      </label>
    </>
  );
}
