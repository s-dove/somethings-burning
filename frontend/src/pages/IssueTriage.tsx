import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/components/Button";
import { Check, ChevronDown, RotateCcw, Volume2, VolumeX } from "../ui/icons";
import { api, canTriage, type IssueDetail } from "../shared/api";
import { Tip } from "../components/Tip";
import { t } from "../shared/i18n";

const DONE = { resolve: t("Issue resolved"), reopen: t("Issue reopened"), unmute: t("Issue unmuted"), mute: t("Issue muted") } as const;
type Action = keyof typeof DONE;

// IssueTriage is the action bar at the top right of the issue header:
// resolve, mute for a while, or put the issue back to open. Viewers get none.
export function IssueTriage({ detail, onChange }: { detail: IssueDetail; onChange: () => void }) {
  const { issue, project, muteOptions, latestRelease } = detail;
  const [busy, setBusy] = useState(false);
  if (!canTriage(project.role)) return null;

  async function act(action: Action, body: unknown = {}) {
    setBusy(true);
    try {
      const path = action === "unmute" ? "reopen" : action;
      await api(`/projects/${project.id}/issues/${issue.id}/${path}`, { method: "POST", body });
      toast(t(DONE[action]));
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {issue.status === "resolved" && (
        <Tip content={t("Reopen it if the fix did not work.")}><Button variant="secondary" disabled={busy} icon={<RotateCcw aria-hidden="true" />} onClick={() => act("reopen")}>{t("Reopen")}</Button></Tip>
      )}
      {issue.status === "muted" && (
        <Tip content={t("The next event alerts again.")}><Button variant="secondary" disabled={busy} icon={<Volume2 aria-hidden="true" />} onClick={() => act("unmute")}>{t("Unmute")}</Button></Tip>
      )}
      {issue.status !== "resolved" && (
        <Menu>
          <MenuButton className="ui-button ui-button-secondary ui-button-md" disabled={busy}>
            <VolumeX aria-hidden="true" />{issue.status === "muted" ? t("Change mute") : t("Mute")}<ChevronDown aria-hidden="true" />
          </MenuButton>
          <MenuItems anchor="bottom end" className="z-40 w-64 rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:4px] focus:outline-none">
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-cinder">{t("Mute for")}</div>
            {muteOptions.map(o => <MenuItem key={o.value}>
              <button className="block w-full cursor-pointer rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => act("mute", { for: o.value })}>{t(o.label)}</button>
            </MenuItem>)}
            <p className="m-0 border-t border-rule-soft px-2.5 pt-2 pb-1.5 text-[11px] leading-snug text-cinder">
              {t("Events keep counting, but nothing alerts until the mute ends.")}
              {latestRelease && <> {t("Next release ends it on the first event newer than {release}.", { release: latestRelease })}</>}
            </p>
          </MenuItems>
        </Menu>
      )}
      {issue.status !== "resolved" && (
        <Tip content={t("Marks everything so far as handled. The next event fires it again.")}><Button variant="primary" disabled={busy} icon={<Check aria-hidden="true" />} onClick={() => act("resolve")}>{t("Resolve")}</Button></Tip>
      )}
    </div>
  );
}
