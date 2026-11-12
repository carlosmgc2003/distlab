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
};
