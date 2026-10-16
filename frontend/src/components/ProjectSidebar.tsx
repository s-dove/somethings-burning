import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import { useState, type ReactNode } from "react";
import type { Board, ProjectRef, Session } from "../shared/api";
import { dayColor, eventsTip } from "../shared/format";
import { LayoutGrid, Menu, X } from "../ui/icons";
import { Link } from "./common/Link";
import { Logo } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";
import { Tip } from "./Tip";

// ProjectSidebar switches between projects. Each project's square is colored
// by its events in the last 24 hours; the number is its issues.
export function ProjectSidebar({ board, project, session, profile, create }: {
  board: Board | null;
  project?: ProjectRef | null;
  session: Session | null;
  profile?: boolean;
  create: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const row =
    "flex min-w-0 items-center rounded-control text-cinder no-underline hover:bg-rule-soft aria-[current=page]:bg-rule-soft aria-[current=page]:font-semibold aria-[current=page]:text-soot";
  const item = `${row} gap-3 px-3 py-2.5`;
  return (
    <aside className="flex flex-col border-r border-rule bg-smoke p-4 lg:sticky lg:top-0 lg:h-dvh lg:overflow-hidden">
      {/* On wide screens the brand row is as tall as the page header (h-16), so
          their bottom borders meet in one line. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-2 lg:-mx-4 lg:-mt-4 lg:mb-5 lg:h-16 lg:border-b lg:border-rule lg:px-5">
        <Link to="/" aria-label="Burning home" className="min-w-0 rounded-control no-underline">
          <Logo />
        </Link>
        <button
          className="shrink-0 cursor-pointer rounded-control p-3 hover:bg-rule-soft lg:hidden"
          aria-label={expanded ? "Close navigation" : "Open navigation"}
          aria-expanded={expanded}
          aria-controls="project-navigation"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <X /> : <Menu />}
        </button>
      </div>
      <nav
        id="project-navigation"
        aria-label="Projects"
        className={`flex min-h-0 min-w-0 flex-1 flex-col max-lg:pt-4 ${expanded ? "" : "max-lg:hidden"}`}
      >
        <Link to="/" className={`${item} shrink-0`} aria-current={!project && !profile ? "page" : undefined}>
          <LayoutGrid aria-hidden="true" />
          <span className="flex-1">All issues</span>
          {board && <span className="text-xs tabular-nums">{board.openTotal}</span>}
        </Link>
        <div className="mt-7 mb-2 shrink-0 px-3 text-xs text-cinder">Projects</div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto max-lg:flex-row max-lg:overflow-x-auto max-lg:overflow-y-visible">
          {board?.projects.map((p) => (
            <Link
              key={p.id}
              to={`/p/${p.id}`}
              className={`${row} shrink-0 items-stretch`}
              aria-current={project?.id === p.id ? "page" : undefined}
            >
              <Root>
                <Trigger asChild>
                  <span className="flex shrink-0 items-center px-3">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: dayColor(p.unresolvedDay) }} />
                  </span>
                </Trigger>
                <Portal>
                  <Content side="right" sideOffset={8} className="z-50 rounded-control bg-soot px-2 py-1 text-[11px] leading-snug text-ash">
                    {eventsTip(p.unresolvedDay)}
                  </Content>
                </Portal>
              </Root>
              <Tip content={p.name} side="right" truncated>
                <span className="min-w-0 flex-1 truncate py-2.5">{p.name}</span>
              </Tip>
              <span className="flex items-center px-3 text-xs tabular-nums">{p.openCount}</span>
            </Link>
          ))}
        </div>
        <div className="mt-3 mb-3 shrink-0">{create}</div>
      </nav>
      {/* The divider sits on this wrapper, so each row's hover box only
          covers the row. The avatar is centered on the icon column. */}
      <div className={`mt-auto flex shrink-0 items-center gap-1 border-t border-rule pt-3 ${expanded ? "" : "max-lg:hidden"}`}>
        {session?.user ? (
          <Link
            to="/profile"
            className={`${row} min-w-0 flex-1 gap-1.5 py-1.5 pr-3 pl-1.5`}
            aria-current={profile ? "page" : undefined}
            aria-label={`Profile: ${session.user.displayName || session.user.email}`}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-rule bg-ash text-xs font-semibold text-soot">
              {(session.user.displayName || session.user.email).slice(0, 1).toUpperCase()}
            </span>
            <Tip content={session.user.email} side="right">
              <span className="min-w-0 flex-1 truncate text-xs">{session.user.displayName || session.user.email}</span>
            </Tip>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        <ThemeSwitch />
      </div>
    </aside>
  );
}
