import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, MonitorSmartphone, X } from "../ui/icons";
import { t } from "../shared/i18n";

// The themes in styles.css (daisyUI). "system" follows the OS: Burning, or
// Burning dark when the system is dark. Nothing chosen yet is Burning.
const THEMES: { id: string; label: string; dark?: boolean }[] = [
  { id: "system", label: "System" },
  { id: "burning", label: "Burning" },
  { id: "burning-dark", label: "Burning dark", dark: true },
  { id: "corporate", label: "Corporate" },
  { id: "nord", label: "Nord" },
  { id: "dim", label: "Dim", dark: true },
  { id: "night", label: "Night", dark: true },
  { id: "coffee", label: "Coffee", dark: true },
  { id: "sunset", label: "Sunset", dark: true },
];
const KEY = "burning-theme";
// Each side scrolls on its own. One choice per row, full width, and the
// preview is always 10rem tall, so both sides stay the same height.
const PANE_GRID = "m-0 grid min-h-0 flex-1 list-none grid-cols-1 gap-2.5 overflow-y-auto p-4 pt-2";
const ROW_LABEL = "flex h-8 items-center gap-2 px-2 text-[13px] font-medium";
const CARD = "w-full cursor-pointer rounded-card border p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-soot";
const CARD_ON = "border-soot shadow-[inset_0_0_0_1px_var(--color-soot)]";
const CARD_OFF = "border-rule hover:border-cinder";

// Code themes (prism.css). "system" follows the OS: Burning light, or
// Burning dark when the system is dark. Nothing saved yet means Burning dark.
const CODE_THEMES: { id: string; label: string }[] = [
  { id: "system", label: "System" },
  { id: "burning-light", label: "Burning light" },
  { id: "burning-dark", label: "Burning dark" },
  { id: "github-light", label: "GitHub light" },
  { id: "github-dark", label: "GitHub dark" },
];
const DEFAULT_CODE = "burning-dark";
const CODE_KEY = "burning-code-theme";

// A copy of the choice that was current when the dialog opened. The
// original stays in the list. The copy does not change until the next open.
function currentChoice<T extends { id: string }>(items: T[], current: string): T | undefined {
  return items.find(item => item.id === current);
}

const read = (key: string): string => {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
};
const write = (key: string, id: string) => {
  try { localStorage.setItem(key, id); } catch { /* private mode */ }
};

export const storedTheme = (): string => {
  const id = read(KEY);
  if (id === "") return "system"; // saved before "system" had its own value
  return id || "burning";
};
export const storedCodeTheme = (): string => {
  const id = read(CODE_KEY);
  return CODE_THEMES.some(theme => theme.id === id) ? id : DEFAULT_CODE;
};

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
// shownCode is the code theme to paint. System picks Burning light or dark.
const shownCode = (id: string) => id === "system" ? (systemDark() ? "burning-dark" : "burning-light") : id;

// applyCode sets data-code-theme on <html>, which every code block reads.
function applyCode() {
  document.documentElement.dataset.codeTheme = shownCode(storedCodeTheme());
}

// applyTheme sets data-theme on <html>, which every color in the app reads.
// The code theme stays whatever was chosen for it.
export function applyTheme(id: string) {
  if (id && id !== "system") document.documentElement.dataset.theme = id;
  else delete document.documentElement.dataset.theme;
  write(KEY, id);
  applyCode();
}

export function applyCodeTheme(id: string) {
  write(CODE_KEY, id);
  applyCode();
}

// watchSystemTheme applies the saved code theme, and keeps a System
// choice in step when the OS switches between light and dark.
export function watchSystemTheme() {
  applyCode();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyCode);
}

/** The name of the saved theme, for the menu row that opens the dialog. */
export const themeLabel = (): string => t(THEMES.find((x) => x.id === storedTheme())?.label ?? "System");

