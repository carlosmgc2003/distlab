import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LanguageSwitcher } from "./LanguageSwitcher.tsx";
import { lessonPairs } from "./lesson-pairs.ts";
import { groupConcepts, lessonMatches, topicList, topicSections, type TopicFilter } from "./lesson-topics.ts";
import type { PackagedAssessment, PackagedScenario } from "./scenarios.ts";
import { assessmentDescription, assessmentTitle, experimentLabel, lessonDescription } from "./scenarios.ts";
import { designStepUnavailable } from "./design-step.ts";
import { useMessages } from "./i18n/react.tsx";

/**
 * The modal Lesson chooser (#139). It lists the packaged lessons as their failing/fixed pairs,
 * sorted into course topics (`lesson-topics.ts`), with a topic filter and a search box. Choosing a
 * lesson is the whole load: the shell closes the dialog and loads the lesson without an overlay.
 * The dialog itself sends nothing; it only reports which lesson was chosen. Filters are UI state:
 * the shell remounts the dialog for each opening, so every opening starts from `initialTopic`.
 */
export function LessonChooser({ open, lessons, assessments = [], current, busy, discardsDraft, initialTopic = "all", onChoose, onChooseAssessment, onClose }: {
  readonly open: boolean;
  readonly lessons: readonly PackagedScenario[];
  /** Packaged assessments (#97, D-7), listed in their own group after the lesson pairs. */
  readonly assessments?: readonly PackagedAssessment[];
  /** The loaded packaged lesson, marked with `aria-current`. */
  readonly current: string | null;
  readonly busy: boolean;
  /** The draft overlay has unapplied changes, which choosing a lesson discards. */
  readonly discardsDraft: boolean;
  /** The topic the filter starts on, for an opener that names one. */
  readonly initialTopic?: TopicFilter;
  readonly onChoose: (id: string) => void;
  /** Choosing an assessment opens it; the shell loads its base lesson. Its ID is marked `aria-current` as `assessment:<id>`. */
  readonly onChooseAssessment?: (id: string) => void;
  /** Escape and Cancel close the dialog without changes. */
  readonly onClose: () => void;
}) {
  const m = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = useMemo(() => lessonPairs(lessons), [lessons]);
  const [topic, setTopic] = useState<TopicFilter>(initialTopic);
  const [query, setQuery] = useState("");
  const sections = useMemo(() => topicSections(groups, topic, query, m), [groups, topic, query, m]);
  const shown = sections.reduce((total, section) => total + section.groups.reduce((sum, group) => sum + group.length, 0), 0);
  const shownAssessments = topic === "all" ? assessments.filter(item => lessonMatches(item, query, m)) : [];
  const ids = useId();
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
    <div className="lesson-chooser-heading"><h2 id="lesson-chooser-title">Choose a lesson</h2><LanguageSwitcher /></div>
    {discardsDraft ? <p className="lesson-chooser-discard">Choosing a lesson discards your unapplied design choices and faults.</p> : null}
    <div className="lesson-chooser-filters">
      <div className="lesson-topic-filter" role="group" aria-label="Topic">
        {[{ id: "all" as const, title: "All topics" }, ...topicList(m)].map(item =>
          <button key={item.id} type="button" aria-pressed={topic === item.id} onClick={() => setTopic(item.id)}>{item.title}</button>)}
      </div>
      <label className="lesson-search">
        <span>Search</span>
        <input type="search" value={query} placeholder="Concept, pattern, or failure" onChange={event => setQuery(event.currentTarget.value)} />
      </label>
      <p className="lesson-chooser-count" role="status" aria-live="polite">
        {shown === lessons.length ? `${lessons.length} lessons` : `${shown} of ${lessons.length} lessons`}
      </p>
    </div>
    {sections.map(section => <section key={section.topic.id} className="lesson-topic" aria-labelledby={`${ids}-${section.topic.id}`}
      aria-describedby={`${ids}-${section.topic.id}-summary`}>
      <h3 id={`${ids}-${section.topic.id}`}>{section.topic.title}</h3>
      <p id={`${ids}-${section.topic.id}-summary`} className="lesson-topic-summary">{section.topic.summary}</p>
      <ul className="lesson-cards" aria-label={`${section.topic.title} lessons`}>
        {section.groups.map(group => <li key={group[0]!.id} className="lesson-card">
          <p className="lesson-card-concepts"><span className="sr-only">Concepts: </span>{groupConcepts(group, m).join(" · ")}</p>
          <ul className="lesson-card-lessons">
            {group.map(lesson => <li key={lesson.id}>
              <button type="button" className="lesson-choice" data-lesson-id={lesson.id} disabled={busy}
                aria-current={lesson.id === current ? "true" : undefined}
                aria-labelledby={`lesson-choice-${lesson.id}`} aria-describedby={`lesson-choice-${lesson.id}-description`}
                onClick={() => onChoose(lesson.id)}>
                <span id={`lesson-choice-${lesson.id}`} className="lesson-choice-title">{experimentLabel(lesson, m)}</span>
                <span id={`lesson-choice-${lesson.id}-description`} className="lesson-choice-description">{lessonDescription(lesson, m)}
                  {/* Inside the description, so the notice is read wherever the instruction is (#164). */}
                  {designStepUnavailable(lesson.policy) ? <span className="design-step-notice"> {m.designChoices.stepNotice}</span> : null}</span>
                {/* aria-current carries this to assistive technology; the badge is its visible text. */}
                {lesson.id === current ? <span className="lesson-choice-current" aria-hidden="true">Loaded</span> : null}
              </button>
            </li>)}
          </ul>
        </li>)}
      </ul>
    </section>)}
    {shown === 0 && shownAssessments.length === 0 ? <p className="lesson-chooser-empty">No lesson matches. Clear the search or choose All topics.</p> : null}
    {shownAssessments.length ? <section className="lesson-chooser-assessments" aria-labelledby="lesson-chooser-assessments-title">
      <h3 id="lesson-chooser-assessments-title">Assessment</h3>
      <ul className="lesson-cards" aria-label="Assessments">
        {shownAssessments.map(assessment => <li key={assessment.id} className="lesson-card">
          <button type="button" className="lesson-choice" data-assessment-id={assessment.id} disabled={busy}
            aria-current={`assessment:${assessment.id}` === current ? "true" : undefined}
            aria-labelledby={`assessment-choice-${assessment.id}`} aria-describedby={`assessment-choice-${assessment.id}-description`}
            onClick={() => onChooseAssessment?.(assessment.id)}>
            <span id={`assessment-choice-${assessment.id}`} className="lesson-choice-title">{assessmentTitle(assessment, m)}</span>
            <span id={`assessment-choice-${assessment.id}-description`} className="lesson-choice-description">{assessmentDescription(assessment, m)}</span>
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
