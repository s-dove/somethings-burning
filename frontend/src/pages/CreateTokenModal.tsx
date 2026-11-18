import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useState, type FormEvent } from "react";
import { Select, type SelectOption } from "../components/common/Select";
import { api, type PersonalTokenView } from "../shared/api";
import { copyText } from "../shared/clipboard";
import { t } from "../shared/i18n";
import { input } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Copy, KeyRound } from "../ui/icons";

type Scope = PersonalTokenView["scope"];

// CreateTokenModal makes a personal access token: name, access, and how long
// it lasts, then shows the token once to copy. The tokens page and the MCP
// page both open it.
export function CreateTokenModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated?: (token: string) => void; // right after it is made, before the person closes the dialog
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("read");
  const [days, setDays] = useState("90");
  const [made, setMade] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Each time it opens, it starts from an empty form.
  useEffect(() => {
    if (!open) return;
    setName("");
    setScope("read");
    setDays("90");
    setMade("");
    setProblem("");
  }, [open]);

  const scopes: SelectOption<Scope>[] = [
    { value: "read", label: t("Read only") },
    { value: "write", label: t("Read and write") },
  ];
  const expiries: SelectOption<string>[] = [
    { value: "30", label: t("30 days") },
    { value: "90", label: t("90 days") },
    { value: "180", label: t("180 days") },
    { value: "365", label: t("1 year") },
    { value: "0", label: t("Never") },
  ];

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const r = await api<{ token: string }>("/profile/tokens", { method: "POST", body: { name: name.trim(), scope, days: Number(days) } });
      setMade(r.token);
      onCreated?.(r.token);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-soot/40 backdrop-blur-[2px] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel transition className="w-full max-w-[480px] rounded-card border border-rule bg-ash p-5 shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-150">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-rule bg-smoke text-cinder">
              <KeyRound aria-hidden="true" />
            </span>
            <DialogTitle className="text-[15px] font-semibold leading-snug">{made ? t("Your new token") : t("New token")}</DialogTitle>
          </div>
          {made ? (
            <>
              <div className="rounded-control border border-[#f6cfae] bg-ember-soft p-3">
                <p className="mb-2 text-xs font-semibold text-ember-ink">{t("Copy it now: it is not shown again.")}</p>
                <div className="flex gap-2">
                  <input type="password" readOnly className={`${input} mono min-w-0 flex-1`} value={made} aria-label={t("Token")} autoComplete="off" data-1p-ignore data-lpignore="true" />
                  <Button type="button" variant="secondary" icon={<Copy aria-hidden="true" />} onClick={() => void copyText(made)}>{t("Copy")}</Button>
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <Button variant="primary" onClick={onClose} autoFocus>{t("Done")}</Button>
              </div>
            </>
          ) : (
            <form className="grid gap-3" onSubmit={(e) => void create(e)}>
              <label className="grid gap-1.5 text-xs font-medium">
                {t("Name")}
                <input className={`${input} h-9`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Local agent")} required autoFocus />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Select label={t("Access")} value={scope} options={scopes} onChange={setScope} />
                <Select label={t("Expires")} value={days} options={expiries} onChange={setDays} />
              </div>
              {problem && <p role="alert" className="text-[13px] text-ember-ink">{problem}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
                <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? t("Creating…") : t("Create")}</Button>
              </div>
            </form>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
