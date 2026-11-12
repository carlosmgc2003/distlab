import type { commerceLesson as source } from "../en/commerceLesson.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `commerceLesson` area. Typed by the English source, so keys and parameters must match. */
export const commerceLesson: typeof source = {
  outcome: {
    violated: (p: { violated: number; total: number }, f: Fmt) => f.plural(p.total, {
      one: `${f.number(p.violated)} de 1 invariante de negocio violado`,
      other: `${f.number(p.violated)} de ${f.number(p.total)} invariantes de negocio violados`,
    }),
    allHold: (total: number, f: Fmt) => f.plural(total, { one: "El único invariante de negocio se cumple", other: `Se cumplen los ${f.number(total)} invariantes de negocio` }),
    pending: "Las verificaciones están pendientes: ejecutá la lección",
    incomplete: "Las verificaciones están incompletas",
  },
  runOutcome: {
    completed: "Ejecución completa; el resultado de negocio se muestra desde el estado registrado.",
    failed: "La ejecución falló.",
    running: "Ejecución en curso.",
    other: "Ejecución parcial o lista para empezar.",
  },
};
