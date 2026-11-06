import type { RuntimeProjectionSet } from "@distlab/contracts";

/** The Lesson panel's numbered sections that can carry the current-step marker (#140). */
export type LessonStep = "run" | "investigate";

/**
 * Which Lesson panel section carries `aria-current="step"`. It is emphasis only: nothing is
 * disabled or hidden by it.
 *
 * ② Run while the session is READY or PAUSED and no event has been processed; ③ Investigate once
 * the run is COMPLETED or FAILED. Otherwise, including while a run is in progress and while no
 * session is loaded, no section is current.
 */
export function currentStep(status: RuntimeProjectionSet["simulation"]["status"] | undefined, processedEvents: number | undefined): LessonStep | null {
  if (status === "COMPLETED" || status === "FAILED") return "investigate";
  if ((status === "READY" || status === "PAUSED") && processedEvents === 0) return "run";
  return null;
}
