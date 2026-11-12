import { useId } from "react";
import { LOCALES, SELECTABLE_LOCALES } from "./i18n/locales.ts";
import { isLocale } from "./i18n/locales.ts";
import { useLocaleSetter, useMessages } from "./i18n/react.tsx";

/**
 * The interface language picker (ADR-007). Each language is named in itself, so
 * a reader who does not understand the current language can still find theirs.
 * Switching is UI state only: no worker command, no reset, no change to history.
 */
export function LanguageSwitcher() {
  const m = useMessages();
  const setLocale = useLocaleSetter();
  const id = useId();
  const options = LOCALES.filter(locale => SELECTABLE_LOCALES.includes(locale.id) || locale.id === m.locale);
  return <div className="language-switcher">
    <label htmlFor={id} className="sr-only">{m.common.language}</label>
    <select id={id} value={m.locale} title={m.common.languageHelp}
      onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
      {options.map(locale => <option key={locale.id} value={locale.id} lang={locale.tag}>{locale.name}</option>)}
    </select>
  </div>;
}
