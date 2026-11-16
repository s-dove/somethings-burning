import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { confirmDialog } from "../components/Confirm";
import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Link } from "../components/common/Link";
import { HeatStrip } from "../components/HeatStrip";
import { Redacted } from "../components/Redacted";
import { Tip } from "../components/Tip";
import { Button } from "../ui/components/Button";
import { Check, GitMerge, Inbox, VolumeX, X } from "../ui/icons";
import { api, canTriage, type Board, type Issue } from "../shared/api";
import { ago, edgeBg, edgeTip, muteSummary, plural, sentence, splitTitle } from "../shared/format";
import { pill, pillTone } from "../shared/ui";
import { IssueActions } from "./IssueActions";
import { t } from "../shared/i18n";

const box = "size-4 shrink-0 cursor-pointer rounded border-rule";

// IssueList is the board's table. Rows can be checked (by people who can
// triage them) and resolved or muted together from the bar that appears at
// the bottom. One row's own buttons cover undoing: unresolve and unmute.
export function IssueList({ issues, showProject, status, query, noProjects, muteOptions }: {
  issues: Issue[]; showProject: boolean; status: string; query: string; noProjects: boolean; muteOptions: Board["muteOptions"];
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  if (!issues.length) {
    const title = noProjects ? "Connect your first service" : query ? `No errors match “${query}”` : status === "open" ? "Nothing is burning" : `No ${status === "all" ? "reported" : status} issues`;
    const hint = noProjects ? "Choose New project in the sidebar to get a DSN for your Sentry SDK." : query ? "Try a different error message or culprit." : status === "open" ? "New errors will appear here when your services report them." : status === "muted" ? "Muted issues keep counting events without sending alerts." : "Issues appear here as you report and triage errors.";
    return <div className="flex flex-col items-center rounded-card border border-dashed border-rule px-6 py-20 text-center"><Inbox className="mb-5 text-cinder" size={28} aria-hidden="true" /><h2>{title}</h2><p className="mt-2 max-w-[46ch] text-[13px] text-cinder">{hint}</p></div>;
  }
  const triageable = issues.filter(i => canTriage(i.role));
  // Issues that left the list (resolved by someone else, a refresh) drop out.
  const chosen = triageable.filter(i => picked.has(i.id));
  const all = triageable.length > 0 && chosen.length === triageable.length;
  const toggle = (id: number, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const grid = "grid grid-cols-[16px_minmax(0,1fr)_160px_70px_80px_112px] items-center gap-5 max-xl:grid-cols-[16px_minmax(0,1fr)_100px_60px_112px] max-md:grid-cols-[16px_minmax(0,1fr)_104px] max-md:gap-3";

  return (
    <>
      <div className="isolate overflow-hidden rounded-card border border-rule bg-ash">
        <div className={`${grid} border-b border-rule bg-smoke/60 px-5 py-3 text-xs text-cinder max-md:hidden`}>
          {triageable.length
            ? <input type="checkbox" className={box} aria-label={all ? "Unselect all" : "Select all"} checked={all}
                ref={el => { if (el) el.indeterminate = chosen.length > 0 && !all; }}
                onChange={e => setPicked(e.target.checked ? new Set(triageable.map(i => i.id)) : new Set())} />
            : <span />}
          <span aria-hidden="true">{t("Issue")}</span><span aria-hidden="true">{t("Activity")}</span><span className="text-right" aria-hidden="true">{t("Events")}</span><span className="text-right max-xl:hidden" aria-hidden="true">{t("Last seen")}</span><span className="sr-only">{t("Actions")}</span>
        </div>
        {issues.map(i => {
          const [type, msg] = splitTitle(i.title);
          const can = canTriage(i.role);
          return <article key={i.id} className={`${grid} relative border-b border-rule-soft px-5 py-5 last:border-b-0 hover:bg-smoke/60 has-[[data-row]:focus-visible]:outline-2 has-[[data-row]:focus-visible]:-outline-offset-2 has-[[data-row]:focus-visible]:outline-soot ${picked.has(i.id) ? "bg-smoke/80" : ""}`}>
            <Root disableHoverableContent>
              <Trigger asChild>
                <span className="absolute inset-y-0 left-0 z-10 w-3">
                  <span className={`absolute top-5 bottom-5 left-0 w-[3px] rounded-r ${edgeBg(i)}`} />
                </span>
              </Trigger>
              <Portal>
                <Content side="right" sideOffset={6} className="z-50 max-w-56 rounded-control bg-soot px-2 py-1 text-[11px] leading-snug text-ash">{edgeTip(i)}</Content>
              </Portal>
            </Root>
            {can
              ? <input type="checkbox" className={`${box} relative z-10`} aria-label={`Select ${type || msg}`} checked={picked.has(i.id)} onChange={e => toggle(i.id, e.target.checked)} />
              : <span />}
            <div className="min-w-0">
              <div className="mb-1.5 flex min-w-0 items-center gap-2">
                <Tip content={type || msg} truncated><Link data-row className="min-w-0 truncate text-sm font-semibold no-underline after:absolute after:inset-0 focus-visible:outline-none" to={`/issues/${i.id}`}><Redacted text={type || msg} tip={false} /></Link></Tip>
                {i.status !== "open" && <span className={`${pill} ${pillTone[i.status]} shrink-0`}>{sentence(i.status)}</span>}
                {i.status === "open" && i.reopenReason && <span className={`${pill} ${pillTone.open} shrink-0`}>{t("Firing again")}</span>}
              </div>
              {type && <p className="mb-2 truncate text-[13px] text-cinder"><Redacted text={msg} tip={false} /></p>}
              <div className="flex min-w-0 items-center gap-x-3 text-xs text-cinder">
                {showProject && <Link className="relative z-10 shrink-0 rounded border border-rule px-1.5 py-0.5 text-[11px] no-underline hover:border-cinder" to={`/p/${i.projectId}`}>{i.projectName}</Link>}
                {i.culprit && <span className="mono min-w-0 truncate text-[11px]">{i.culprit}</span>}
                {i.status === "muted" && <span className="min-w-0 truncate">{sentence(muteSummary(i.mute))}</span>}
              </div>
              <p className="mt-1.5 text-[11px] text-cinder md:hidden">{plural(i.eventCount, "event")}, last seen {ago(i.lastSeen)}</p>
            </div>
            <div className="relative z-10 max-md:hidden"><HeatStrip hours={i.hours} size="sm" muted={i.status === "muted"} /></div>
            <div className="text-right max-md:hidden"><span className="mono font-semibold tabular-nums">{i.eventCount.toLocaleString()}</span></div>
            <div className="text-right text-xs text-cinder tabular-nums max-xl:hidden">{ago(i.lastSeen)}</div>
            {can ? <IssueActions issue={i} muteOptions={muteOptions} /> : <div />}
          </article>;
        })}
      </div>
      {chosen.length > 0 && <BulkBar issues={chosen} muteOptions={muteOptions} onDone={() => setPicked(new Set())} />}
    </>
  );
}

// BulkBar acts on the checked issues: resolve them, or mute them for a while.
// It sits at the bottom of the window while anything is checked.
function BulkBar({ issues, muteOptions, onDone }: { issues: Issue[]; muteOptions: Board["muteOptions"]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const { mutate } = useSWRConfig();
  const open = issues.filter(i => i.status !== "resolved");
  const mutable = issues.filter(i => i.status === "open");
  const mergeable = issues.length >= 2 && new Set(issues.map(i => i.projectId)).size === 1;
  async function mergeAll() {
    const keep = [...issues].sort((a, b) => b.eventCount - a.eventCount || a.id - b.id)[0]!;
    const n = issues.length - 1;
    if (!(await confirmDialog({ title: t("Merge {n} into {title}?", { n: n === 1 ? t("1 issue") : t("{n} issues", { n }), title: keep.title }), body: t("Their events, comments, and history move there, and later events of theirs join it. Each can be split back out."), confirm: t("Merge") }))) return;
    setBusy(true);
    try {
      await api(`/projects/${keep.projectId}/issues/merge`, { method: "POST", body: { into: keep.id, issues: issues.map(i => i.id) } });
      toast(`Merged into "${keep.title}"`);
      void mutate((key) => typeof key === "string" && key.startsWith("/board"));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }


  async function run(list: Issue[], path: "resolve" | "mute", body: unknown, done: string) {
    setBusy(true);
    const results = await Promise.allSettled(list.map(i => api(`/projects/${i.projectId}/issues/${i.id}/${path}`, { method: "POST", body })));
    const failed = results.filter(r => r.status === "rejected").length;
    setBusy(false);
    if (failed) toast.error(`${failed} of ${list.length} could not be changed`);
    else toast(`${done} ${plural(list.length, "issue")}`);
    void mutate((key) => typeof key === "string" && key.startsWith("/board"));
    onDone();
  }

  return (
    <div className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-card border border-rule bg-ash/95 px-4 py-3 shadow-lg backdrop-blur" role="region" aria-label={t("Selected issues")}>
      <span className="mr-auto text-[13px] font-medium">{plural(issues.length, "issue")} selected</span>
      <Button size="sm" variant="primary" disabled={busy || open.length === 0} icon={<Check aria-hidden="true" />}
        onClick={() => void run(open, "resolve", {}, "Resolved")}>Resolve{open.length < issues.length ? ` ${open.length}` : ""}</Button>
      <Menu>
        <MenuButton className="ui-button ui-button-secondary ui-button-sm" disabled={busy || mutable.length === 0}>
          <VolumeX aria-hidden="true" />Mute{mutable.length < issues.length ? ` ${mutable.length}` : ""}
        </MenuButton>
        <MenuItems anchor="top end" className="z-40 min-w-36 rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:6px] focus:outline-none">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-cinder">{t("Mute for")}</div>
          {muteOptions.map(o => <MenuItem key={o.value}>
            <button className="block w-full cursor-pointer rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => void run(mutable, "mute", { for: o.value }, "Muted")}>{t(o.label)}</button>
          </MenuItem>)}
        </MenuItems>
      </Menu>
      <Tip content={mergeable ? "Fold them into one issue, the one with the most events" : "Choose two or more issues of one project to merge"}>
        <span className="inline-flex"><Button size="sm" variant="secondary" disabled={busy || !mergeable} icon={<GitMerge aria-hidden="true" />} onClick={() => void mergeAll()}>{t("Merge")}</Button></span>
      </Tip>
      <Button size="sm" variant="ghost" disabled={busy} icon={<X aria-hidden="true" />} onClick={onDone}>{t("Clear")}</Button>
    </div>
  );
}
