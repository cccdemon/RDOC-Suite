// i18n core (FR-P3-language-switch, Phase 2 infra). One preference per user,
// applied everywhere. `en` is the key base; other locales fall back per-key.
//
// Locale is request-scoped via AsyncLocalStorage so t() resolves the active
// language without threading `locale` through ~9899 lines of nested render
// helpers. app.ts sets a baseline from Accept-Language in an onRequest hook;
// loadSession() upgrades the store to user.locale once the user is known.
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { en } from "./dicts/en.js";
import { de } from "./dicts/de.js";
import { enUS } from "./dicts/en-US.js";
import { fr } from "./dicts/fr.js";
import { es } from "./dicts/es.js";

export const LOCALES = ["de", "en", "en-US", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";

export const localeSchema = z.enum(LOCALES);

/** Native display names shown in the language picker (not translated). */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  "en-US": "English (US)",
  fr: "Français",
  es: "Español",
};

// Each locale dict is merged over the en base, so a missing key transparently
// falls back to English and en-US works as a thin spelling override over en.
type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = {
  en,
  de: { ...en, ...de },
  "en-US": { ...en, ...enUS },
  fr: { ...en, ...fr },
  es: { ...en, ...es },
};

const als = new AsyncLocalStorage<{ locale: Locale }>();

/** Set the active locale for the rest of the current async context (request). */
export function enterLocale(locale: Locale): void {
  als.enterWith({ locale });
}

/**
 * Upgrade the active request's locale once the user is known. Mutates the
 * existing ALS store (set by the onRequest baseline) so it propagates to the
 * whole request without re-wrapping the handler.
 */
export function setLocale(locale: Locale): void {
  const store = als.getStore();
  if (store) store.locale = locale;
  else als.enterWith({ locale });
}

export function getLocale(): Locale {
  return als.getStore()?.locale ?? DEFAULT_LOCALE;
}

/** Validate an arbitrary string into a Locale, else null. */
export function parseLocale(value: string | null | undefined): Locale | null {
  const r = localeSchema.safeParse(value);
  return r.success ? r.data : null;
}

/**
 * Map an Accept-Language header to the nearest allowed locale, else the
 * default. en-GB / en / any en-* → en; en-US → en-US; de* → de; fr* → fr;
 * es* → es.
 */
export function localeFromAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean) as string[];
  for (const tag of tags) {
    if (tag === "en-us") return "en-US";
    const base = tag.split("-")[0];
    if (base === "de") return "de";
    if (base === "fr") return "fr";
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

/**
 * Single source of truth resolution: an authenticated user's stored locale
 * wins; otherwise the Accept-Language header; otherwise the default (de).
 */
export function resolveLocale(
  user: { locale?: string | null } | null | undefined,
  acceptLanguage: string | undefined,
): Locale {
  const fromUser = parseLocale(user?.locale);
  if (fromUser) return fromUser;
  return localeFromAcceptLanguage(acceptLanguage);
}

/**
 * Translate a key for the active request locale, interpolating {var} tokens.
 * Falls back to the en base, then to the key itself.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[getLocale()] ?? DICTS[DEFAULT_LOCALE];
  let out = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}
