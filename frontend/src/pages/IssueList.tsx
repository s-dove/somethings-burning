import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import { Link } from "../components/common/Link";
import { HeatStrip } from "../components/HeatStrip";
import { Tip } from "../components/Tip";
import type { Issue } from "../shared/api";
import { ago, edgeBg, edgeTip, plural, splitTitle } from "../shared/format";
import { Inbox } from "../ui/icons";

// IssueList is the board's table: one row per issue, with its last 24 hours
// as a heat strip. The whole row links to the issue.
export function IssueList({ issues, showProject, query, noProjects }: { issues: Issue[]; showProject: boolean; query: string; noProjects: boolean }) {
  if (!issues.length) {
    const title = noProjects ? "Connect your first service" : query ? `No errors match “${query}”` : "Nothing is burning";
    const hint = noProjects
      ? "Choose New project in the sidebar to get a DSN for your Sentry SDK."
      : query
        ? "Try a different error message or culprit."
        : "New errors will appear here when your services report them.";
    return (
      <div className="flex flex-col items-center rounded-card border border-dashed border-rule px-6 py-20 text-center">
        <Inbox className="mb-5 text-cinder" size={28} aria-hidden="true" />
        <h2>{title}</h2>
        <p className="mt-2 max-w-[46ch] text-[13px] text-cinder">{hint}</p>
      </div>
    );
  }
  const grid =
    "grid grid-cols-[minmax(0,1fr)_160px_70px_80px] items-center gap-5 max-xl:grid-cols-[minmax(0,1fr)_100px_60px] max-md:grid-cols-[minmax(0,1fr)] max-md:gap-3";

  return (
    <div className="isolate overflow-hidden rounded-card border border-rule bg-ash">
      <div className={`${grid} border-b border-rule bg-smoke/60 px-5 py-3 text-xs text-cinder max-md:hidden`}>
        <span aria-hidden="true">Issue</span>
        <span aria-hidden="true">Activity</span>
        <span className="text-right" aria-hidden="true">
          Events
        </span>
        <span className="text-right max-xl:hidden" aria-hidden="true">
          Last seen
        </span>
      </div>
      {issues.map((i) => {
        const [type, msg] = splitTitle(i.title);
        return (
          <article
            key={i.id}
            className={`${grid} relative border-b border-rule-soft px-5 py-5 last:border-b-0 hover:bg-smoke/60 has-[[data-row]:focus-visible]:outline-2 has-[[data-row]:focus-visible]:-outline-offset-2 has-[[data-row]:focus-visible]:outline-soot`}
          >
            <Root disableHoverableContent>
              <Trigger asChild>
                <span className="absolute inset-y-0 left-0 z-10 w-3">
                  <span className={`absolute top-5 bottom-5 left-0 w-[3px] rounded-r ${edgeBg(i)}`} />
                </span>
              </Trigger>
              <Portal>
                <Content side="right" sideOffset={6} className="z-50 max-w-56 rounded-control bg-soot px-2 py-1 text-[11px] leading-snug text-ash">
                  {edgeTip(i)}
                </Content>
              </Portal>
            </Root>
            <div className="min-w-0">
              <div className="mb-1.5 flex min-w-0 items-center gap-2">
                <Tip content={type || msg} truncated>
                  <Link
                    data-row
                    className="min-w-0 truncate text-sm font-semibold no-underline after:absolute after:inset-0 focus-visible:outline-none"
                    to={`/p/${i.projectId}/issues/${i.id}`}
                  >
                    {type || msg}
                  </Link>
                </Tip>
              </div>
              {type && <p className="mb-2 truncate text-[13px] text-cinder">{msg}</p>}
              <div className="flex min-w-0 items-center gap-x-3 text-xs text-cinder">
                {showProject && (
                  <Link
                    className="relative z-10 shrink-0 rounded border border-rule px-1.5 py-0.5 text-[11px] no-underline hover:border-cinder"
                    to={`/p/${i.projectId}`}
                  >
                    {i.projectName}
                  </Link>
                )}
                {i.culprit && <span className="mono min-w-0 truncate text-[11px]">{i.culprit}</span>}
              </div>
              <p className="mt-1.5 text-[11px] text-cinder md:hidden">
                {plural(i.eventCount, "event")}, last seen {ago(i.lastSeen)}
              </p>
            </div>
            <div className="relative z-10 max-md:hidden">
              <HeatStrip hours={i.hours} size="sm" />
            </div>
            <div className="text-right max-md:hidden">
              <span className="mono font-semibold tabular-nums">{i.eventCount.toLocaleString()}</span>
            </div>
            <div className="text-right text-xs text-cinder tabular-nums max-xl:hidden">{ago(i.lastSeen)}</div>
          </article>
        );
      })}
    </div>
  );
}
