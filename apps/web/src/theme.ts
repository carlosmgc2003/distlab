/**
 * The color theme is presentation only: it never enters projections, worker commands, or history.
 * The reader picks System, Light, or Dark; System follows the operating system's preference.
 * `<html data-theme>` always holds the resolved theme, which `architecture.css` reads.
 *
 * index.html repeats `THEME_STORAGE_KEY` and `resolveTheme` in a small inline script, so the first
 * paint already uses the stored theme. Keep the two in step.
 */
import type { Messages } from "./i18n/catalog.ts";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "distlab-theme";
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** The selector's options, in order. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** A stored value, or anything else, as a preference; unknown values fall back to System. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}

/** The option's visible text. System names the theme it currently resolves to, so the choice is never a guess. */
export function themeOptionLabel(preference: ThemePreference, systemPrefersDark: boolean, m: Messages): string {
  if (preference === "light") return m.theme.light;
  if (preference === "dark") return m.theme.dark;
  return m.theme.system(systemPrefersDark);
}
