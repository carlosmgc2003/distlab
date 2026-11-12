import type { RuntimeProjectionSet } from "@distlab/contracts";
import type { LessonCheckView } from "./lesson-checks.ts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * The one-line outcome at the top of the Lesson panel's ③ Investigate (#141). Pure: it reads the
 * mapped lesson-check view and the run status only, and never re-evaluates a check.
 */

/**
 * A commerce lesson's outcome, from its business invariants. A violated invariant is the finding,
 * so it wins over pending or incomplete ones; "all hold" needs every invariant settled as HOLDS.
 * A view with no invariant rows yet (no client verdicts published) reads as pending.
 */
export function outcomeSummary(view: Pick<LessonCheckView, "invariants">, m: Messages): string {
  const total = view.invariants.length;
  const violated = view.invariants.filter(row => row.verdict === "VIOLATED").length;
  if (violated) return m.commerceLesson.outcome.violated({ violated, total });
  if (total && view.invariants.every(row => row.verdict === "HOLDS")) return m.commerceLesson.outcome.allHold(total);
  if (!total || view.invariants.some(row => row.verdict === "PENDING")) return m.commerceLesson.outcome.pending;
  return m.commerceLesson.outcome.incomplete;
}

/** A checkout lesson's outcome: the Run overview's existing outcome sentence, unchanged. */
export function runOutcome(status: RuntimeProjectionSet["simulation"]["status"] | undefined, m: Messages): string {
  const copy = m.commerceLesson.runOutcome;
  return status === "COMPLETED" ? copy.completed : status === "FAILED" ? copy.failed : status === "RUNNING" ? copy.running : copy.other;
}

/** Whether a status ends a run: the moment ③ Investigate is revealed and its summary announced. */
export function endsRun(status: RuntimeProjectionSet["simulation"]["status"] | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED";
}
