import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui/components/Button";
import { TriangleAlert } from "../ui/icons";
import { t } from "../shared/i18n";

// Asks before something is done, in our dialog rather than the browser's.
// Await it like window.confirm. ConfirmHost is mounted once.

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

type Ask = ConfirmOptions & { resolve: (ok: boolean) => void };
let show: ((a: Ask) => void) | null = null;

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(o.title));
    show({ ...o, resolve });
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    show = (a) => {
      setAsk(a);
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);
  const done = (ok: boolean) => {
    ask?.resolve(ok);
    setOpen(false);
  };
  return (
    <Dialog open={open} onClose={() => done(false)} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-soot/40 backdrop-blur-[2px] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel transition className="w-full max-w-[440px] rounded-card border border-rule bg-ash p-5 shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150">
          <div className="flex gap-3">
            {ask?.danger && (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ember-soft text-ember-ink">
                <TriangleAlert aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[15px] font-semibold leading-snug">{ask?.title}</DialogTitle>
              {ask?.body && <div className="mt-1.5 text-[13px] leading-relaxed text-cinder">{ask.body}</div>}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => done(false)}>{t("Cancel")}</Button>
            <Button variant={ask?.danger ? "danger" : "primary"} onClick={() => done(true)} autoFocus>
              {ask?.confirm ?? t("Confirm")}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
