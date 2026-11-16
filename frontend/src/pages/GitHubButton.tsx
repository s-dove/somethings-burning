import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState } from "react";
import { toast } from "sonner";
import { Tip } from "../components/Tip";
import { api, canTriage, type IssueDetail } from "../shared/api";
import { ago } from "../shared/format";
import { Button } from "../ui/components/Button";
import { ChevronDown, ExternalLink, Github, Plus } from "../ui/icons";
import { confirmDialog } from "../components/Confirm";
import { t } from "../shared/i18n";

function issueRef(url: string): string {
  const m = /\/issues\/(\d+)/.exec(url);
  return m ? `#${m[1]}` : "";
}

/** Opens a GitHub issue from this one, in the project's primary repository. */
export function GitHubButton({ detail, onChange }: { detail: IssueDetail; onChange: () => void }) {
  const { issue, project, githubIssues } = detail;
  const [busy, setBusy] = useState(false);
  const canCreate = detail.github && canTriage(project.role);
  const latest = githubIssues?.[0]?.url || issue.externalUrl;
  if (!latest && !canCreate) return null;

  const create = async () => {
    const again = !!latest;
    const ok = await confirmDialog(again
      ? { title: t("Open another GitHub issue?"), body: t("The earlier ones stay listed."), confirm: t("Open it") }
      : { title: t("Open a GitHub issue?"), body: t("In the project's primary repository, with the title, counts, and a link back here."), confirm: t("Open it") });
    if (!ok) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/projects/${project.id}/issues/${issue.id}/github`, { method: "POST", body: { again } });
      toast(t("GitHub issue opened"), { action: { label: t("Open it"), onClick: () => window.open(url, "_blank") } });
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!latest) {
    return (
      <Tip content={t("Open an issue in the project's primary GitHub repository, linking back here")}>
        <Button variant="secondary" disabled={busy} icon={<Github aria-hidden="true" />} onClick={() => void create()}>{busy ? t("Opening…") : t("GitHub issue")}</Button>
      </Tip>
    );
  }
  const list = githubIssues?.length ? githubIssues : [{ url: latest, at: 0, by: "" }];
  return (
    <Menu>
      <MenuButton className="ui-button ui-button-secondary ui-button-md" disabled={busy}>
        <Github aria-hidden="true" />
        GitHub {issueRef(latest)}
        <ChevronDown aria-hidden="true" />
      </MenuButton>
      <MenuItems anchor="bottom end" className="z-40 w-72 rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:4px] focus:outline-none">
        <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-cinder">{list.length === 1 ? t("GitHub issue made from this one") : t("{n} GitHub issues made from this one, newest first", { n: list.length })}</div>
        {list.map((g, n) => (
          <MenuItem key={`${g.url}-${n}`}>
            <a href={g.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-control px-2.5 py-1.5 text-soot no-underline data-focus:bg-rule-soft">
              <span className="mono">{issueRef(g.url) || g.url}</span>
              {n === 0 && list.length > 1 && <span className="rounded-control bg-smoke px-1 text-[10px] text-cinder">{t("latest")}</span>}
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-cinder">{g.at ? `${ago(g.at)}${g.by ? ` ${t("by {name}", { name: g.by })}` : ""}` : ""}</span>
              <ExternalLink size={12} className="shrink-0 text-cinder" aria-hidden="true" />
            </a>
          </MenuItem>
        ))}
        {canCreate && (
          <>
            <div className="my-1 border-t border-rule-soft" />
            <MenuItem>
              <button className="flex w-full cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => void create()}>
                <Plus size={13} aria-hidden="true" />
                {t("Open another GitHub issue…")}
              </button>
            </MenuItem>
          </>
        )}
      </MenuItems>
    </Menu>
  );
}
