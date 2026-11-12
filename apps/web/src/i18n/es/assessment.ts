import type { assessment as source } from "../en/assessment.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `assessment` area. Typed by the English source, so keys and parameters must match. */
export const assessment: typeof source = {
  suite: {
    rowStarted: (p: { index: number; total: number; label: string }, f: Fmt) => `Fila ${f.number(p.index)} de ${f.number(p.total)}: ${p.label} — en ejecución`,
    rowViolated: (p: { index: number; total: number; label: string; count: number; all: number }, f: Fmt) =>
      `Fila ${f.number(p.index)} de ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: `${f.number(p.count)} de 1 invariante violado`, other: `${f.number(p.count)} de ${f.number(p.all)} invariantes violados` })}`,
    rowIncomplete: (p: { index: number; total: number; label: string; count: number; all: number }, f: Fmt) =>
      `Fila ${f.number(p.index)} de ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: `${f.number(p.count)} de 1 invariante incompleto`, other: `${f.number(p.count)} de ${f.number(p.all)} invariantes incompletos` })}`,
    rowAllHold: (p: { index: number; total: number; label: string; all: number }, f: Fmt) =>
      `Fila ${f.number(p.index)} de ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: "se cumple el único invariante", other: `se cumplen los ${f.number(p.all)} invariantes` })}`,
    partial: (p: { run: number; total: number; passed: number }, f: Fmt) =>
      f.plural(p.total, { one: `${f.number(p.run)} de 1 fila ejecutada, ${f.plural(p.passed, { one: "1 superada", other: `${f.number(p.passed)} superadas` })}`,
        other: `${f.number(p.run)} de ${f.number(p.total)} filas ejecutadas, ${f.plural(p.passed, { one: "1 superada", other: `${f.number(p.passed)} superadas` })}` }),
    complete: (p: { passed: number; total: number }, f: Fmt) =>
      f.plural(p.total, { one: `${f.number(p.passed)} de 1 fila superada`, other: `${f.number(p.passed)} de ${f.number(p.total)} filas superadas` }),
  },
  view: {
    announce: {
      rejected: (label: string, _f: Fmt) => `La evaluación se detuvo: no se pudo cargar ${label}.`,
      failed: (label: string, _f: Fmt) => `La evaluación se detuvo: no se pudo ejecutar ${label}.`,
      stopped: (summary: string, _f: Fmt) => `Evaluación detenida: ${summary}.`,
      finished: (summary: string, _f: Fmt) => `Evaluación terminada: ${summary}.`,
    },
    yourDesign: "Tu diseño",
    goalTitle: (title: string, _f: Fmt) => `Evaluación de ${title}`,
    requirements: "Requisitos",
    runAssessment: "Ejecutar evaluación",
    stop: "Detener",
    stopping: "Deteniendo después de esta fila…",
    progress: (p: { index: number; total: number }, f: Fmt) => `Ejecutando la fila ${f.number(p.index)} de ${f.number(p.total)}…`,
    progressLabel: "Progreso de la evaluación",
    diagnosticsLabel: "Diagnósticos",
    problem: {
      rejected: "La evaluación se detuvo en <strong>{row}</strong>: el worker rechazó su carga. Se conservan las filas ya ejecutadas.",
      failed: "La evaluación no pudo continuar en <strong>{row}</strong>: {error}",
      mismatch: "Al recargar <strong>{row}</strong> se obtuvo una ejecución distinta, así que no se abrió su evidencia.",
    },
    noResults: "Todavía no hay resultados. Definí tu diseño y después ejecutá la evaluación.",
    assessedDesign: "Diseño evaluado",
    lessonDefaults: "Valores de la lección",
    showResults: "Mostrar resultados",
    exportResult: "Exportar resultado",
    experiment: {
      loadsAgain: "Cada escenario vuelve a cargar la lección base con sus propias fallas, y tu diseño se aplica a todos los escenarios. La semilla, la carga de trabajo y las verificaciones siguen siendo las de la lección.",
      noFaults: "Esta evaluación no agrega fallas propias: los escenarios son las fallas. Cambiá tu diseño en ② Ejecutar y ejecutá la evaluación de nuevo.",
    },
    matrix: {
      title: (title: string, _f: Fmt) => `${title}: resultados`,
      helpLabel: "Sobre estos resultados",
      help1: "Cada escenario es una ejecución de la lección base con las fallas de ese escenario y tu diseño. Un escenario se supera cuando se cumplen todos los invariantes de negocio. SE CUMPLE y VIOLADO son los veredictos que guardó la ejecución; INCOMPLETO significa que la ejecución terminó antes de que la verificación se resolviera.",
      help2: "Mostrar evidencia abre el registro de la verificación en el historial registrado. Solo queda cargada la ejecución del último escenario, así que abrir otro lo ejecuta de nuevo primero; las mismas entradas dan la misma ejecución.",
      caption: (title: string, _f: Fmt) => `${title}: una fila por escenario de fallas, una columna por invariante de negocio`,
      scenario: "Escenario",
      result: "Resultado",
      running: "Ejecutando…",
      reloading: "Recargando…",
      notRun: "Sin ejecutar",
      runFailed: "(falló la ejecución)",
      showEvidence: "Mostrar evidencia",
      showEvidenceFor: (p: { row: string; invariant: string }, _f: Fmt) => `Mostrar evidencia: ${p.row}, ${p.invariant}`,
    },
  },
};
