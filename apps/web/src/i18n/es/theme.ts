import type { theme as source } from "../en/theme.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `theme` area. Typed by the English source, so keys and parameters must match. */
export const theme: typeof source = {
  legend: "Tema",
  button: (current: string, _f: Fmt) => `Tema: ${current}`,
  light: "Claro",
  dark: "Oscuro",
  system: (dark: boolean, _f: Fmt) => `Sistema (${dark ? "oscuro" : "claro"})`,
};
