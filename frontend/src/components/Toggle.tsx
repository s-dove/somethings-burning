import { Switch } from "@headlessui/react";
import type { ReactNode } from "react";

// Toggle is an on/off switch for settings. Checkboxes stay for picking things out of a list.
export function Toggle({ checked, onChange, disabled, label, className = "items-center", children }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string; className?: string; children?: ReactNode }) {
  return (
    <label className={`inline-flex w-fit gap-2.5 text-[13px] ${className} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
        className="group relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full bg-rule p-[2px] transition-colors duration-200 data-checked:bg-[#34c759] data-disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot"
      >
        <span className="size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out group-data-checked:translate-x-4" />
      </Switch>
      {children}
    </label>
  );
}
