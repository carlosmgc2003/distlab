import { useEffect, useId, useMemo, useState } from "react";
import type { LessonOverlayPolicy, ParameterOverride } from "@distlab/contracts";
import { choiceCopy, choiceValues, formatChoice, readInteger, sameChoices, setChoice } from "./design-choices.ts";

export interface DesignChoicesPanelProps {
  readonly policy: LessonOverlayPolicy;
  /** Normalized overrides the worker applied, or null when no session is loaded. */
  readonly applied: readonly ParameterOverride[] | null;
  readonly draft: readonly ParameterOverride[];
  readonly onDraftChange: (draft: readonly ParameterOverride[]) => void;
  /** False while a command is outstanding or the simulation runs. */
  readonly editable: boolean;
  /** Worker diagnostics from the last rejected load, by parameter key. */
  readonly rejected: ReadonlyMap<string, string>;
  /** Sends `load` with the packaged document and the whole draft overlay, which replaces the session. */
  readonly onApply: () => void;
  /** True when Break the system also has unapplied changes, which Apply sends too. */
  readonly faultsPending: boolean;
  /** Owned by the shell, so the panel stays open while Apply replaces the session. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Design choices (ADR-004 parameters, issue #95). The student changes the
 * settings the lesson declares; applying sends one ordinary `load`. Nothing here
 * edits a running simulation, and the seed, workload, and checks stay the lesson's.
 */
export function DesignChoicesPanel({ policy, applied, draft, onDraftChange, editable, rejected, onApply, faultsPending, open, onOpenChange }: DesignChoicesPanelProps) {
  const ids = useId();
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  // A rejected load opens the panel on the choice it names.
  useEffect(() => { if (rejected.size) onOpenChange(true); }, [rejected, onOpenChange]);
  const values = useMemo(() => choiceValues(policy, draft), [policy, draft]);
  const pending = !sameChoices(draft, applied ?? []);
  const invalid = Object.keys(errors).length > 0;
  // Restoring is the one apply that sends no choices while some are applied.
  const restoring = draft.length === 0 && !invalid && (applied?.length ?? 0) > 0;

  const set = (key: string, value: boolean | number | string) => onDraftChange(setChoice(policy, draft, key, value));
  const setText = (key: string, text: string) => {
    const parameter = policy.parameters.find(item => item.key === key)!;
    setTexts(current => ({ ...current, [key]: text }));
    const result = readInteger(text, parameter);
    setErrors(current => { const { [key]: _, ...rest } = current; return result.error ? { ...rest, [key]: result.error } : rest; });
    if (result.value !== undefined) set(key, result.value);
  };
  const reset = (overrides: readonly ParameterOverride[]) => { setTexts({}); setErrors({}); onDraftChange(overrides); };

  return <section className="design-choices" aria-labelledby={`${ids}-heading`}>
    <div className="design-choices-header">
      <h2 id={`${ids}-heading`}>Design choices</h2>
      <span className="design-choices-summary">{applied?.length
        ? applied.map(item => `${choiceCopy(item.key).label}: ${formatChoice(item.value)}`).join(" · ")
        : "The lesson’s own design is applied."}</span>
      <button type="button" aria-expanded={open} aria-controls={`${ids}-body`} onClick={() => onOpenChange(!open)}>
        {open ? "Hide design choices" : "Change design choices"}
      </button>
    </div>
    <div id={`${ids}-body`} hidden={!open} className="design-choices-body">
      {!editable ? <p className="field-help">Design choices are unavailable while the simulation runs or a command is in progress.</p> : null}
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
    {pending || invalid ? <div className="break-pending" role="note">
      <p>These choices are not applied yet. Applying them replaces the session and starts again from the lesson’s start time, with the same seed. Reset keeps replaying the applied choices.{faultsPending ? " Unapplied changes in Break the system are applied too." : ""}</p>
      <div className="break-actions">
        <button type="button" className="primary" disabled={!editable || invalid} onClick={onApply}>
          {restoring ? "Restore lesson design and reload" : "Apply choices and reload"}
        </button>
        <button type="button" disabled={!editable} onClick={() => reset(applied ?? [])}>Discard choice changes</button>
      </div>
    </div> : null}
    {applied?.length ? <p className="field-help">Lesson checks still describe the packaged lesson, so a check can FAIL under your choices. That shows how your change altered the story, not a simulator error.</p> : null}
  </section>;
}
