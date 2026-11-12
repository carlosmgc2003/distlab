import type { Fmt } from "../format.ts";

/** English source messages for the `commerceLesson` area (ADR-007): CommerceLesson.tsx, lesson-checks.ts, lesson-outcome.ts. */
export const commerceLesson = {
  outcome: {
    violated: (p: { violated: number; total: number }, f: Fmt) => `${f.number(p.violated)} of ${f.number(p.total)} business invariants violated`,
    allHold: (total: number, f: Fmt) => f.plural(total, { one: "The 1 business invariant holds", other: `All ${f.number(total)} business invariants hold` }),
    pending: "Checks are pending: run the lesson",
    incomplete: "Checks are incomplete",
  },
  runOutcome: {
    completed: "Execution completed; business outcome is shown from recorded state.",
    failed: "Execution failed.",
    running: "Execution in progress.",
    other: "Execution partial or ready.",
  },
};
