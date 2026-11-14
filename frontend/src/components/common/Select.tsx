import { Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import type { ReactNode } from "react";
import { Check, ChevronsUpDown } from "../../ui/icons";
import { Tip } from "../Tip";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string; // a second line under the label in the open list
  icon?: ReactNode;
}

// Select picks one value from a short list. The list opens under the button
// (or above, near the bottom of the screen), shows a check on the current
// value, and works with the keyboard: arrows, Enter, Escape, and typing the
// first letters.
export function Select<T extends string>({ label, hideLabel, value, options, onChange, disabled, size = "md", title, className = "" }: {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  const current = options.find(o => o.value === value);
  const height = size === "sm" ? "h-8 text-xs" : "h-9 text-[13px]";
  return (
    <Field disabled={disabled} className={`grid gap-1.5 ${className}`}>
      <Label className={hideLabel ? "sr-only" : "text-xs font-medium"}>{label}</Label>
      <Listbox value={value} onChange={onChange} disabled={disabled}>
        <Tip content={title}><div className="min-w-0"><ListboxButton
          className={`group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border border-rule bg-ash pr-2 pl-3 text-left text-soot outline-none hover:border-cinder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot data-disabled:cursor-not-allowed data-disabled:opacity-60 data-disabled:hover:border-rule data-open:border-cinder ${height}`}
        >
          {current?.icon && <span className="shrink-0 text-cinder" aria-hidden="true">{current.icon}</span>}
          <span className="min-w-0 flex-1 truncate">{current?.label ?? "Choose"}</span>
          <ChevronsUpDown className="shrink-0 text-cinder" size={14} aria-hidden="true" />
        </ListboxButton></div></Tip>
        <ListboxOptions
          anchor="bottom start"
          transition
          className="z-50 w-(--button-width) min-w-64 rounded-card border border-rule bg-ash p-1 shadow-lg [--anchor-gap:4px] [--anchor-padding:8px] focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0 motion-safe:transition motion-safe:duration-100"
        >
          {options.map(o => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="group flex cursor-pointer items-start gap-2 rounded-control px-2.5 py-2 text-[13px] text-soot select-none data-focus:bg-rule-soft data-selected:font-semibold"
            >
              {o.icon && <span className="mt-px shrink-0 text-cinder" aria-hidden="true">{o.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="mt-0.5 block text-xs font-normal text-cinder">{o.hint}</span>}
              </span>
              <Check className="mt-0.5 shrink-0 text-ember-ink invisible group-data-selected:visible" size={14} aria-hidden="true" />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </Field>
  );
}
