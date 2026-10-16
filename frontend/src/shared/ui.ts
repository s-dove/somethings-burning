// Shared control classes. Buttons are ui/components/Button.
export const input =
  "min-w-0 rounded-control border border-rule bg-ash px-3 py-2 text-[13px] text-soot outline-none placeholder:text-cinder focus:border-cinder focus:outline-2 focus:outline-offset-2 focus:outline-soot";

export const pill =
  "inline-block rounded-control border border-transparent px-[9px] py-0.5 text-xs font-medium whitespace-nowrap";
export const pillTone = {
  open: "bg-ember-soft text-ember-ink",
  resolved: "bg-doused-soft text-doused",
  muted: "bg-rule-soft text-cinder",
} as const;

export const section = "mb-6 min-w-0 rounded-card border border-rule bg-ash p-5";
export const sectionTitle = "mb-4 flex flex-wrap items-baseline gap-2 text-sm font-semibold";
