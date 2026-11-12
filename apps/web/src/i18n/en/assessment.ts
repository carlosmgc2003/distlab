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
  /** The assessment view (AssessmentView.tsx). Announcements are stored as descriptors and worded at render. */
  view: {
    announce: {
      rejected: (label: string, _f: Fmt) => `The assessment stopped: ${label} could not be loaded.`,
      failed: (label: string, _f: Fmt) => `The assessment stopped: ${label} could not be run.`,
      stopped: (summary: string, _f: Fmt) => `Assessment stopped: ${summary}.`,
      finished: (summary: string, _f: Fmt) => `Assessment finished: ${summary}.`,
    },
    yourDesign: "Your design",
    goalTitle: (title: string, _f: Fmt) => `${title} assessment`,
    requirements: "Requirements",
    runAssessment: "Run assessment",
    stop: "Stop",
    stopping: "Stopping after this row…",
    progress: (p: { index: number; total: number }, f: Fmt) => `Running row ${f.number(p.index)} of ${f.number(p.total)}…`,
    progressLabel: "Assessment progress",
    diagnosticsLabel: "Diagnostics",
    problem: {
      rejected: "The assessment stopped at <strong>{row}</strong>: the worker rejected its load. The rows already run are kept.",
      failed: "The assessment could not continue at <strong>{row}</strong>: {error}",
      mismatch: "Reloading <strong>{row}</strong> gave a different run, so its evidence was not opened.",
    },
    noResults: "No results yet. Set your design, then run the assessment.",
    assessedDesign: "Assessed design",
    lessonDefaults: "Lesson defaults",
    showResults: "Show results",
    exportResult: "Export result",
    experiment: {
      loadsAgain: "Each scenario loads the base lesson again with its own faults, and your design applies to every scenario. The seed, the workload, and the checks stay the lesson's.",
      noFaults: "This assessment adds no faults of your own: the scenarios are the faults. Change your design in ② Run and run the assessment again.",
    },
    matrix: {
      title: (title: string, _f: Fmt) => `${title}: results`,
      helpLabel: "About these results",
      help1: "Each scenario is one run of the base lesson with that scenario's faults and your design. A scenario passes when every business invariant holds. HOLDS and VIOLATED are the verdicts the run stored; INCOMPLETE means the run ended before the check settled.",
      help2: "Show evidence opens the check's record in Recorded history. Only the last scenario's run stays loaded, so opening another one runs it again first; the same inputs give the same run.",
      caption: (title: string, _f: Fmt) => `${title}: one row per fault scenario, one column per business invariant`,
      scenario: "Scenario",
      result: "Result",
      running: "Running…",
      reloading: "Reloading…",
      notRun: "Not run",
      runFailed: "(run failed)",
      showEvidence: "Show evidence",
      showEvidenceFor: (p: { row: string; invariant: string }, _f: Fmt) => `Show evidence: ${p.row}, ${p.invariant}`,
    },
  },
};
