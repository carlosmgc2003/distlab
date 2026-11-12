import type { common as source } from "../en/common.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `common` area. Typed by the English source, so keys and parameters must match. */
export const common: typeof source = {
  brand: "DistLab",
  language: "Idioma",
  languageHelp: "Idioma de la interfaz. La historia registrada, los IDs de componentes y los datos del escenario se muestran tal como se registraron.",
  virtualTime: (time: number | string, _f: Fmt) => `tiempo virtual ${time}`,
};
