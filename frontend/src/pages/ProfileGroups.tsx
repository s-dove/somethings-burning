import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useState } from "react";
import { input } from "../shared/ui";
import { t } from "../shared/i18n";
import { Search, X } from "../ui/icons";

const SHOWN = 20;
const chip = "mono inline-flex max-w-full items-center rounded-full border border-rule bg-smoke px-2.5 py-0.5 text-xs leading-5 wrap-anywhere";

/** Groups from the sign-in claim. Past 20, the rest open in a dialog with a filter. */
export function ProfileGroups({ groups: claimed }: { groups: string[] }) {
  const groups = [...new Set(claimed)];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (groups.length === 0) return <span className="text-cinder">{t("No groups in the claim.")}</span>;
  const rest = groups.length - SHOWN;
  const found = groups.filter((g) => g.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {groups.slice(0, SHOWN).map((g) => (
          <li key={g} className={chip}>{g}</li>
        ))}
        {rest > 0 && (
          <li>
            <button type="button" className="inline-flex cursor-pointer items-center rounded-full border border-dashed border-cinder px-2.5 py-0.5 text-xs leading-5 text-cinder hover:border-soot hover:text-soot" onClick={() => setOpen(true)}>
              {t("+{n} more", { n: rest })}
            </button>
          </li>
        )}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-soot/40 backdrop-blur-[2px] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150" />
        <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-8">
          <DialogPanel transition className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-card border border-rule bg-ash shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150">
            <div className="flex shrink-0 items-start gap-3 border-b border-rule px-5 py-4">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold">{t("Groups")}</DialogTitle>
                <p className="text-xs text-cinder">{t("{n} from the groups claim at sign-in.", { n: groups.length })}</p>
              </div>
              <button type="button" aria-label={t("Close")} className="cursor-pointer rounded-control p-1 text-cinder hover:bg-rule-soft hover:text-soot" onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="shrink-0 border-b border-rule-soft px-5 py-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-cinder" aria-hidden="true" />
                <input className={`${input} w-full pl-9`} placeholder={t("Filter groups")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label={t("Filter groups")} />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {found.length === 0 ? (
                <p className="text-sm text-cinder">{t("No group matches.")}</p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {found.map((g) => <li key={g} className={chip}>{g}</li>)}
                </ul>
              )}
            </div>
            <div className="shrink-0 border-t border-rule px-5 py-2.5 text-xs text-cinder">
              {q.trim() ? t("{n} of {total}", { n: found.length, total: groups.length }) : t("{n} groups", { n: groups.length })}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
