import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, useApi, type Board, type ProjectRef, type Session } from "../shared/api";
import { t } from "../shared/i18n";
import { input } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { ChevronRight, Plus } from "../ui/icons";
import { Link } from "./common/Link";
import { LangGate } from "./LangSwitch";
import { ProjectSidebar } from "./ProjectSidebar";

interface Props {
  project?: ProjectRef | null;
  nav?: "issues" | "settings" | "login" | "profile" | "site";
  children: ReactNode;
}

// Layout is every page's frame: the project sidebar on the left, and a
// header with where you are and the project's tabs above the page.
export function Layout({ project: given, nav, children }: Props) {
  const { data: session } = useApi<Session>(nav !== "login" ? "/session" : null, 60_000);
  const { data: board, reload } = useApi<Board>(nav !== "login" ? "/board?sort=hot&q=" : null, 30_000);
  // While a page is still loading it has no project yet. Take it from the
  // URL, so the sidebar does not flash "All issues" as the current page.
  const { id } = useParams();
  const urlId = Number(id) || 0;
  const project = given ?? (urlId ? (board?.projects.find((p) => p.id === urlId) ?? { id: urlId, name: "" }) : null);
  if (nav === "login") return <main className="min-h-dvh">{children}</main>;
  const tab =
    "flex h-14 items-center lg:h-16 border-b-2 border-transparent text-[13px] text-cinder no-underline hover:text-soot aria-[current=page]:border-soot aria-[current=page]:font-semibold aria-[current=page]:text-soot";
  return (
    <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[232px_minmax(0,1fr)] lg:overflow-hidden">
      <ProjectSidebar board={board} project={project} session={session} profile={nav === "profile"} create={<NewProject onCreate={reload} />} />
      <LangGate />
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 border-b border-rule bg-ash/75 px-6 backdrop-blur-md backdrop-saturate-150 lg:h-16 lg:px-9">
          <Link to="/" className="text-[13px] text-cinder no-underline">
            {t("Projects")}
          </Link>
          <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
          <span className="min-w-0 truncate text-[13px] font-medium">{nav === "profile" ? t("Profile") : project ? project.name : t("All issues")}</span>
          {/* A project has Issues and its Settings; All issues has Issues and
              the global Settings, in the same place. */}
          {nav !== "profile" && (
            <nav className="ml-auto flex gap-6" aria-label={project ? t("Project") : t("All projects")}>
              <Link className={tab} to={project ? `/p/${project.id}` : "/"} aria-current={nav === "issues" ? "page" : undefined}>
                {t("Issues")}
              </Link>
              <Link className={tab} to={project ? `/p/${project.id}/settings` : "/settings"} aria-current={nav === "settings" || nav === "site" ? "page" : undefined}>
                {t("Settings")}
              </Link>
            </nav>
          )}
        </header>
        <div className="min-h-0 flex-1 [overflow-anchor:none] lg:overflow-y-auto">
          <main className={`mx-auto px-5 py-7 sm:px-6 lg:px-9 lg:py-9 ${nav === "settings" || nav === "profile" || nav === "site" ? "max-w-[1100px]" : "max-w-[1500px]"}`}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function NewProject({ onCreate }: { onCreate: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <Popover>
      {({ close }) => (
        <>
          <PopoverButton className="flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-[13px] text-cinder hover:bg-rule-soft hover:text-soot">
            <Plus aria-hidden="true" />
            {t("New project")}
          </PopoverButton>
          <PopoverPanel
            anchor="bottom start"
            className="z-40 w-[300px] max-w-[calc(100vw-32px)] rounded-card border border-rule bg-ash p-5 shadow-lg [--anchor-gap:8px]"
          >
            <h2 className="mb-1">{t("New project")}</h2>
            <p className="mb-4 text-xs text-cinder">{t("Connect a service to start collecting errors.")}</p>
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                setError("");
                setBusy(true);
                try {
                  const { project } = await api<{ project: { id: number } }>("/projects", {
                    method: "POST",
                    body: { name: form.get("name") },
                  });
                  onCreate();
                  close();
                  navigate(`/p/${project.id}/settings/dsn`);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="grid gap-2 text-xs font-medium">
                {t("Project name")}
                <input className={input} autoFocus name="name" placeholder={t("e.g. billing-api")} required maxLength={80} />
              </label>
              {error && (
                <p role="alert" className="text-xs text-ember-ink">
                  {error}
                </p>
              )}
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? t("Creating…") : t("Create project")}
              </Button>
            </form>
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
