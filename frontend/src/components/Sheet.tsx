import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import type { ReactNode } from "react";
import { ArrowLeft } from "../ui/icons";

// Sheet covers the whole window like a page of its own, over the list it
// edits: a bar with Back, the title, and the actions, then the content in a
// centred column. It is still a dialog: Escape goes back and focus stays
// inside.
export function Sheet({ open, onClose, title, back, actions, children }: { open: boolean; onClose: () => void; title: string; back: string; actions: ReactNode; children: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogPanel transition className="fixed inset-0 flex flex-col bg-ash data-closed:translate-y-3 data-closed:opacity-0 motion-safe:transition motion-safe:duration-200 motion-safe:ease-out">
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-ash/75 px-6 py-2 backdrop-blur-md lg:h-16 lg:px-9">
          <button type="button" className="-ml-2 inline-flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs text-cinder hover:bg-rule-soft hover:text-soot" onClick={onClose}>
            <ArrowLeft aria-hidden="true" />{back}
          </button>
          <span className="h-5 w-px bg-rule max-sm:hidden" aria-hidden="true" />
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-6 py-8 lg:px-9">{children}</div>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

