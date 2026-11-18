import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useState, type ReactNode } from "react";
import { Check, X } from "../ui/icons";
import { t } from "../shared/i18n";

export interface PickOption<T extends string> {
  value: T;
  label: string;
  hint?: string; // a second line under the label
  icon?: ReactNode;
}

// Picker shows the current value as a plain token, not a dropdown. Clicking
// it opens the choices in a dialog as a grid of panels, each with its hint;
// the current one is outlined. Picking closes it. It works inside another
// dialog.
export function Picker<T extends string>({ label, value, options, onChange, disabled, mono, className = "" }: {
  label: string; // the dialog title, and the token's accessible name
  value: T;
  options: PickOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  mono?: boolean; // show labels in the mono font (fields, operators)
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <>
      <button
        type="button"
        aria-label={t("{label}: {value}. Change", { label, value: current?.label ?? t("choose") })}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`inline-flex h-8 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-rule bg-ash px-2.5 text-xs font-medium text-soot hover:border-cinder hover:bg-smoke focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot disabled:cursor-default disabled:hover:border-rule disabled:hover:bg-ash ${className}`}
      >
        {current?.icon && <span className="shrink-0 text-cinder" aria-hidden="true">{current.icon}</span>}
        <span className={`truncate ${mono ? "mono" : ""}`}>{current?.label ?? "Choose"}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[60]">
        <DialogBackdrop transition className="fixed inset-0 bg-soot/30 data-closed:opacity-0 motion-safe:transition motion-safe:duration-100" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel transition className="flex max-h-[85vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-card border border-rule bg-ash shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-100">
            <div className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-3">
              <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</DialogTitle>
              <button type="button" className="-mr-1 cursor-pointer rounded-control p-1 text-cinder hover:bg-rule-soft hover:text-soot" aria-label={t("Close")} onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
            <ul className="m-0 grid min-h-0 flex-1 list-none grid-cols-1 gap-2.5 overflow-y-auto p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {options.map(o => {
                const on = o.value === value;
                return (
                  <li key={o.value} className="min-w-0">
                    <button
                      type="button"
                      data-autofocus={on ? true : undefined}
                      aria-pressed={on}
                      onClick={() => { onChange(o.value); setOpen(false); }}
                      className={`relative flex h-full w-full cursor-pointer flex-col items-start gap-1.5 rounded-card border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot ${on ? "border-soot bg-smoke shadow-[inset_0_0_0_1px_var(--color-soot)]" : "border-rule bg-ash hover:border-cinder hover:bg-smoke"}`}
                    >
                      <span className="flex w-full items-center gap-2">
                        {o.icon && <span className="shrink-0 text-cinder" aria-hidden="true">{o.icon}</span>}
                        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${mono ? "mono" : ""}`}>{o.label}</span>
                        {on && <Check className="shrink-0" size={14} aria-hidden="true" />}
                      </span>
                      {o.hint && <span className="text-xs leading-snug text-cinder">{o.hint}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
