import { useState } from "react";
import { Link } from "../components/common/Link";
import { Tag } from "../components/Tag";
import { Button } from "../ui/components/Button";
import { api, type EventPage, type EventRow, type IssueDetail } from "../shared/api";
import { ago } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";
import { TimeTip } from "../components/Tip";

// EventList is the issue's stored events, newest first. The page loads with
// the latest 10; Load more fetches the next 10 older ones.
export function EventList({ detail }: { detail: IssueDetail }) {
  const { project, issue } = detail;
  const [older, setOlder] = useState<EventRow[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The first page refreshes with the issue; older pages stay as loaded.
  const seen = new Set(detail.events.map(e => e.id));
  const events = [...detail.events, ...older.filter(e => !seen.has(e.id))];
  const hasMore = more ?? detail.moreEvents;

  const loadMore = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    setLoading(true);
    setError("");
    try {
      const page = await api<EventPage>(`/projects/${project.id}/issues/${issue.id}/events?before=${last.id}`);
      setOlder(o => [...o, ...page.events]);
      setMore(page.more);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={section}>
      <h2 className={sectionTitle}>
        Events of this issue <span className="text-xs font-normal text-cinder">{events.length} of {detail.storedEvents}</span>
      </h2>
      <p className="-mt-1.5 mb-2 text-xs text-cinder">
        {detail.storedEvents} of {issue.eventCount} events kept. Payloads are sampled during bursts and expire with retention.
      </p>
      <div className="-mx-2 flex flex-col gap-1">
        {events.map(e => (
          <Link
            key={e.id}
            to={`?event=${e.id}`}
            aria-current={e.id === detail.event?.id ? "true" : undefined}
            className="block rounded-control px-2 py-2 no-underline hover:bg-smoke aria-[current=true]:bg-smoke"
          >
            <span className="block truncate"><TimeTip at={e.receivedAt}><span>{ago(e.receivedAt)}</span></TimeTip></span>
            {(e.release || e.environment) && (
              <span className="mt-1 flex flex-wrap gap-1">
                {e.release && <Tag name="release" value={e.release} mono />}
                {e.environment && <Tag name="env" value={e.environment} />}
              </span>
            )}
          </Link>
        ))}
      </div>
      {hasMore && (
        <Button size="sm" className="mt-3 w-full justify-center" disabled={loading} onClick={loadMore}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-ember-ink">{error}</p>}
    </section>
  );
}
