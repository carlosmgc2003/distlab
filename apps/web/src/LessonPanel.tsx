import type { ReactNode } from "react";
import type { LessonStep } from "./lesson-steps.ts";

const sections = [
  ["goal", "① Goal"],
  ["run", "② Run"],
  ["investigate", "③ Investigate"],
  ["experiment", "④ Experiment"],
] as const;

/**
 * The Lesson panel (#140): the left column of the workspace, visible on both tabs. It reads as a
 * guided flow in four numbered sections. The current-step marker is emphasis only, so every section
 * stays readable and every control stays available whichever step is current. Collapsing the panel
 * leaves a rail with one visible "Show lesson" control; the shell keeps that UI state across tab
 * switches and lesson loads.
 */
export function LessonPanel({ collapsed, onCollapsedChange, step, goal, run, investigate, experiment }: {
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly step: LessonStep | null;
  readonly goal: ReactNode;
  readonly run: ReactNode;
  readonly investigate: ReactNode;
  readonly experiment: ReactNode;
}) {
  const content = { goal, run, investigate, experiment };
  return <aside className={`lesson-panel${collapsed ? " is-collapsed" : ""}`} aria-label="Lesson">
    <div className="lesson-panel-header">
      {collapsed ? null : <h2 className="lesson-panel-title">Lesson</h2>}
      <button type="button" className="lesson-panel-toggle" aria-expanded={!collapsed} aria-controls="lesson-panel-body"
        onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? "Show lesson" : "Hide lesson"}</button>
    </div>
    <div id="lesson-panel-body" className="lesson-panel-body" hidden={collapsed}>
      {sections.map(([id, heading]) => <section key={id} className={`lesson-step lesson-step-${id}`} aria-labelledby={`lesson-step-${id}`}
        aria-current={id === step ? "step" : undefined}>
        <h3><span id={`lesson-step-${id}`}>{heading}</span>
          {/* aria-current carries the marker to assistive technology; this badge is its visible text. */}
          {id === step ? <span className="lesson-step-now" aria-hidden="true">Now</span> : null}</h3>
        {content[id]}
      </section>)}
    </div>
  </aside>;
}
