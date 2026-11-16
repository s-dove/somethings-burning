import { useState } from "react";
import { Tip } from "../components/Tip";
import { plural } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";
import { UserRound } from "../ui/icons";

type Tag = { key: string; total: number; values: { value: string; count: number }[] };

/** How the issue's events spread over each tag, and how many users it reached. */
export function TagsCard({ tags, users }: { tags: Tag[]; users: number }) {
  const [open, setOpen] = useState(false);
  if (!tags.length && !users) return null;
  // A tag with one value on every event says little: it waits behind "Show more", as do varied tags past the first five.
  const single = (tag: Tag) => tag.values.length === 1 && tag.values[0]!.count === tag.total;
  const varied = tags.filter((tag) => !single(tag));
  const shown = open ? tags : varied.slice(0, 5);
  const hidden = tags.length - shown.length;
  const allSingle = tags.length > 0 && varied.length === 0;
  return (
    <section className={section}>
      <h2 className={sectionTitle}>
        Tags <span className="text-xs font-normal text-cinder">how its events spread</span>
      </h2>
      {users > 0 && (
        <p className="mb-3 flex items-center gap-2 text-[13px]">
          <UserRound className="text-cinder" aria-hidden="true" />
          <span className="font-semibold tabular-nums">{users.toLocaleString()}</span> {users === 1 ? "user affected" : "users affected"}
        </p>
      )}
      {allSingle && !open && <p className="mb-2 text-xs text-cinder">Every tag has a single value across all its events.</p>}
      <div className="grid gap-4">
        {shown.map((tag) => (
          <div key={tag.key}>
            <div className="mono mb-1 text-xs text-cinder">{tag.key}</div>
            <ul className="m-0 grid list-none gap-1 p-0">
              {tag.values.map((v) => {
                const pct = tag.total ? Math.round((v.count / tag.total) * 100) : 0;
                return (
                  <li key={v.value} className="relative overflow-hidden rounded-control bg-smoke px-2 py-0.5 text-xs">
                    <span className="absolute inset-y-0 left-0 bg-heat-2/40" style={{ width: `${pct}%` }} aria-hidden="true" />
                    <span className="relative flex gap-2">
                      <Tip content={v.value} truncated>
                        <span className="mono min-w-0 flex-1 truncate">{v.value}</span>
                      </Tip>
                      <span className="shrink-0 tabular-nums text-cinder">{pct}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {(hidden > 0 || open) && (
        <button type="button" className="mt-3 cursor-pointer text-xs text-cinder underline-offset-2 hover:text-soot hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show less" : moreLabel(hidden, tags.length - varied.length)}
        </button>
      )}
    </section>
  );
}

/** "Show 3 more", "Show 4 tags with one value", or "Show 6 more (4 with one value)". */
function moreLabel(hidden: number, single: number): string {
  if (single === 0) return `Show ${hidden} more`;
  if (single === hidden) return `Show ${plural(single, "tag")} with one value`;
  return `Show ${hidden} more (${single} with one value)`;
}
