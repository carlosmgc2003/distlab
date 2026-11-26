/** The Lesson panel's numbered sections that can carry the current-step marker (#140). */
export type LessonStep = "run" | "investigate";

/** What the marker reads: whether a session is loaded, and where the playhead is (RFC 0002 P5). */
export interface LessonStepInput {
  readonly loaded: boolean;
  /** The playhead stands before the first record: the run has not executed, or it has not moved yet. */
  readonly atStart: boolean;
  /** The outcome has been revealed: the playhead has reached the end of the run once. */
  readonly revealed: boolean;
}

/**
 * Which Lesson panel section carries `aria-current="step"`. It is emphasis only: nothing is
 * disabled or hidden by it.
 *
 * ② Run until the playhead leaves the start; ③ Investigate once it has reached the end of the run,
 * also after it moves back. In between, and while no session is loaded, no section is current.
 */
export function currentStep({ loaded, atStart, revealed }: LessonStepInput): LessonStep | null {
  if (!loaded) return null;
  if (revealed) return "investigate";
  return atStart ? "run" : null;
}
