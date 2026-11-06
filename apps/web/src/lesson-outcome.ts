import type { RuntimeProjectionSet } from "@distlab/contracts";
import type { LessonCheckView } from "./lesson-checks.ts";

/**
 * The one-line outcome at the top of the Lesson panel's ③ Investigate (#141). Pure: it reads the
 * mapped lesson-check view and the run status only, and never re-evaluates a check.
 */

/**
 * A commerce lesson's outcome, from its business invariants. A violated invariant is the finding,
 * so it wins over pending or incomplete ones; "all hold" needs every invariant settled as HOLDS.
 * A view with no invariant rows yet (no client verdicts published) reads as pending.
 */
export function outcomeSummary(view: Pick<LessonCheckView, "invariants">): string {
  const total = view.invariants.length;
  const violated = view.invariants.filter(row => row.verdict === "VIOLATED").length;
  if (violated) return `${violated} of ${total} business invariants violated`;
  if (total && view.invariants.every(row => row.verdict === "HOLDS")) return `All ${total} business invariants hold`;
  if (!total || view.invariants.some(row => row.verdict === "PENDING")) return "Checks are pending: run the lesson";
  return "Checks are incomplete";
}

/** A checkout lesson's outcome: the Run overview's existing outcome sentence, unchanged. */
export function runOutcome(status: RuntimeProjectionSet["simulation"]["status"] | undefined): string {
  return status === "COMPLETED" ? "Execution completed; business outcome is shown from recorded state."
    : status === "FAILED" ? "Execution failed."
      : status === "RUNNING" ? "Execution in progress."
        : "Execution partial or ready.";
}

/** Whether a status ends a run: the moment ③ Investigate is revealed and its summary announced. */
export function endsRun(status: RuntimeProjectionSet["simulation"]["status"] | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED";
}
