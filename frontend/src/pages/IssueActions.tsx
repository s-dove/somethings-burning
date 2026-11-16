import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "../ui/components/Button";
import { RotateCcw, Volume2, VolumeX } from "../ui/icons";
import { api, type Issue } from "../shared/api";
import { t } from "../shared/i18n";

const DONE = { resolve: "Issue resolved", unresolve: "Issue unresolved", mute: "Issue muted", unmute: "Issue unmuted" } as const;
type Action = keyof typeof DONE;
const PATH: Record<Action, string> = { resolve: "resolve", unresolve: "reopen", mute: "mute", unmute: "reopen" };

// IssueActions triages one issue from the list: unresolve, mute, or unmute.
// Resolving is done by checking rows and using the bar below the list, so a
// stray click cannot resolve an issue. The buttons sit above the row link.
export function IssueActions({ issue, muteOptions }: { issue: Issue; muteOptions: { value: string; label: string }[] }) {
  const [busy, setBusy] = useState(false);
  const { mutate } = useSWRConfig();

  async function act(action: Action, body: unknown = {}) {
    setBusy(true);
    try {
      await api(`/projects/${issue.projectId}/issues/${issue.id}/${PATH[action]}`, { method: "POST", body });
      toast(DONE[action]);
      // Refresh every board query, so the list, counts, and sidebar agree.
      void mutate((key) => typeof key === "string" && key.startsWith("/board"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex flex-col gap-1.5">
      {issue.status === "resolved" && <Button size="sm" variant="secondary" className="w-full" disabled={busy} icon={<RotateCcw aria-hidden="true" />} onClick={() => act("unresolve")}>{t("Unresolve")}</Button>}
      {issue.status === "muted"
        ? <Button size="sm" variant="secondary" className="w-full" disabled={busy} icon={<Volume2 aria-hidden="true" />} onClick={() => act("unmute")}>{t("Unmute")}</Button>
        : issue.status === "open" && <Menu>
          <MenuButton className="ui-button ui-button-secondary ui-button-sm w-full" disabled={busy}><VolumeX aria-hidden="true" />{t("Mute")}</MenuButton>
          <MenuItems anchor="bottom end" className="z-40 min-w-36 rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:4px] focus:outline-none">
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-cinder">{t("Mute for")}</div>
            {muteOptions.map(o => <MenuItem key={o.value}>
              <button className="block w-full cursor-pointer rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => act("mute", { for: o.value })}>{o.label}</button>
            </MenuItem>)}
          </MenuItems>
        </Menu>}
    </div>
  );
}
