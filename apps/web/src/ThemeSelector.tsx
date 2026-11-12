import { useEffect, useId, useRef, useState } from "react";
import {
  parseThemePreference, resolveTheme, SYSTEM_DARK_QUERY, THEME_PREFERENCES, THEME_STORAGE_KEY, themeOptionLabel,
  type ThemePreference,
} from "./theme.ts";

/** Storage can be unavailable (private windows, blocked site data); the theme then lasts for the page only. */
function readStoredPreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); } catch { return "system"; }
}
function storePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch { /* the choice still applies to this page */ }
}
function systemQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === "function" ? window.matchMedia(SYSTEM_DARK_QUERY) : undefined;
}

/** One glyph per preference: a sun, a moon, and a half-filled circle for System. */
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return <svg className="theme-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
    {preference === "light" ? <>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4" />
    </> : preference === "dark" ? <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" />
      : <><circle cx="10" cy="10" r="7" /><path className="theme-icon-fill" d="M10 3a7 7 0 0 1 0 14Z" /></>}
  </svg>;
}

/**
 * The Theme selector: a compact top-bar button that opens a popover with three labelled choices,
 * System, Light, and Dark. Clicking a choice applies it and closes the popover; arrow keys apply each
 * choice as they reach it, and Escape or a click outside closes it. It writes the resolved theme to `<html data-theme>`, remembers the
 * choice in this browser, and, on System, follows the operating system as it changes.
 */
export function ThemeSelector() {
  const id = useId();
  const popoverId = `${id}-theme`;
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(() => systemQuery()?.matches ?? false);

  useEffect(() => {
    const query = systemQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = resolveTheme(preference, systemDark);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // The popover sits in the top layer; it is placed under its button, right-aligned to it, and
  // focus moves to the checked choice so arrow keys change the theme at once.
  useEffect(() => {
    const element = popover.current;
    if (!element) return;
    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open" || !button.current) return;
      const box = button.current.getBoundingClientRect();
      element.style.top = `${Math.round(box.bottom + 6)}px`;
      element.style.right = `${Math.max(8, Math.round(document.documentElement.clientWidth - box.right))}px`;
    };
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") element.querySelector<HTMLInputElement>("input:checked")?.focus();
    };
    element.addEventListener("beforetoggle", onBeforeToggle);
    element.addEventListener("toggle", onToggle);
    return () => {
      element.removeEventListener("beforetoggle", onBeforeToggle);
      element.removeEventListener("toggle", onToggle);
    };
  }, []);

  const current = themeOptionLabel(preference, systemDark);
  return <div className="theme-selector">
    <button ref={button} type="button" className="theme-trigger" popoverTarget={popoverId}
      aria-label={`Theme: ${current}`} title={`Theme: ${current}`}>
      <ThemeIcon preference={preference} />
    </button>
    <div ref={popover} id={popoverId} className="theme-popover" popover="auto">
      <fieldset>
        <legend>Theme</legend>
        {THEME_PREFERENCES.map(option => <label key={option} className="theme-choice">
          <input type="radio" name={`${id}-preference`} value={option} checked={preference === option}
            onChange={() => { setPreference(option); storePreference(option); }}
            // A pointer choice closes the popover; arrow keys (clicks with no detail) keep it open to compare.
            onClick={event => { if (event.detail > 0) popover.current?.hidePopover(); }} />
          <ThemeIcon preference={option} />
          <span>{themeOptionLabel(option, systemDark)}</span>
        </label>)}
      </fieldset>
    </div>
  </div>;
}
