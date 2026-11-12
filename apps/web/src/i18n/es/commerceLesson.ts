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
  verdict: {
    invariant: { HOLDS: "SE CUMPLE", VIOLATED: "VIOLADO", PENDING: "PENDIENTE", INCOMPLETE: "INCOMPLETO" },
    expectation: { REPRODUCED: "reproducida", NOT_REPRODUCED: "no reproducida", PENDING: "pendiente", INCOMPLETE: "incompleta" },
    imported: { PASS: "SUPERADA", FAIL: "NO SUPERADA", PENDING: "PENDIENTE", INCOMPLETE: "INCOMPLETA" },
  },
  reproducedSummary: { YES: "sí", NO: "no", NOT_YET: "todavía no", INCOMPLETE: "incompleta" },
  runOutcome: {
    completed: "Ejecución completa; el resultado de negocio se muestra desde el estado registrado.",
    failed: "La ejecución falló.",
    running: "Ejecución en curso.",
    other: "Ejecución parcial o lista para empezar.",
  },
  invariantsHelp: "Propiedades que el sistema debe mantener sea cual sea su diseño. VIOLADO es lo que esta ejecución le hizo al negocio.",
  expectationsHelp: "Las expectativas del escenario confirman que la ejecución contó la historia de esta lección. No dicen nada sobre si el sistema es seguro.",
  lifecycle: (value: string, _f: Fmt) => `Ciclo de vida: ${value}`,
  noCommittedRows: "No hay filas confirmadas.",
  expiresAt: (time: number, _f: Fmt) => `vence en t=${time}`,
  noResponseYet: "Todavía no se observó ninguna respuesta.",
  deadLetterQueue: "Cola de dead letters",
  deadLetterQueueOf: (componentId: string, _f: Fmt) => `Cola de dead letters de ${componentId}`,
  noDeadLetters: "No hay mensajes en dead letter.",
  checkedAt: (time: number, _f: Fmt) => `(verificado en t=${time})`,
  showEvidence: "Mostrar evidencia",
  showEvidenceFor: (label: string, _f: Fmt) => `Mostrar evidencia: ${label}`,
  lessonChecks: "Verificaciones de la lección",
  businessInvariants: "Invariantes de negocio",
  setupReproduced: (summary: string, _f: Fmt) => `Planteo de la lección reproducido: ${summary}`,
  scenarioExpectations: "Expectativas del escenario",
  serviceStateHeading: "Conocimiento de los servicios y estado confirmado",
  aboutServiceState: "Acerca del estado de los servicios",
  serviceStateHelp: "Son hechos registrados, no predicciones. Avanzá paso a paso para inspeccionar estados intermedios; Reiniciar reproduce las mismas entradas.",
  serviceStateOf: (componentId: string, _f: Fmt) => `Estado de ${componentId}`,
};
