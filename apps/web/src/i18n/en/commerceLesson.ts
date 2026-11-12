import type { Fmt } from "../format.ts";

/** English source messages for the `commerceLesson` area (ADR-007): CommerceLesson.tsx, lesson-checks.ts, lesson-outcome.ts. */
export const commerceLesson = {
  outcome: {
    violated: (p: { violated: number; total: number }, f: Fmt) => `${f.number(p.violated)} of ${f.number(p.total)} business invariants violated`,
    allHold: (total: number, f: Fmt) => f.plural(total, { one: "The 1 business invariant holds", other: `All ${f.number(total)} business invariants hold` }),
    pending: "Checks are pending: run the lesson",
    incomplete: "Checks are incomplete",
  },
  /** Verdict words by code. The codes, not these words, are compared, mapped to marks, and used as CSS tokens. */
  verdict: {
    invariant: { HOLDS: "HOLDS", VIOLATED: "VIOLATED", PENDING: "PENDING", INCOMPLETE: "INCOMPLETE" },
    expectation: { REPRODUCED: "reproduced", NOT_REPRODUCED: "not reproduced", PENDING: "pending", INCOMPLETE: "incomplete" },
    /** An imported document keeps the verdict its catalog predicate stored (ADR-006). */
    imported: { PASS: "PASS", FAIL: "FAIL", PENDING: "PENDING", INCOMPLETE: "INCOMPLETE" },
  },
  /** The one-line summary of the expectations, by code. */
  reproducedSummary: { YES: "yes", NO: "no", NOT_YET: "not yet", INCOMPLETE: "incomplete" },
  runOutcome: {
    completed: "Execution completed; business outcome is shown from recorded state.",
    failed: "Execution failed.",
    running: "Execution in progress.",
    other: "Execution partial or ready.",
  },
  /** What the two lists of lesson checks mean; shown in the one hint of ③ Investigate. */
  invariantsHelp: "Properties the system must keep whatever its design. VIOLATED is what this run did to the business.",
  expectationsHelp: "Scenario expectations confirm that the run told this lesson's story. They say nothing about whether the system is safe.",
  lifecycle: (value: string, _f: Fmt) => `Lifecycle: ${value}`,
  noCommittedRows: "No committed rows.",
  expiresAt: (time: number, _f: Fmt) => `expires at t=${time}`,
  noResponseYet: "No response observed yet.",
  deadLetterQueue: "Dead-letter queue",
  deadLetterQueueOf: (componentId: string, _f: Fmt) => `${componentId} dead-letter queue`,
  noDeadLetters: "No dead-lettered messages.",
  checkedAt: (time: number, _f: Fmt) => `(checked at t=${time})`,
  showEvidence: "Show evidence",
  showEvidenceFor: (label: string, _f: Fmt) => `Show evidence: ${label}`,
  lessonChecks: "Lesson checks",
  businessInvariants: "Business invariants",
  setupReproduced: (summary: string, _f: Fmt) => `Lesson setup reproduced: ${summary}`,
  scenarioExpectations: "Scenario expectations",
  serviceStateHeading: "Service knowledge and committed state",
  aboutServiceState: "About service state",
  serviceStateHelp: "These are recorded facts, not predictions. Step to inspect intermediate states; Reset replays the same inputs.",
  serviceStateOf: (componentId: string, _f: Fmt) => `${componentId} state`,
};
