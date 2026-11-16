import { useParams } from "react-router";
import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Tag } from "../components/Tag";
import { Tip, TimeTip } from "../components/Tip";
import { useApi, type ProjectRef, type ReleaseSummary } from "../shared/api";
import { ago, plural } from "../shared/format";
import { Rocket } from "../ui/icons";
import { t } from "../shared/i18n";

/** A project's releases, newest first: what each brought, and where it was deployed. */
export function ReleasesPage() {
  const { id } = useParams();
  const { data, error } = useApi<{ project: ProjectRef; releases: ReleaseSummary[] }>(`/projects/${id}/releases`, 30_000);
  const project = data?.project ?? null;
  return (
    <Layout project={project} nav="issues">
      {error && <p role="alert" className="text-ember-ink">{error}</p>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <PageHeader
            title={t("Releases")}
            after={<p className="mt-2 text-[13px] text-cinder">Each release the SDKs reported, or CI created, newest first. Open one to see its issues.</p>}
            spaceBelow="mb-6"
          />
          {data.releases.length === 0 ? (
            <div className="rounded-card border border-dashed border-rule px-6 py-16 text-center text-[13px] text-cinder">
              No releases yet. Set the SDK's <span className="mono">{t("release")}</span>, or create releases from CI with an API token.
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-rule bg-ash">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_80px_80px_100px] gap-4 border-b border-rule bg-smoke/60 px-5 py-3 text-xs text-cinder max-md:hidden">
                <span>{t("Release")}</span>
                <span className="text-right">{t("New issues")}</span>
                <span className="text-right">{t("Fired again")}</span>
                <span className="text-right">{t("Issues")}</span>
                <span className="text-right">{t("Events")}</span>
              </div>
              {data.releases.map((r) => (
                <article key={r.version} className="grid grid-cols-[minmax(0,1fr)_90px_80px_80px_100px] items-center gap-4 border-b border-rule-soft px-5 py-4 last:border-b-0 max-md:grid-cols-1">
                  <div className="min-w-0">
                    <Link to={`/p/${id}?status=all&release=${encodeURIComponent(r.version)}`} className="mono text-sm font-semibold">{r.version}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-cinder">
                      <TimeTip at={r.firstSeen}><span>first seen {ago(r.firstSeen)}</span></TimeTip>
                      {r.commit && <Tip content={r.commit}><span className="mono">commit {r.commit.slice(0, 7)}</span></Tip>}
                      {r.deploys.map((d, i) => (
                        <Tip key={i} content={<>Deployed {ago(d.at)}{d.url ? <><br />{d.url}</> : null}</>}>
                          <span className="inline-flex items-center gap-1"><Rocket size={11} aria-hidden="true" /><Tag name="deploy" value={d.environment || "deployed"} /></span>
                        </Tip>
                      ))}
                    </div>
                  </div>
                  <Num n={r.newIssues} hot label="new issues" />
                  <Num n={r.regressions} hot label="fired again" />
                  <Num n={r.issues} label="issues" />
                  <Num n={r.events} label="events" />
                </article>
              ))}
            </div>
          )}
          {data.releases.length > 0 && <p className="mt-4 text-xs text-cinder">{plural(data.releases.length, "release")}</p>}
        </>
      )}
    </Layout>
  );
}

function Num({ n, hot, label }: { n: number; hot?: boolean; label: string }) {
  return (
    <div className="text-right max-md:text-left">
      <span className={`mono font-semibold tabular-nums ${hot && n > 0 ? "text-ember-ink" : n === 0 ? "text-cinder" : ""}`}>{n.toLocaleString()}</span>
      <span className="ml-1 text-xs text-cinder md:hidden">{label}</span>
    </div>
  );
}
