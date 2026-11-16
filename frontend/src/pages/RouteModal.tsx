import { useEffect, useState } from "react";
import { confirmDialog } from "../components/Confirm";
import { Sheet } from "../components/Sheet";
import { Button } from "../ui/components/Button";
import { Trash2 } from "../ui/icons";
import type { MatchOp, Receiver, ReceiverKind, Route } from "../shared/api";
import { RouteEditor } from "./RouteEditor";
import { routeProblems } from "./routeProblems";
import { t } from "../shared/i18n";

// RouteModal edits one route on a copy. Done saves the whole table with it
// and closes; if the server rejects it, the reason shows here and nothing
// closes. Delete saves at once too. Cancel, Escape, or Back drop the copy.
// Order is changed by dragging in the list, not here.
export function RouteModal({ route, index, fields, ops, kinds, readOnly, onDone, onClose, onDelete, onTest, project, unavailable }: {
  route: Route | null; // null: closed
  index: number; // -1 for a new route
  fields: string[]; ops: MatchOp[]; kinds: ReceiverKind[]; readOnly: boolean;
  onDone: (r: Route) => Promise<string | null>; // an error, or null once saved
  onClose: () => void;
  onDelete: () => Promise<string | null>;
  onTest?: (x: Receiver) => void;
  project?: number;
  unavailable?: ReceiverKind[];
}) {
  const [draft, setDraft] = useState<Route | null>(route);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // After the first Done, problems are checked as the route changes, so each
  // line clears as soon as it is fixed.
  const [checked, setChecked] = useState(false);
  useEffect(() => { setDraft(route); setProblem(""); setChecked(false); }, [route]);
  const problems = checked && draft ? routeProblems(draft) : new Map<string, string>();
  const isNew = index < 0;
  const title = isNew ? "New route" : `Route ${index + 1}${route?.name ? `: ${route.name}` : ""}`;
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setProblem("");
    // The server numbers routes in the whole table; here only this one is open.
    const err = await fn().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    setBusy(false);
    if (err) setProblem(err.replace(/^route \d+: /, ""));
  };
  return (
    <Sheet open={!!route} onClose={onClose} title={title} back="Back to routes"
      actions={readOnly ? <Button size="sm" onClick={onClose}>{t("Close")}</Button> : <>
        {!isNew && <Button size="sm" variant="ghost" className="hover:text-ember-ink" icon={<Trash2 aria-hidden="true" />} disabled={busy}
          onClick={() => { void confirmDialog({ title: t("Delete this route?"), confirm: t("Delete"), danger: true }).then((ok) => { if (ok) void run(onDelete); }); }}>{t("Delete")}</Button>}
        <Button size="sm" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
        <Button size="sm" variant="primary" disabled={!draft || busy} onClick={() => {
          if (!draft) return;
          setChecked(true);
          const found = routeProblems(draft);
          if (found.size) return;
          void run(() => onDone(draft));
        }}>{busy ? "Saving…" : isNew ? "Add route" : "Done"}</Button>
      </>}>
      {(problems.size > 0 || problem) && <p role="alert" className="mb-5 rounded-card border border-ember-ink/30 bg-ember-soft px-4 py-3 text-[13px] text-ember-ink">{problems.size === 1 ? "Fix the item marked below." : problems.size > 1 ? `Fix the ${problems.size} items marked below.` : problem}</p>}
      {draft && <RouteEditor route={draft} fields={fields} ops={ops} kinds={kinds} readOnly={readOnly} problems={problems} project={project} unavailable={unavailable}
        onChange={d => { setDraft(d); setProblem(""); }} onTest={onTest} />}
    </Sheet>
  );
}
