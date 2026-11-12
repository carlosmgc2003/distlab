import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { messages } from "./catalog.ts";
import type { Messages } from "./catalog.ts";
import { LOCALE_STORAGE_KEY, localeInfo } from "./locales.ts";
import type { Locale } from "./locales.ts";

interface LocaleState {
  readonly m: Messages;
  readonly setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState | null>(null);

/** Applies the language to the document so assistive technology and `:lang()` read it. */
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale === "en-XA" ? "en" : localeInfo(locale).tag;
}

/**
 * Holds the interface language as UI state (ADR-007). Changing it re-renders
 * with another catalog; it sends no worker command and resets nothing, because
 * the language is never an input to the simulation.
 */
export function LocaleProvider({ initial, children }: { readonly initial: Locale; readonly children: ReactNode }) {
  const [locale, setState] = useState<Locale>(initial);
  const setLocale = useCallback((next: Locale) => {
    setState(next);
    applyDocumentLocale(next);
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Storage can be unavailable; the choice then lasts for this page only. */ }
  }, []);
  const value = useMemo(() => ({ m: messages(locale), setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The active bound catalog. Outside a provider (isolated renders), English. */
export function useMessages(): Messages {
  return useContext(LocaleContext)?.m ?? messages("en");
}

export function useLocaleSetter(): (locale: Locale) => void {
  const state = useContext(LocaleContext);
  return state?.setLocale ?? (() => undefined);
}
