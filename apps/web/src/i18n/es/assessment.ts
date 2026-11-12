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
};
