import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { LessonStep } from "./lesson-steps.ts";
import { useMessages } from "./i18n/react.tsx";

const sections = ["goal", "run", "investigate", "experiment"] as const;

/**
 * The Lesson panel (#140): the left column of the workspace, visible on both tabs. It reads as a
 * guided flow in four numbered sections. The current-step marker is emphasis only, so every section
 * stays readable and every control stays available whichever step is current. Collapsing the panel
 * leaves a rail with one visible "Show lesson" control; the shell keeps that UI state across tab
 * switches and lesson loads.
 *
 * Each new `revealInvestigate` token (#141: a run ended) scrolls ③ Investigate into view inside the
 * panel. It never moves focus and never expands a collapsed panel.
 */
export function LessonPanel({ collapsed, onCollapsedChange, step, goal, run, investigate, experiment, revealInvestigate = 0 }: {
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly step: LessonStep | null;
  readonly goal: ReactNode;
  readonly run: ReactNode;
  readonly investigate: ReactNode;
  readonly experiment: ReactNode;
  /** A counter the shell increments once per ended run. */
  readonly revealInvestigate?: number;
}) {
  const m = useMessages();
  const content = { goal, run, investigate, experiment };
  const investigateSection = useRef<HTMLElement>(null);
  // Only a token newer than the one the panel mounted with reveals: collapsing and expanding the panel,
  // or mounting it again, does not scroll it again.
  const revealed = useRef(revealInvestigate);
  useEffect(() => {
    if (revealInvestigate === revealed.current) return;
    revealed.current = revealInvestigate;
    if (collapsed) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    investigateSection.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [revealInvestigate, collapsed]);
  return <aside className={`lesson-panel${collapsed ? " is-collapsed" : ""}`} aria-label={m.lessonPanel.label}>
    <div className="lesson-panel-header">
      {collapsed ? null : <h2 className="lesson-panel-title">{m.lessonPanel.title}</h2>}
      <button type="button" className="lesson-panel-toggle" aria-expanded={!collapsed} aria-controls="lesson-panel-body"
        onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? m.lessonPanel.show : m.lessonPanel.hide}</button>
    </div>
    <div id="lesson-panel-body" className="lesson-panel-body" hidden={collapsed}>
      {sections.map(id => <section key={id} ref={id === "investigate" ? investigateSection : undefined} className={`lesson-step lesson-step-${id}`} aria-labelledby={`lesson-step-${id}`}
        aria-current={id === step ? "step" : undefined}>
        <h3><span id={`lesson-step-${id}`}>{m.lessonPanel.sections[id]}</span>
          {/* aria-current carries the marker to assistive technology; this badge is its visible text. */}
          {id === step ? <span className="lesson-step-now" aria-hidden="true">{m.lessonPanel.now}</span> : null}</h3>
        {content[id]}
      </section>)}
    </div>
  </aside>;
}
