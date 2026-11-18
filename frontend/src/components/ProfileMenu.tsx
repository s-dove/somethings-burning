import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { lang, LANGS, t } from "../shared/i18n";
import type { Session } from "../shared/api";
import { useState } from "react";
import { Languages, LogOut, Palette, UserRound } from "../ui/icons";
import { Link } from "./common/Link";
import { LangDialog } from "./LangSwitch";
import { ThemeDialog, themeLabel } from "./ThemeSwitch";

const item = "flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[13px] text-soot no-underline hover:bg-rule-soft";

/** The person at the foot of the sidebar: profile, language, theme, and log out. Language and theme open dialogs. */
export function ProfileMenu({ session, current }: { session: Session | null | undefined; current: boolean }) {
  const [dialog, setDialog] = useState<"lang" | "theme" | null>(null);
  const user = session?.user;
  if (!user) {
    return (
      <a href="/login" className={`${item} flex-1`}>
        <UserRound size={15} className="text-cinder" aria-hidden="true" />
        {t("Sign in")}
      </a>
    );
  }
  const name = user.displayName || user.email;
  return (
    <>
    <Popover className="min-w-0 flex-1">
      <PopoverButton
        className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control py-1.5 pr-2 pl-1.5 text-left hover:bg-rule-soft focus-visible:outline-2 focus-visible:outline-soot ${current ? "bg-rule-soft font-semibold" : ""}`}
        aria-label={t("Profile: {name}", { name })}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-rule bg-ash text-xs font-semibold text-soot">{name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
      </PopoverButton>
      <PopoverPanel anchor="top start" className="z-50 w-72 rounded-card border border-rule bg-ash p-1.5 shadow-xl [--anchor-gap:8px] focus:outline-none">
        {({ close }) => (
          <>
            <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-rule bg-smoke text-sm font-semibold">{name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{name}</span>
                <span className="block truncate text-xs text-cinder">{user.email}</span>
              </span>
            </div>
            <div className="border-t border-rule-soft pt-1">
              <Link to="/profile" className={item} onClick={() => close()}>
                <UserRound size={15} className="text-cinder" aria-hidden="true" />
                {t("Profile")}
              </Link>
              {/* The menu closes and the dialog opens outside it. */}
              <button type="button" className={item} aria-haspopup="dialog" onClick={() => { close(); setDialog("lang"); }}>
                <Languages size={15} className="text-cinder" aria-hidden="true" />
                <span className="flex-1">{t("Language")}</span>
                <span className="text-xs text-cinder">{LANGS.find((l) => l.id === lang)!.label}</span>
              </button>
              <button type="button" className={item} aria-haspopup="dialog" onClick={() => { close(); setDialog("theme"); }}>
                <Palette size={15} className="text-cinder" aria-hidden="true" />
                <span className="flex-1">{t("Theme")}</span>
                <span className="text-xs text-cinder">{themeLabel()}</span>
              </button>
            </div>
            <form method="post" action="/auth/logout" className="mt-1 border-t border-rule-soft pt-1">
              <button type="submit" className={item}>
                <LogOut size={15} className="text-cinder" aria-hidden="true" />
                {t("Log out")}
              </button>
            </form>
          </>
        )}
      </PopoverPanel>
    </Popover>
    <LangDialog open={dialog === "lang"} onClose={() => setDialog(null)} />
    <ThemeDialog open={dialog === "theme"} onClose={() => setDialog(null)} />
    </>
  );
}
