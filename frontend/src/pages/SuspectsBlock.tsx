import type { Suspects } from "../shared/api";
import { GitCompare } from "../ui/icons";

const short = (sha: string) => sha.slice(0, 7);

/** The stack's files that changed since the previous release, and the commits. */
export function SuspectsBlock({ suspects: s }: { suspects: Suspects }) {
  return (
    <div className="border-t border-rule-soft bg-ember-soft/40 px-5 py-4">
      <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-xs font-semibold">
        Suspect changes
        <span className="font-normal text-cinder">
          files of this stack that changed from <span className="mono">{s.from.release}</span> to <span className="mono">{s.to.release}</span>
        </span>
      </h3>
      {s.files.length === 0 ? (
        <p className="text-xs text-cinder">None of the stack's files changed between these releases.</p>
      ) : (
        <>
          <ul className="m-0 mb-2 list-none p-0">
            {s.files.map((f) => (
              <li key={f.path} className="mono flex items-center gap-2 py-0.5 text-xs">
                <span className="rounded-control bg-ember-soft px-1.5 text-[11px] text-ember-ink">{f.status}</span>
                {f.path}
              </li>
            ))}
          </ul>
          {s.commits.length > 0 && (
            <ul className="m-0 list-none p-0">
              {s.commits.map((c) => (
                <li key={c.sha} className="flex min-w-0 items-baseline gap-3 py-0.5 text-xs">
                  {c.url ? (
                    <a className="mono shrink-0" href={c.url} target="_blank" rel="noreferrer">{short(c.sha)}</a>
                  ) : (
                    <span className="mono shrink-0">{short(c.sha)}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.message}</span>
                  <span className="shrink-0 text-cinder">{c.author}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-cinder">
        <span className="mono">{s.repo}</span>
        <span className="mono">{short(s.from.sha)}…{short(s.to.sha)}</span>
        {s.compareUrl && (
          <a href={s.compareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
            <GitCompare size={11} aria-hidden="true" />
            Compare
          </a>
        )}
      </p>
    </div>
  );
}

