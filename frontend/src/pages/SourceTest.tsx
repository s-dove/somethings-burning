import { Link } from "../components/common/Link";
import { Check, CircleAlert, ExternalLink, Minus } from "../ui/icons";
import type { SourceConfig, SourcesTest } from "../shared/api";
import { t } from "../shared/i18n";

// SourceTestResult shows how the sources handle the project's latest event:
// the commit each one resolves to, and where each in-app frame lands.
export function SourceTestResult({ test, sources, projectId }: { test: SourcesTest; sources: SourceConfig[]; projectId: number }) {
  if (!test.event) return <p className="rounded-card border border-dashed border-rule px-4 py-6 text-center text-[13px] text-cinder">{t("No stored event yet. Report one, then test again.")}</p>;
  return (
    <div className="rounded-card border border-rule bg-ash">
      <div className="border-b border-rule px-4 py-3 text-xs text-cinder">
        Latest event <Link to={`/issues/${test.event.issueId}`} className="mono">{test.event.eventId.slice(0, 12)}</Link>, release <span className="mono text-soot">{test.event.release || "none"}</span>
      </div>
      <ul className="m-0 list-none divide-y divide-rule-soft p-0">
        {test.sources.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
            <span className="mono min-w-0 truncate font-semibold">{sources[i]?.repo}</span>
            {r.sha
              ? <span className={r.how === "default branch" ? "text-ember-ink" : "text-doused"}><span className="mono">{r.sha.slice(0, 10)}</span> from {r.how}{r.how !== "default branch" && <> <span className="mono">{r.ref}</span></>}</span>
              : <span className="text-ember-ink">{r.error || "nothing resolved"}</span>}
          </li>
        ))}
      </ul>
      <div className="border-t border-rule px-4 pt-3 pb-1 text-xs font-semibold">{t("In-app frames, innermost first")}</div>
      <ul className="m-0 list-none p-0 pb-2">
        {test.frames.map((f, i) => (
          <li key={i} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 px-4 py-1.5 text-xs">
            {f.found ? <Check size={14} className="mt-px text-doused" aria-label="read" /> : f.source === null ? <Minus size={14} className="mt-px text-cinder" aria-label={t("no source")} /> : <CircleAlert size={14} className="mt-px text-ember-ink" aria-label={t("not read")} />}
            <span className="min-w-0">
              <span className="mono block truncate">{f.location}{f.line > 0 && `:${f.line}`}</span>
              <span className="block truncate text-cinder">
                {f.source === null ? "No mapping covers this path" : <>
                  <span className="mono">{sources[f.source]?.repo}/{f.path}</span>
                  {f.found === false && <span className="text-ember-ink"> not found at that commit</span>}
                  {f.link && <Link to={f.link} className="ml-2 inline-flex items-center gap-1">{t("open")}<ExternalLink size={11} aria-hidden="true" /></Link>}
                </>}
              </span>
            </span>
          </li>
        ))}
        {test.frames.length === 0 && <li className="px-4 py-2 text-xs text-cinder">{t("The event has no in-app frames.")}</li>}
      </ul>
    </div>
  );
}
