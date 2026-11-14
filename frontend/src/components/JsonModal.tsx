import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useRef, useState } from "react";
import { Button } from "../ui/components/Button";
import { Check, Copy, X } from "../ui/icons";
import { copyText } from "../shared/clipboard";
import { CodeBlock } from "./common/CodeBlock";

const kb = (s: string) => {
  const n = new Blob([s]).size;
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
};

// JsonModal shows a JSON document highlighted, with a copy button. The header
// and footer stay put and the code scrolls. Escape or the backdrop closes it.
export function JsonModal({ open, onClose, title, subtitle, json }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  json: string;
}) {
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const copy = async () => {
    if (await copyText(json, panel.current)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-soot/40 backdrop-blur-[2px] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150" />
      <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-8">
        <DialogPanel
          ref={panel}
          transition
          className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-card border border-rule bg-ash shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150"
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-rule px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{title}</DialogTitle>
              <p className="mt-0.5 truncate text-xs text-cinder">{subtitle ? `${subtitle}, ` : ""}{kb(json)}</p>
            </div>
            <Button size="sm" variant="secondary" icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} onClick={copy}>{copied ? "Copied" : "Copy JSON"}</Button>
            <button type="button" className="-mr-1 cursor-pointer rounded-control p-1.5 text-cinder hover:bg-rule-soft hover:text-soot" aria-label="Close" onClick={onClose}><X /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--code-bg)]">
            <CodeBlock code={json} language="json" className="min-h-full px-5 py-4" />
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
