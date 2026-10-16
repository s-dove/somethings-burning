import { useParams, useSearchParams } from "react-router";
import { Link } from "../components/common/Link";
import { HeatStrip } from "../components/HeatStrip";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { Tag } from "../components/Tag";
import { Tip, TimeTip } from "../components/Tip";
import { useApi, type IssueDetail } from "../shared/api";
import { ago } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";
import { Comments } from "./Comments";
import { EventList } from "./EventList";
import { EventPanels, RawJson } from "./EventPanels";
import { IssueHeader, IssueSummary } from "./IssueHeader";

const historyDot: Record<string, string> = {
  created: "before:bg-heat-3",
  reopened: "before:bg-heat-5",
  resolved: "before:bg-doused",
  fired: "before:bg-heat-4",
  unmuted: "before:bg-heat-4",
  muted: "before:bg-rule",
  notified: "before:bg-cinder",
};

// History lines Burning writes on its own, with no one behind them.
const SYSTEM_KINDS = new Set(["created", "fired", "unmuted", "notified"]);

// IssuePage is one issue: its summary and heat, one stored event in full
// (the latest, or ?event=<id>), and on the side its releases and events.
export function IssuePage() {
  const { id, issueId } = useParams();
  const [params] = useSearchParams();
  const eventId = params.get("event");
  const path = `/projects/${id}/issues/${issueId}${eventId ? `?event=${eventId}` : ""}`;
  const { data, error, reload } = useApi<IssueDetail>(path, 30_000);

  if (!data) {
    return (
      <Layout nav="issues">
        {error ? (
          <div className="px-6 py-14 text-center text-cinder">
            <strong className="mb-1 block text-base text-soot">{error}</strong>
            <Link to="/">Back to all projects</Link>
          </div>
        ) : (
          <Loading />
        )}
      </Layout>
    );
  }
  const { issue, project } = data;

  return (
    <Layout project={project} nav="issues">
      <IssueHeader detail={data} onChange={reload} />
      {error && (
        <p role="alert" className="-mt-3 mb-6 text-ember-ink">
          {error}
        </p>
      )}
      <IssueSummary issue={issue} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="lg:hidden">
            <IssueHeat issue={issue} />
          </div>
          {data.event ? (
            <EventPanels event={data.event} />
          ) : (
            <div className="px-6 py-14 text-center text-cinder">
              <strong className="mb-1 block text-base text-soot">No stored payloads</strong>
              The counts above are kept.
            </div>
          )}
          <Comments key={issue.id} projectId={project.id} issueId={issue.id} comments={data.comments} />
        </div>

        <aside className="min-w-0">
          <div className="max-lg:hidden">
            <IssueHeat issue={issue} />
          </div>

          {data.releases.length > 0 && (
            <section className={section}>
              <h2 className={sectionTitle}>
                Releases <span className="text-xs font-normal text-cinder">events per release and env</span>
              </h2>
              <ReleaseTable releases={data.releases} />
            </section>
          )}

          <section className={section}>
            <h2 className={sectionTitle}>
              History <span className="text-xs font-normal text-cinder">changes to this issue, newest first</span>
            </h2>
            <ol className="m-0 list-none p-0">
              {data.activity.map((a, i) => (
                <li
                  key={i}
                  className={`relative pb-3.5 pl-3.5 before:absolute before:top-[7px] before:left-0 before:size-[7px] before:rounded-full before:content-[''] after:absolute after:top-[18px] after:bottom-0.5 after:left-[3px] after:w-px after:bg-rule after:content-[''] last:after:hidden ${historyDot[a.kind] ?? "before:bg-rule"}`}
                >
                  {a.text}
                  {(a.release || a.environment) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.release && <Tag name="release" value={a.release} mono />}
                      {a.environment && <Tag name="env" value={a.environment} />}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-cinder">
                    <TimeTip at={a.at}>
                      <span>{ago(a.at)}</span>
                    </TimeTip>
                    {a.actor ? (
                      <>
                        {" "}
                        · by{" "}
                        <Tip content={a.actor}>
                          <span className="text-soot">{a.actorName || a.actor}</span>
                        </Tip>
                      </>
                    ) : (
                      SYSTEM_KINDS.has(a.kind) && <> · automatic</>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {data.event && <RawJson event={data.event} />}
          <EventList key={issue.id} detail={data} />
        </aside>
      </div>
    </Layout>
  );
}

function IssueHeat({ issue }: { issue: IssueDetail["issue"] }) {
  return (
    <div className="mb-6 rounded-card border border-rule bg-smoke/50 p-4">
      <HeatStrip hours={issue.hours} size="lg" />
      <div className="mt-1 flex justify-between text-xs text-cinder" aria-hidden="true">
        <span>24 hours ago</span>
        <span>Now</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 justify-start gap-x-[22px] gap-y-1">
        <dt className="text-xs text-cinder">Events</dt>
        <dt className="text-xs text-cinder">First seen</dt>
        <dt className="text-xs text-cinder">Last seen</dt>
        <dd className="m-0 font-semibold tabular-nums">{issue.eventCount}</dd>
        <dd className="m-0 font-semibold tabular-nums">
          <TimeTip at={issue.firstSeen}>
            <span>{ago(issue.firstSeen)}</span>
          </TimeTip>
        </dd>
        <dd className="m-0 font-semibold tabular-nums">
          <TimeTip at={issue.lastSeen}>
            <span>{ago(issue.lastSeen)}</span>
          </TimeTip>
        </dd>
      </dl>
    </div>
  );
}

type ReleaseRow = IssueDetail["releases"][number];

// ReleaseTable gives each release its own full-width line (names can be
// long), with the release's total on the right and one indented line per
// environment under it.
function ReleaseTable({ releases }: { releases: ReleaseRow[] }) {
  const groups = new Map<string, ReleaseRow[]>();
  for (const r of releases) groups.set(r.release, [...(groups.get(r.release) ?? []), r]);
  return (
    <ul className="m-0 list-none p-0 text-[13px]">
      {[...groups].map(([release, rows], n) => (
        <li key={release} className={`py-2 ${n ? "border-t border-rule-soft" : ""}`}>
          <div className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1">
              <Tag name="release" value={release || "none"} mono />
            </span>
            <Tip content="Events in this release">
              <span className="shrink-0 font-semibold tabular-nums">{rows.reduce((t, r) => t + r.eventCount, 0)}</span>
            </Tip>
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 border-l border-rule py-0 pr-0 pl-[18px] text-xs">
            {rows.map((r) => (
              <li key={r.environment} className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1">
                  <Tag name="env" value={r.environment || "none"} />
                </span>
                <span className="shrink-0 text-cinder tabular-nums">{r.eventCount}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
