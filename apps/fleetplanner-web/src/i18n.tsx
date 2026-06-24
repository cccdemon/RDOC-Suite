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
    "rlink.title": "Briefing & Tutorials",
    "rlink.hint": "Kuratierte Links für Teilnehmer — YouTube, RSI-Hub, Google-Doc, Bild.",
    "rlink.url": "URL (https://…)",
    "rlink.label": "Titel (optional)",
    "rlink.add": "Link hinzufügen",
    "rlink.empty": "Noch keine Links hinterlegt.",
    "rlink.remove": "Entfernen",
    "rlink.invalid": "Bitte eine gültige http(s)-URL angeben.",
    "cover.wizardTitle": "Mission-Cover",
    "cover.wizardHint": "Optional: Erstelle direkt ein Missions-Cover für diese Operation.",
    "cover.created": "Operation erstellt.",
    "cover.toOp": "Zur Operation",
    "common.login": "Anmelden",
    "common.logout": "Abmelden",
    "common.loading": "Lade…",
    "common.feedback": "Feedback",
    "common.toOverview": "Zur Übersicht",
    "roadmap.title": "Roadmap",
    "roadmap.intro": "Was kommt, was hängt, was verworfen wurde. Wünsche?",
    "roadmap.status.planned": "Geplant",
    "roadmap.status.blocked": "Blockiert",
    "roadmap.status.rejected": "Abgelehnt",
    "roadmap.status.done": "Erledigt",
    "login.intro": "Melde dich an, um Operationen zu planen, Sitze zu beanspruchen und deiner Flotte beizutreten.",
    "login.discord": "Mit Discord anmelden",
    "login.github": "Mit GitHub anmelden",
    "login.google": "Mit Google anmelden",
    "login.publicPre": "Öffentliche Operationen kannst du auch ohne Login ",
    "login.publicLink": "ansehen",
    "error.401": "ANMELDUNG ERFORDERLICH",
    "error.403": "KEIN ZUGRIFF",
    "error.503": "WARTUNG",
    "error.404": "NICHT GEFUNDEN",
    "common.authRequired": "ANMELDUNG ERFORDERLICH",
    "common.send": "Senden",
    "common.remove": "Entfernen",
    "common.save": "Speichern",
    "feedback.title": "Feedback",
    "feedback.intro": "Bug, Idee oder Problem? Geht direkt ans Fleetplanner-Team.",
    "feedback.required": "Betreff und Nachricht sind erforderlich.",
    "feedback.sent": "Feedback gesendet — danke!",
    "feedback.failed": "Senden fehlgeschlagen.",
    "feedback.subject": "BETREFF",
    "feedback.message": "NACHRICHT",
    "nav.group.ops": "Operationen",
    "nav.group.server": "Server / Discord",
    "nav.group.konto": "Konto",
    "nav.group.admin": "Admin / System",
    "nav.group.info": "Info",
    "nav.ops": "Operationen",
    "nav.opsNew": "Neue Operation",
    "nav.polls": "Umfragen",
    "nav.ships": "Schiffe",
    "nav.servers": "Server",
    "nav.orgFleet": "Org-Flotte",
    "nav.settings": "Einstellungen",
    "nav.diagnostics": "Diagnose",
    "nav.partnerships": "Partnerschaften",
    "nav.konto": "Konto",
    "nav.admin": "Admin-Konsole",
    "nav.system": "System & Logs",
    "nav.handbuch": "Handbuch",
    "nav.apiDocs": "API-Doku",
    "sidebar.themeAria": "Hersteller-Theme",
    "sidebar.legal": "Rechtliches · Impressum · Datenschutz",
    "sidebar.screenAria": "Screen wechseln",
    "sidebar.viewPlaceholder": "— Ansicht —",
    "sidebar.guest": "Gast",
    "account.title": "Verknüpfte Logins",
    "account.label": "NUTZER // KONTO",
    "account.connected": "VERBUNDENE KONTEN",
    "account.none": "Noch keine verknüpften Logins.",
    "account.failed": "Konten nicht ladbar.",
    "account.linkDiscord": "Discord verknüpfen",
    "account.since": "seit",
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
    "rlink.title": "Briefing & Tutorials",
    "rlink.hint": "Curated links for participants — YouTube, RSI hub, Google doc, image.",
    "rlink.url": "URL (https://…)",
    "rlink.label": "Title (optional)",
    "rlink.add": "Add link",
    "rlink.empty": "No links yet.",
    "rlink.remove": "Remove",
    "rlink.invalid": "Please enter a valid http(s) URL.",
    "cover.wizardTitle": "Mission cover",
    "cover.wizardHint": "Optional: generate a mission cover for this operation now.",
    "cover.created": "Operation created.",
    "cover.toOp": "Go to operation",
    "common.login": "Sign in",
    "common.logout": "Sign out",
    "common.loading": "Loading…",
    "common.feedback": "Feedback",
    "common.toOverview": "To overview",
    "roadmap.title": "Roadmap",
    "roadmap.intro": "What's coming, what's stuck, what got dropped. Wishes?",
    "roadmap.status.planned": "Planned",
    "roadmap.status.blocked": "Blocked",
    "roadmap.status.rejected": "Rejected",
    "roadmap.status.done": "Done",
    "login.intro": "Sign in to plan operations, claim seats and join your fleet.",
    "login.discord": "Sign in with Discord",
    "login.github": "Sign in with GitHub",
    "login.google": "Sign in with Google",
    "login.publicPre": "You can also view public operations without signing in ",
    "login.publicLink": "here",
    "error.401": "SIGN-IN REQUIRED",
    "error.403": "NO ACCESS",
    "error.503": "MAINTENANCE",
    "error.404": "NOT FOUND",
    "common.authRequired": "SIGN-IN REQUIRED",
    "common.send": "Send",
    "common.remove": "Remove",
    "common.save": "Save",
    "feedback.title": "Feedback",
    "feedback.intro": "Bug, idea or problem? Goes straight to the Fleetplanner team.",
    "feedback.required": "Subject and message are required.",
    "feedback.sent": "Feedback sent — thanks!",
    "feedback.failed": "Sending failed.",
    "feedback.subject": "SUBJECT",
    "feedback.message": "MESSAGE",
    "nav.group.ops": "Operations",
    "nav.group.server": "Server / Discord",
    "nav.group.konto": "Account",
    "nav.group.admin": "Admin / System",
    "nav.group.info": "Info",
    "nav.ops": "Operations",
    "nav.opsNew": "New operation",
    "nav.polls": "Polls",
    "nav.ships": "Ships",
    "nav.servers": "Servers",
    "nav.orgFleet": "Org fleet",
    "nav.settings": "Settings",
    "nav.diagnostics": "Diagnostics",
    "nav.partnerships": "Partnerships",
    "nav.konto": "Account",
    "nav.admin": "Admin console",
    "nav.system": "System & logs",
    "nav.handbuch": "Handbook",
    "nav.apiDocs": "API docs",
    "sidebar.themeAria": "Manufacturer theme",
    "sidebar.legal": "Legal · Imprint · Privacy",
    "sidebar.screenAria": "Switch screen",
    "sidebar.viewPlaceholder": "— View —",
    "sidebar.guest": "Guest",
    "account.title": "Linked logins",
    "account.label": "USER // ACCOUNT",
    "account.connected": "CONNECTED ACCOUNTS",
    "account.none": "No linked logins yet.",
    "account.failed": "Could not load accounts.",
    "account.linkDiscord": "Link Discord",
    "account.since": "since",
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
