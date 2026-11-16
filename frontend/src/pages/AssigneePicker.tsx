import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState } from "react";
import { toast } from "sonner";
import { api, canTriage, useApi, type IssueDetail, type Session } from "../shared/api";
import { ChevronDown, UserRound } from "../ui/icons";
import { t } from "../shared/i18n";

type Person = { email: string; username: string; displayName: string; role: string };

/** Who handles the issue. Members assign; viewers see the name only. */
export function AssigneePicker({ detail, onChange }: { detail: IssueDetail; onChange: () => void }) {
  const { issue, project } = detail;
  const { data: people } = useApi<Person[]>(canTriage(project.role) ? `/people?project=${project.id}` : null);
  const { data: session } = useApi<Session>(canTriage(project.role) ? "/session" : null);
  const [busy, setBusy] = useState(false);
  const me = session?.user?.email.toLowerCase() ?? "";
  const name = (email: string) => people?.find((p) => p.email === email)?.displayName ?? email;
  const set = async (assignee: string) => {
    setBusy(true);
    try {
      await api(`/projects/${project.id}/issues/${issue.id}/assign`, { method: "POST", body: { assignee } });
      toast(assignee ? t("Assigned to {name}", { name: name(assignee) }) : t("Unassigned"));
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = issue.assignee ? name(issue.assignee) : t("Unassigned");
  if (!canTriage(project.role)) {
    return (
      <span className="inline-flex h-9 items-center gap-2 px-2 text-[13px] text-cinder">
        <UserRound aria-hidden="true" />
        {label}
      </span>
    );
  }
  const others = (people ?? []).filter((p) => p.email !== me && p.email !== issue.assignee);
  return (
    <Menu>
      <MenuButton className="ui-button ui-button-secondary ui-button-md max-w-56" disabled={busy} aria-label={t("Assignee: {label}. Change", { label })}>
        <UserRound aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" />
      </MenuButton>
      <MenuItems anchor="bottom end" className="z-40 max-h-80 w-64 overflow-y-auto rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:4px] focus:outline-none">
        <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-cinder">{t("Assign to")}</div>
        {me && me !== issue.assignee && (
          <MenuItem>
            <button className="block w-full cursor-pointer rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => void set(me)}>{t("Me")}</button>
          </MenuItem>
        )}
        {others.map((p) => (
          <MenuItem key={p.email}>
            <button className="flex w-full cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => void set(p.email)}>
              <UserRound size={13} className="shrink-0 text-cinder" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
              {p.role && <span className="shrink-0 text-[10px] text-cinder">{p.role}</span>}
            </button>
          </MenuItem>
        ))}
        {issue.assignee && (
          <MenuItem>
            <button className="block w-full cursor-pointer rounded-control border-t border-rule-soft px-2.5 py-1.5 text-left text-cinder data-focus:bg-rule-soft" onClick={() => void set("")}>{t("Unassign")}</button>
          </MenuItem>
        )}
      </MenuItems>
    </Menu>
  );
}
