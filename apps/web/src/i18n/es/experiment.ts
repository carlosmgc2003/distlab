import type { experiment as source } from "../en/experiment.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `experiment` area. Typed by the English source, so keys and parameters must match. */
export const experiment: typeof source = {
  title: "Cambiá el experimento",
  about: "Sobre el experimento",
  locked: "Los cambios no están disponibles mientras la simulación se ejecuta o hay un comando en curso.",
  pending: "Estos cambios todavía no se aplicaron. Al aplicarlos se reemplaza la sesión y se empieza de nuevo desde el tiempo de inicio de la lección, con la misma semilla. Reiniciar sigue reproduciendo el experimento aplicado.",
  apply: "Aplicar y reiniciar",
  discard: "Descartar cambios",
  close: "Cerrar",
};
