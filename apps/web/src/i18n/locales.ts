/**
 * The interface languages (ADR-007). Adding a language is: a catalog under
 * `i18n/<id>/`, one entry here, one entry in `catalog.ts`, and glossary terms.
 */
export const LOCALES = [
  { id: "en", tag: "en", name: "English", quotes: ["“", "”"] },
  { id: "es", tag: "es", name: "Español", quotes: ["«", "»"] },
  // Pseudo-locale for tests and review: every catalog string, accented and padded. Never listed in the switcher.
  { id: "en-XA", tag: "en", name: "Pseudo", quotes: ["“", "”"] },
] as const satisfies readonly { readonly id: string; readonly tag: string; readonly name: string; readonly quotes: readonly [string, string] }[];

export type Locale = (typeof LOCALES)[number]["id"];
export const DEFAULT_LOCALE: Locale = "en";
/** Languages a student can pick. The pseudo-locale is reachable only with `?lang=en-XA`. */
export const SELECTABLE_LOCALES: readonly Locale[] = ["en", "es"];
export const LOCALE_STORAGE_KEY = "distlab.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some(locale => locale.id === value);
}

export function localeInfo(locale: Locale): (typeof LOCALES)[number] {
  return LOCALES.find(item => item.id === locale) ?? LOCALES[0];
}

/**
 * Chooses the interface language: an explicit `?lang=` wins, then the stored
 * choice, then the first browser language that matches a selectable locale by
 * its primary subtag, then English. Pure: callers pass what they read.
 */
export function detectLocale(input: { readonly query?: string | null; readonly stored?: string | null; readonly languages?: readonly string[] }): Locale {
  if (isLocale(input.query)) return input.query;
  if (isLocale(input.stored) && SELECTABLE_LOCALES.includes(input.stored)) return input.stored;
  for (const language of input.languages ?? []) {
    const primary = language.toLowerCase().split("-")[0];
    const match = SELECTABLE_LOCALES.find(locale => locale === primary);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
