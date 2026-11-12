import type { Fmt } from "../format.ts";

/** English source messages for the `assessment` area (ADR-007). */
export const assessment = {
  /** Words of assessment.ts: the suite's live-region announcements. */
  suite: {
    rowStarted: (p: { index: number; total: number; label: string }, f: Fmt) => `Row ${f.number(p.index)} of ${f.number(p.total)}: ${p.label} — running`,
    rowViolated: (p: { index: number; total: number; label: string; count: number; all: number }, f: Fmt) =>
      `Row ${f.number(p.index)} of ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: `${f.number(p.count)} of 1 invariant violated`, other: `${f.number(p.count)} of ${f.number(p.all)} invariants violated` })}`,
    rowIncomplete: (p: { index: number; total: number; label: string; count: number; all: number }, f: Fmt) =>
      `Row ${f.number(p.index)} of ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: `${f.number(p.count)} of 1 invariant incomplete`, other: `${f.number(p.count)} of ${f.number(p.all)} invariants incomplete` })}`,
    rowAllHold: (p: { index: number; total: number; label: string; all: number }, f: Fmt) =>
      `Row ${f.number(p.index)} of ${f.number(p.total)}: ${p.label} — ${f.plural(p.all, { one: "the 1 invariant holds", other: `all ${f.number(p.all)} invariants hold` })}`,
    partial: (p: { run: number; total: number; passed: number }, f: Fmt) =>
      f.plural(p.total, { one: `${f.number(p.run)} of 1 row run, ${f.number(p.passed)} pass`, other: `${f.number(p.run)} of ${f.number(p.total)} rows run, ${f.number(p.passed)} pass` }),
    complete: (p: { passed: number; total: number }, f: Fmt) =>
      f.plural(p.total, { one: `${f.number(p.passed)} of 1 row pass`, other: `${f.number(p.passed)} of ${f.number(p.total)} rows pass` }),
  },
};
