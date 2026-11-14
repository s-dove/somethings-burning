import { useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { Select, type SelectOption } from "../components/common/Select";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { ProjectPulseLine } from "../components/ProjectPulse";
import { useApi, type Board } from "../shared/api";
import { dayColor, plural } from "../shared/format";
import { input } from "../shared/ui";
import { Activity, Search } from "../ui/icons";
import { IssueList } from "./IssueList";

const SORT_OPTIONS: SelectOption<string>[] = [
  { value: "hot", label: "Hottest (24h)", hint: "Most events lately, recent hours count more." },
  { value: "latest", label: "Latest", hint: "Most recently seen first." },
  { value: "count", label: "Most events", hint: "All-time event count." },
];

// BoardPage is the issue inbox: every project's issues, or one project's.
export function BoardPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const sort = params.get("sort") || "hot";
  const q = params.get("q") ?? "";
  const query = new URLSearchParams({ sort, q, ...(id ? { project: id } : {}) });
  const { data, error, reload } = useApi<Board>(`/board?${query}`, 30_000);
  const [search, setSearch] = useState(q);
  useEffect(() => {
    setSearch(q);
  }, [q]);
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams({ sort, q, ...changes });
    if (!next.get("q")) next.delete("q");
    setParams(next);
  };
  const current = data?.project ?? null;
  return (
    <Layout project={current} nav="issues">
      {error && (
        <div role="alert" className="mb-5 rounded-control bg-ember-soft p-4 text-ember-ink">
          {error}{" "}
          <button className="ml-2 cursor-pointer underline" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!data && !error && <Loading />}
      {data && (
        <>
          <PageHeader
            title={current ? current.name : "All issues"}
            titleText={current ? current.name : "All issues"}
            pinnedGap={[28, 12]}
            actions={
              <div className="flex items-center gap-2 py-2 text-xs text-cinder max-sm:hidden">
                <Activity aria-hidden="true" />
                Refreshes every 30 seconds
              </div>
            }
            after={
              <>
                {data.project ? (
                  <ProjectPulseLine project={data.project} />
                ) : (
                  <p className="mt-2 text-[13px] text-cinder">Your error inbox across {plural(data.projects.length, "project")}.</p>
                )}
                <div className="mt-8 grid border-y border-rule max-sm:divide-y max-sm:divide-rule sm:grid-cols-2 sm:divide-x sm:divide-rule">
                  <Stat
                    value={data.counts.open}
                    label="issues"
                    detail={
                      <>
                        <span className={`size-2 rounded-full ${data.burning ? "bg-heat-4" : "bg-rule"}`} />
                        {plural(data.burning, "issue")} with events in the last hour
                      </>
                    }
                  />
                  <Stat
                    value={data.events.day}
                    label="events in the last 24 hours"
                    detail={
                      <>
                        <span
                          className={`size-2 rounded-full ${data.events.hour ? "" : "bg-rule"}`}
                          style={data.events.hour ? { backgroundColor: dayColor(data.events.hour) } : undefined}
                        />
                        {plural(data.events.hour, "event")} this hour
                      </>
                    }
                  />
                </div>
              </>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
              <form
                role="search"
                className="relative w-full sm:w-[320px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ q: search });
                }}
              >
                <label className="sr-only" htmlFor="q">
                  Search issues
                </label>
                <Search aria-hidden="true" className="pointer-events-none absolute top-3 left-3 text-cinder" />
                <input
                  id="q"
                  className={`${input} w-full pl-9`}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search errors or culprits…"
                />
              </form>
              <div className="flex items-center gap-2 text-xs text-cinder">
                <span aria-hidden="true">Sort by</span>
                <Select label="Sort by" hideLabel size="sm" className="w-40" value={sort} options={SORT_OPTIONS} onChange={(v) => update({ sort: v })} />
              </div>
            </div>
          </PageHeader>
          <IssueList issues={data.issues} showProject={!current} query={q} noProjects={!data.projects.length} />
          {data.issues.length > 0 && (
            <div className="mt-4 flex justify-between gap-3 text-xs text-cinder">
              <span>{plural(data.issues.length, "issue")} shown</span>
              <span>Activity shows the last 24 hours</span>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function Stat({ value, label, detail }: { value: number; label: string; detail: ReactNode }) {
  return (
    <div className="py-5 sm:px-7 sm:first:pl-0">
      <div className="flex items-baseline gap-2.5">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</span>
        <span className="text-[13px] text-cinder">{label}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-cinder">{detail}</div>
    </div>
  );
}
