import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { TimeTip } from "../components/Tip";
import { api, canTriage, type IssueDetail } from "../shared/api";
import { ago, plural } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";
import { Split } from "../ui/icons";

/** Issues merged into this one. A member can split one back out. */
export function MergedCard({ detail, onChange }: { detail: IssueDetail; onChange: () => void }) {
  const { merged, project, issue } = detail;
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  if (!merged?.length) return null;
  const split = async (fingerprint: string, title: string) => {
    if (!confirm(`Split "${title}" back out?\n\nIt becomes its own issue again, and its stored events go with it.`)) return;
    setBusy(fingerprint);
    try {
      const { issue: id } = await api<{ issue: number }>(`/projects/${project.id}/issues/${issue.id}/unmerge`, { method: "POST", body: { fingerprint } });
      toast("Split into its own issue", { action: { label: "Open", onClick: () => navigate(`/issues/${id}`) } });
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className={section}>
      <h2 className={sectionTitle}>
        Merged <span className="text-xs font-normal text-cinder">issues folded into this one</span>
      </h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {merged.map((m) => (
          <li key={m.fingerprint} className="text-[13px]">
            <div className="truncate font-medium">{m.title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-cinder">
              <TimeTip at={m.mergedAt}><span>merged {ago(m.mergedAt)}</span></TimeTip>
              <span>· {plural(m.events, "stored event")}</span>
              {canTriage(project.role) && (
                <button className="ml-auto inline-flex cursor-pointer items-center gap-1 hover:text-soot" disabled={!!busy} onClick={() => void split(m.fingerprint, m.title)}>
                  <Split size={12} aria-hidden="true" />
                  {busy === m.fingerprint ? "Splitting…" : "Split out"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
