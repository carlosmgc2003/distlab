import type { Fmt } from "../format.ts";

/** English source messages for the `theme` area (ADR-007): ThemeSelector.tsx and theme.ts. */
export const theme = {
  legend: "Theme",
  button: (current: string, _f: Fmt) => `Theme: ${current}`,
  light: "Light",
  dark: "Dark",
  /** System names the theme it currently resolves to, so the choice is never a guess. */
  system: (dark: boolean, _f: Fmt) => `System (${dark ? "dark" : "light"})`,
};
