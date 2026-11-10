import { useEffect, useMemo, useRef } from "react";
import { lessonPairs } from "./lesson-pairs.ts";
import type { PackagedScenario } from "./scenarios.ts";
import { experimentLabel } from "./scenarios.ts";
import { DESIGN_STEP_NOTICE, designStepUnavailable } from "./design-step.ts";

/**
 * The modal Lesson chooser (#139). It lists the packaged lessons as their failing/fixed pairs, and
 * choosing one is the whole load: the shell closes the dialog and loads the lesson without an
 * overlay. The dialog itself sends nothing; it only reports which lesson was chosen.
 */
export function LessonChooser({ open, lessons, assessments = [], current, busy, discardsDraft, onChoose, onChooseAssessment, onClose }: {
  readonly open: boolean;
  readonly lessons: readonly PackagedScenario[];
  /** Packaged assessments (#97, D-7), listed in their own group after the lesson pairs. */
  readonly assessments?: readonly { readonly id: string; readonly title: string; readonly description: string }[];
  /** The loaded packaged lesson, marked with `aria-current`. */
  readonly current: string | null;
  readonly busy: boolean;
  /** The draft overlay has unapplied changes, which choosing a lesson discards. */
  readonly discardsDraft: boolean;
  readonly onChoose: (id: string) => void;
  /** Choosing an assessment opens it; the shell loads its base lesson. Its ID is marked `aria-current` as `assessment:<id>`. */
  readonly onChooseAssessment?: (id: string) => void;
  /** Escape and Cancel close the dialog without changes. */
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = useMemo(() => lessonPairs(lessons), [lessons]);
  // The dialog may close natively (Escape): the shell's state follows it, never the reverse.
  const expected = useRef(open);
  expected.current = open;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // Focus starts on the loaded lesson or assessment, or on the first lesson before any load.
      (element.querySelector<HTMLButtonElement>("[aria-current='true']") ?? element.querySelector<HTMLButtonElement>("[data-lesson-id]"))?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  return <dialog ref={dialog} className="lesson-chooser" role="dialog" aria-modal="true" aria-labelledby="lesson-chooser-title"
    onClose={() => { if (expected.current) onClose(); }}>
    <h2 id="lesson-chooser-title">Choose a lesson</h2>
    {discardsDraft ? <p className="lesson-chooser-discard">Choosing a lesson discards your unapplied design choices and faults.</p> : null}
    <ul className="lesson-cards" aria-label="Lesson pairs">
      {groups.map(group => <li key={group[0]!.id} className="lesson-card">
        <ul className="lesson-card-lessons">
          {group.map(lesson => <li key={lesson.id}>
            <button type="button" className="lesson-choice" data-lesson-id={lesson.id} disabled={busy}
              aria-current={lesson.id === current ? "true" : undefined}
              aria-labelledby={`lesson-choice-${lesson.id}`} aria-describedby={`lesson-choice-${lesson.id}-description`}
              onClick={() => onChoose(lesson.id)}>
              <span id={`lesson-choice-${lesson.id}`} className="lesson-choice-title">{experimentLabel(lesson)}</span>
              <span id={`lesson-choice-${lesson.id}-description`} className="lesson-choice-description">{lesson.description}
                {/* Inside the description, so the notice is read wherever the instruction is (#164). */}
                {designStepUnavailable(lesson.policy) ? <span className="design-step-notice"> {DESIGN_STEP_NOTICE}</span> : null}</span>
              {/* aria-current carries this to assistive technology; the badge is its visible text. */}
              {lesson.id === current ? <span className="lesson-choice-current" aria-hidden="true">Loaded</span> : null}
            </button>
          </li>)}
        </ul>
      </li>)}
    </ul>
    {assessments.length ? <section className="lesson-chooser-assessments" aria-labelledby="lesson-chooser-assessments-title">
      <h3 id="lesson-chooser-assessments-title">Assessment</h3>
      <ul className="lesson-cards" aria-label="Assessments">
        {assessments.map(assessment => <li key={assessment.id} className="lesson-card">
          <button type="button" className="lesson-choice" data-assessment-id={assessment.id} disabled={busy}
            aria-current={`assessment:${assessment.id}` === current ? "true" : undefined}
            aria-labelledby={`assessment-choice-${assessment.id}`} aria-describedby={`assessment-choice-${assessment.id}-description`}
            onClick={() => onChooseAssessment?.(assessment.id)}>
            <span id={`assessment-choice-${assessment.id}`} className="lesson-choice-title">{assessment.title}</span>
            <span id={`assessment-choice-${assessment.id}-description`} className="lesson-choice-description">{assessment.description}</span>
            {`assessment:${assessment.id}` === current ? <span className="lesson-choice-current" aria-hidden="true">Loaded</span> : null}
          </button>
        </li>)}
      </ul>
    </section> : null}
    <div className="lesson-chooser-footer">
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  </dialog>;
}
