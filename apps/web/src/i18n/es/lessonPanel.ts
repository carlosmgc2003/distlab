import type { lessonPanel as source } from "../en/lessonPanel.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `lessonPanel` area. Typed by the English source, so keys and parameters must match. */
export const lessonPanel: typeof source = {
  label: "Lección",
  title: "Lección",
  show: "Mostrar la lección",
  hide: "Ocultar la lección",
  now: "Ahora",
  sections: { goal: "① Objetivo", run: "② Ejecutar", investigate: "③ Investigar", experiment: "④ Experimentar" },
};
