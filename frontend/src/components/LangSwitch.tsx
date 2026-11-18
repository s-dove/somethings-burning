import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useEffect, useState } from "react";
import { chooseLang, followSaved, lang, LANGS, t, type Lang } from "../shared/i18n";
import { useApi, type Session } from "../shared/api";
import { Check, Languages, X } from "../ui/icons";
import { Tip } from "./Tip";

export function LangSwitch() {
  const current = LANGS.find((l) => l.id === lang)!;
  return (
    <Menu>
      <Tip content={t("Language")}>
        <MenuButton className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2 text-xs text-cinder hover:bg-rule-soft hover:text-soot" aria-label={`${t("Language")}: ${current.label}`}>
          <Languages size={15} aria-hidden="true" />
          {current.label}
        </MenuButton>
      </Tip>
      <MenuItems anchor="bottom end" className="z-50 w-52 rounded-card border border-rule bg-ash p-1 text-[13px] shadow-lg [--anchor-gap:6px] focus:outline-none">
        {LANGS.map((l) => (
          <MenuItem key={l.id}>
            <button type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-left data-focus:bg-rule-soft" onClick={() => void chooseLang(l.id, false)}>
              <span className="flex-1">{l.label}</span>
              {l.id === lang && <Check size={14} aria-hidden="true" />}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

export function LangGrid({ onPick, current = lang, cols = 3 }: { onPick: (l: Lang) => void; current?: Lang; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-1.5 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="radiogroup" aria-label={t("Language")}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={l.id === current}
          className={`flex cursor-pointer items-center justify-between gap-2 rounded-control border px-3 py-2 text-left text-[13px] ${l.id === current ? "border-soot bg-smoke font-medium shadow-[inset_0_0_0_1px_var(--color-soot)]" : "border-rule bg-ash hover:border-cinder"}`}
          onClick={() => onPick(l.id)}
        >
          {l.label}
          {l.id === current && <Check size={14} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/** The languages in a dialog, opened from the profile menu. Picking one saves it and reloads. */
export function LangDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-soot/30 data-closed:opacity-0 motion-safe:transition motion-safe:duration-100" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel transition className="w-full max-w-[760px] rounded-card border border-rule bg-ash p-5 shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-100">
          <div className="mb-4 flex items-center">
            <DialogTitle className="min-w-0 flex-1 text-sm font-semibold">{t("Language")}</DialogTitle>
            <button type="button" className="-mr-1 cursor-pointer rounded-control p-1 text-cinder hover:bg-rule-soft hover:text-soot" aria-label={t("Close")} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <LangGrid onPick={(l) => (l === lang ? onClose() : void chooseLang(l, true))} />
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/** Asks once, the first time a signed-in person has not chosen a language. */
export function LangGate() {
  const { data } = useApi<Session>("/session");
  const user = data?.user;
  const [picked, setPicked] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user?.lang) followSaved(user.lang);
  }, [user?.lang]);
  const ask = !!user && !user.lang;
  return (
    <Dialog open={ask} onClose={() => {}} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-soot/40 backdrop-blur-[2px]" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-[520px] rounded-card border border-rule bg-ash p-6 shadow-2xl">
          <span className="mb-3 grid size-10 place-items-center rounded-full bg-smoke text-cinder"><Languages size={18} aria-hidden="true" /></span>
          <DialogTitle className="text-lg font-semibold">{t("Choose your language")}</DialogTitle>
          <p className="mt-1 mb-5 text-[13px] text-cinder">{t("You can change it later from your profile.")}</p>
          <LangGrid current={picked} onPick={setPicked} />
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={busy}
              className="ui-button ui-button-primary ui-button-md"
              onClick={() => {
                setBusy(true);
                void chooseLang(picked, true).then(() => window.location.reload());
              }}
            >
              {picked === lang ? t("Continue") : t("Continue in {lang}", { lang: LANGS.find((l) => l.id === picked)!.label })}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
