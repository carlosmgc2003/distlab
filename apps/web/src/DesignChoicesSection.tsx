import { useEffect, useId, useMemo, useState } from "react";
import type { LessonOverlayPolicy, ParameterOverride } from "@distlab/contracts";
import { choiceCopy, choiceValues, formatChoice, readInteger, setChoice } from "./design-choices.ts";

/** Why the setup checks can read "not reproduced" under a student's choices. It is in the Experiment drawer's hint (#147). */
export const DESIGN_CHOICES_HELP = "Business invariants report what your choices achieve. The setup checks still describe the packaged lesson, so one can read \"not reproduced\" under your choices. That shows how your change altered the story, not a simulator error.";

export interface DesignChoicesSectionProps {
  readonly policy: LessonOverlayPolicy;
  readonly draft: readonly ParameterOverride[];
  readonly onDraftChange: (draft: readonly ParameterOverride[]) => void;
  /** False while a command is outstanding or the simulation runs. */
  readonly editable: boolean;
  /** Worker diagnostics from the last rejected load, by parameter key. */
  readonly rejected: ReadonlyMap<string, string>;
  /** Reports whether a field holds text that is not a value, so the drawer can withhold Apply. */
  readonly onInvalidChange: (invalid: boolean) => void;
  /** Changes when the drawer discards the draft, so half-typed field text is cleared too. */
  readonly resetToken: number;
}

/**
 * Design choices (ADR-004 parameters, issue #95), a section of the Experiment
 * drawer (#143). The student changes the settings the lesson declares; the
 * drawer's one Apply sends them with the faults in one ordinary `load`. Nothing
 * here edits a running simulation, and the seed, workload, and checks stay the lesson's.
 * While it is not editable, the drawer's footer says so; the reasoning is in the drawer's hint (#147).
 */
export function DesignChoicesSection({ policy, draft, onDraftChange, editable, rejected, onInvalidChange, resetToken }: DesignChoicesSectionProps) {
  const ids = useId();
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const values = useMemo(() => choiceValues(policy, draft), [policy, draft]);
  const invalid = Object.keys(errors).length > 0;
  useEffect(() => { onInvalidChange(invalid); }, [invalid, onInvalidChange]);
  // Discarding the draft also clears text that never became a value.
  useEffect(() => { setTexts({}); setErrors({}); }, [resetToken]);

  const set = (key: string, value: boolean | number | string) => onDraftChange(setChoice(policy, draft, key, value));
  const setText = (key: string, text: string) => {
    const parameter = policy.parameters.find(item => item.key === key)!;
    setTexts(current => ({ ...current, [key]: text }));
    const result = readInteger(text, parameter);
    setErrors(current => { const { [key]: _, ...rest } = current; return result.error ? { ...rest, [key]: result.error } : rest; });
    if (result.value !== undefined) set(key, result.value);
  };

  return <section className="design-choices" aria-labelledby={`${ids}-heading`}>
    <h3 id={`${ids}-heading`}>Design choices</h3>
    <div className="design-choices-body">
      <div className="design-choices-grid">
        {policy.parameters.map(parameter => {
          const key = parameter.key;
          const id = `${ids}-${key}`;
          const { label, hint } = choiceCopy(key);
          const value = values.get(key);
          const error = errors[key] ?? rejected.get(key);
          const defaultText = `Lesson default: ${formatChoice(parameter.domain.default)}.`;
          const describedBy = [`${id}-hint`, error ? `${id}-error` : ""].filter(Boolean).join(" ");
          const domain = parameter.domain;
          return <div key={key} className={`design-choice${value !== domain.default ? " is-changed" : ""}`}>
            {domain.type === "boolean" ? <label className="design-choice-toggle">
              <input id={id} type="checkbox" checked={value === true} disabled={!editable} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
                onChange={event => set(key, event.target.checked)} />
              {label}
            </label> : <>
              <label htmlFor={id}>{label}</label>
              {domain.type === "integer"
                ? <input id={id} type="number" inputMode="numeric" min={domain.minimum} max={domain.maximum} step={1} autoComplete="off"
                    value={texts[key] ?? String(value)} disabled={!editable} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
                    onChange={event => setText(key, event.target.value)} />
                : <select id={id} value={String(value)} disabled={!editable} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
                    onChange={event => set(key, event.target.value)}>
                    {domain.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>}
            </>}
            <span id={`${id}-hint`} className="field-help">{hint ? `${hint} ` : ""}{defaultText}</span>
            {error ? <span id={`${id}-error`} className="field-error">{error}</span> : null}
          </div>;
        })}
      </div>
    </div>
  </section>;
}
