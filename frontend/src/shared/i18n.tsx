
// The English text is the key. A missing dictionary entry stays English.
// The language is chosen before the app renders; switching reloads the page.
// A signed-in person's choice is kept on the server. This browser keeps a copy.

export type Lang = "en" | "zh" | "zh-TW" | "ja" | "ko" | "es" | "fr" | "de" | "pt-BR";
export const LANGS: { id: Lang; label: string; html: string }[] = [
  { id: "en", label: "English", html: "en" },
  { id: "zh", label: "简体中文", html: "zh-CN" },
  { id: "zh-TW", label: "繁體中文", html: "zh-TW" },
  { id: "ja", label: "日本語", html: "ja" },
  { id: "ko", label: "한국어", html: "ko" },
  { id: "es", label: "Español", html: "es" },
  { id: "fr", label: "Français", html: "fr" },
  { id: "de", label: "Deutsch", html: "de" },
  { id: "pt-BR", label: "Português (Brasil)", html: "pt-BR" },
];
const KEY = "burning-lang";
const isLang = (s: unknown): s is Lang => LANGS.some((l) => l.id === s);

// Only the dictionaries that exist. The others stay English until they are added.
const LOADERS: Partial<Record<Lang, () => Promise<{ default: Record<string, string> }>>> = {
  zh: () => import("./locales/zh"),
};

function fromBrowser(): Lang {
  const all = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  for (const raw of all) {
    const l = (raw ?? "").toLowerCase();
    if (/^zh-(tw|hk|mo)|^zh-hant/.test(l)) return "zh-TW";
    if (l.startsWith("zh")) return "zh";
    if (l.startsWith("pt")) return "pt-BR";
    const base = l.split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    // no storage: follow the browser
  }
  return fromBrowser();
}

export const lang: Lang = initial();
if (typeof document !== "undefined") document.documentElement.lang = LANGS.find((l) => l.id === lang)!.html;

let dict: Record<string, string> | null = null;

export async function loadDictionary(): Promise<void> {
  const load = LOADERS[lang];
  if (!load) return;
  try {
    dict = (await load()).default;
  } catch {
    dict = null;
  }
}

export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  const s = dict?.[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : s;
}


function keep(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // nothing to keep it in
  }
}

export async function chooseLang(l: Lang, signedIn: boolean): Promise<void> {
  if (signedIn) {
    await fetch("/api/profile/lang", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: l }), credentials: "same-origin" });
  }
  keep(l);
  if (l !== lang) window.location.reload();
}

export function followSaved(saved: string): void {
  if (isLang(saved) && saved !== lang) {
    keep(saved);
    window.location.reload();
  }
}