// ThemeDialog shows the themes as a grid of previews, each painted in its
// own theme. Picking one applies it at once and remembers it in this browser.
// The profile menu opens it.
export function ThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setOpen = (v: boolean) => { if (!v) onClose(); };
  const [theme, setTheme] = useState(storedTheme);
  const [code, setCode] = useState(storedCodeTheme);
  // Frozen for this visit. The next open reads whatever was chosen.
  const [topTheme, setTopTheme] = useState(theme);
  const [topCode, setTopCode] = useState(code);
  const themeList = useRef<HTMLUListElement>(null);
  const codeList = useRef<HTMLUListElement>(null);
  const pick = (id: string) => { applyTheme(id); setTheme(id); };
  const pickCode = (id: string) => { applyCodeTheme(id); setCode(id); };
  // Each open starts from what is saved now.
  useEffect(() => {
    if (!open) return;
    setTheme(storedTheme());
    setCode(storedCodeTheme());
    setTopTheme(storedTheme());
    setTopCode(storedCodeTheme());
  }, [open]);
  const pinnedTheme = currentChoice(THEMES, topTheme);
  const pinnedCode = currentChoice(CODE_THEMES, topCode);
  useLayoutEffect(() => {
    if (!open) return;
    const toTop = () => {
      if (themeList.current) themeList.current.scrollTop = 0;
      if (codeList.current) codeList.current.scrollTop = 0;
    };
    toTop();
    const frame = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(frame);
  }, [open, topTheme, topCode]);
  return (
    <>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[60]">
        <DialogBackdrop transition className="fixed inset-0 bg-soot/30 data-closed:opacity-0 motion-safe:transition motion-safe:duration-100" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel transition className="flex h-[min(720px,85vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-card border border-rule bg-ash shadow-2xl data-closed:scale-[0.98] data-closed:opacity-0 motion-safe:transition motion-safe:duration-100">
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1">
              <section className="@container flex min-h-0 flex-col border-b border-rule sm:border-r sm:border-b-0">
                <div className="flex shrink-0 items-center border-b border-rule px-4 py-3">
                  <DialogTitle className="text-sm font-semibold">{t("Theme")}</DialogTitle>
                </div>
                <ul ref={themeList} className={PANE_GRID}>
                  {pinnedTheme && (
                    <li key="current">
                      <ThemeChoice theme={pinnedTheme} picked={theme} onPick={pick} current />
                    </li>
                  )}
                  {THEMES.map(t => (
                    <li key={t.id || "system"}>
                      <ThemeChoice theme={t} picked={theme} onPick={pick} />
                    </li>
                  ))}
                </ul>
              </section>
              <section className="@container flex min-h-0 flex-col">
                <div className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-3">
                  <h3 className="min-w-0 flex-1 text-sm font-semibold">{t("Code theme")}</h3>
                  <button type="button" className="-mr-1 cursor-pointer rounded-control p-1 text-cinder hover:bg-rule-soft hover:text-soot" aria-label={t("Close")} onClick={() => setOpen(false)}><X size={16} /></button>
                </div>
                <ul ref={codeList} className={PANE_GRID}>
                  {pinnedCode && (
                    <li key="current">
                      <CodeChoice theme={pinnedCode} picked={code} onPick={pickCode} current />
                    </li>
                  )}
                  {CODE_THEMES.map(t => (
                    <li key={t.id}>
                      <CodeChoice theme={t} picked={code} onPick={pickCode} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

function ThemeChoice({ theme, picked, onPick, current }: {
  theme: { id: string; label: string };
  picked: string;
  onPick: (id: string) => void;
  current?: boolean;
}) {
  const on = picked === theme.id;
  return (
    <button type="button" aria-pressed={on} onClick={() => onPick(theme.id)} data-autofocus={current ? true : undefined}
      className={`${CARD} ${on ? CARD_ON : CARD_OFF}`}>
      <Preview id={theme.id} />
      <span className={ROW_LABEL}>
        {theme.id === "" && <MonitorSmartphone size={14} className="shrink-0 text-cinder" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{current ? t("Current: {name}", { name: t(theme.label) }) : t(theme.label)}</span>
        {on && <Check size={14} className="shrink-0" aria-hidden="true" />}
      </span>
    </button>
  );
}

function CodeChoice({ theme, picked, onPick, current }: {
  theme: { id: string; label: string };
  picked: string;
  onPick: (id: string) => void;
  current?: boolean;
}) {
  const on = picked === theme.id;
  return (
    <button type="button" aria-pressed={on} onClick={() => onPick(theme.id)}
      className={`${CARD} ${on ? CARD_ON : CARD_OFF}`}>
      <CodePreview id={theme.id} />
      <span className={ROW_LABEL}>
        {theme.id === "system" && <MonitorSmartphone size={14} className="shrink-0 text-cinder" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{current ? t("Current: {name}", { name: t(theme.label) }) : t(theme.label)}</span>
        {on && <Check size={14} className="shrink-0" aria-hidden="true" />}
      </span>
    </button>
  );
}

// Preview is a tiny page in the theme: a sidebar, a card with lines, and
// the heat scale, which looks the same in every theme. "System" shows both
// inside one frame, always 10rem tall. Nested previews fill that frame.
function Preview({ id, fill }: { id: string; fill?: boolean }) {
  const frame = fill ? "h-full min-h-0" : "h-40 w-full";
  if (!id) {
    return (
      <span className={`grid grid-cols-2 gap-1 ${frame}`}>
        <Preview id="burning" fill />
        <Preview id="burning-dark" fill />
      </span>
    );
  }
  return (
    <span data-theme={id} className={`flex overflow-hidden rounded-[7px] border border-rule bg-smoke ${frame}`}>
      <span className="w-1/4 border-r border-rule bg-smoke" />
      <span className="flex flex-1 flex-col gap-1 p-2">
        <span className="h-1.5 w-1/2 rounded-full bg-soot" />
        <span className="flex flex-1 flex-col gap-1 rounded-[5px] border border-rule bg-ash p-1.5">
          <span className="h-1 w-3/4 rounded-full bg-cinder/60" />
          <span className="flex gap-0.5">
            {["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"].map(c => <span key={c} className={`h-1.5 w-2.5 rounded-[2px] ${c}`} />)}
          </span>
        </span>
      </span>
    </span>
  );
}

// CodePreview is three lines of code painted in one code theme.
// System shows Burning light and Burning dark side by side.
function CodePreview({ id, fill }: { id: string; fill?: boolean }) {
  const frame = fill ? "h-full min-h-0" : "h-40 w-full";
  if (id === "system") {
    return (
      <span className={`grid grid-cols-2 gap-1 ${frame}`}>
        <CodePreview id="burning-light" fill />
        <CodePreview id="burning-dark" fill />
      </span>
    );
  }
  return (
    <span data-code-theme={id} className={`block overflow-hidden rounded-[7px] ${frame}`}>
      <pre className="mono language-python block h-full px-3 py-2.5 text-sm leading-relaxed">
        <code>
          <span className="token keyword">def</span> <span className="token function">load</span><span className="token punctuation">(</span>{"name"}<span className="token punctuation">):</span>{"\n"}
          {"  "}<span className="token comment"># cached</span>{"\n"}
          {"  "}<span className="token keyword">return</span> cache<span className="token punctuation">[</span><span className="token string">"k"</span><span className="token punctuation">]</span> <span className="token operator">+</span> <span className="token number">1</span>{"\n"}
          {"\n"}
          <span className="token keyword">class</span> <span className="token class-name">Store</span><span className="token punctuation">:</span>{"\n"}
          {"  "}ready <span className="token operator">=</span> <span className="token boolean">True</span>
        </code>
      </pre>
    </span>
  );
}
