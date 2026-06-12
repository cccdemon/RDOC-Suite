import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Lightweight SPA i18n foundation (FR-B8). New features use t() from the start;
// legacy hardcoded-German strings get migrated incrementally. The active locale
// comes from the user's saved preference (session.user.locale), else localStorage,
// else the browser, else "de".
export type Locale = "de" | "en";
export const LOCALES: Locale[] = ["de", "en"];
export const LOCALE_NAMES: Record<Locale, string> = { de: "Deutsch", en: "English" };

const DICT: Record<Locale, Record<string, string>> = {
  de: {
    "qa.title": "Fragen an die Einsatzleitung",
    "qa.placeholder": "Frage an die Einsatzleitung…",
    "qa.send": "Senden",
    "qa.empty": "Noch keine Fragen — stell die erste.",
    "qa.answeredBy": "beantwortet von {who}",
    "qa.unanswered": "Noch nicht beantwortet",
    "prefs.title": "Einstellungen",
    "prefs.language": "Sprache",
    "prefs.languageHint": "Sprache der Oberfläche.",
    "prefs.opStyle": "Op-Detail-Stil",
    "prefs.opStyleHint": "Bevorzugte Darstellung der Operationsdetails.",
    "prefs.opStyle.classic": "Klassisch",
    "prefs.opStyle.board1": "Board (kompakt)",
    "prefs.opStyle.board2": "Board (breit)",
    "prefs.save": "Speichern",
    "prefs.saved": "Gespeichert.",
    "prefs.error": "Speichern fehlgeschlagen.",
    "konto.tab.prefs": "Einstellungen",
  },
  en: {
    "qa.title": "Questions to command",
    "qa.placeholder": "Ask command a question…",
    "qa.send": "Send",
    "qa.empty": "No questions yet — ask the first.",
    "qa.answeredBy": "answered by {who}",
    "qa.unanswered": "Not answered yet",
    "prefs.title": "Settings",
    "prefs.language": "Language",
    "prefs.languageHint": "Interface language.",
    "prefs.opStyle": "Op detail style",
    "prefs.opStyleHint": "Preferred operation-detail layout.",
    "prefs.opStyle.classic": "Classic",
    "prefs.opStyle.board1": "Board (compact)",
    "prefs.opStyle.board2": "Board (wide)",
    "prefs.save": "Save",
    "prefs.saved": "Saved.",
    "prefs.error": "Save failed.",
    "konto.tab.prefs": "Settings",
  },
};

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let s = DICT[locale]?.[key] ?? DICT.de[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

type Ctx = { locale: Locale; setLocale: (l: Locale) => void };
const LocaleContext = createContext<Ctx>({ locale: "de", setLocale: () => {} });

function readInitial(): Locale {
  try {
    const ls = localStorage.getItem("fpw-locale");
    if (ls === "de" || ls === "en") return ls;
  } catch { /* ignore */ }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.startsWith("en") ? "en" : "de";
}

// `preferred` follows the logged-in user's saved locale once the session loads.
export function LocaleProvider({ preferred, children }: { preferred?: string | null; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitial);

  useEffect(() => {
    if (preferred === "de" || preferred === "en") setLocaleState(preferred);
  }, [preferred]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem("fpw-locale", l); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Ctx {
  return useContext(LocaleContext);
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { locale } = useLocale();
  return useCallback((key: string, params?: Record<string, string | number>) => translate(locale, key, params), [locale]);
}
