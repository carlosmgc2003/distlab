import { useEffect, useId, useMemo, useState } from "react";
import type { CanonicalValue, ScenarioDiagnostic } from "@distlab/contracts";
import { readInteger } from "./design-choices.ts";
import {
  controlAvailable, designControls, editCount, placeDesignDiagnostics, setBinding, setResource, setSlotModel, setSlotOption, setSubscription,
} from "./design-edits.ts";
import type { DesignContext, DesignControl, DesignDraft } from "./design-edits.ts";

/** What the Architecture section is for. It is in the Experiment drawer's hint (#147). */
export const DESIGN_EDITS_HELP = "Design edits change the lesson's architecture: the model that fills a slot, a peer it calls, the resources a service owns, and the destinations it subscribes to. Only the edits this lesson allows are offered, and Apply and restart is what checks that a design is valid.";

export interface ArchitectureSectionProps {
  readonly context: DesignContext;
  readonly draft: DesignDraft;
  readonly onDraftChange: (draft: DesignDraft) => void;
  /** False while a command is outstanding or the simulation runs. */
  readonly editable: boolean;
  /** Diagnostics from the last rejected load, and the edits they point into. */
  readonly rejected: { readonly edits: DesignDraft; readonly diagnostics: readonly ScenarioDiagnostic[] } | null;
  /** Reports whether a field holds text that is not a value, so the drawer can withhold Apply. */
  readonly onInvalidChange: (invalid: boolean) => void;
  /** Changes when the drawer discards the draft, so half-typed field text is cleared too. */
  readonly resetToken: number;
}

/**
 * Design edits (ADR-005, #112), the first section of the Experiment drawer. One control per entry
 * of the lesson's architecture allowance; the draft joins the one draft overlay, and the drawer's
 * one Apply sends it in an ordinary `load`. Nothing here decides that a design is valid: a
 * rejected load places each diagnostic on the control its path points to.
 */
export function ArchitectureSection({ context, draft, onDraftChange, editable, rejected, onInvalidChange, resetToken }: ArchitectureSectionProps) {
  const ids = useId();
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const controls = useMemo(() => designControls(context, draft), [context, draft]);
  const placed = useMemo(() => rejected ? placeDesignDiagnostics(rejected.diagnostics, rejected.edits, context.allowance.maxEdits) : { controls: new Map<string, readonly string[]>(), general: [] },
    [rejected, context.allowance.maxEdits]);
  const invalid = Object.keys(errors).length > 0;
  useEffect(() => { onInvalidChange(invalid); }, [invalid, onInvalidChange]);
  useEffect(() => { setTexts({}); setErrors({}); }, [resetToken]);
  const count = editCount(draft);

  const change = (control: DesignControl, value: CanonicalValue) => {
    switch (control.kind) {
      case "slot": return onDraftChange(setSlotModel(context, draft, control.component, String(value)));
      case "option": return onDraftChange(setSlotOption(context, draft, control.component, control.key, value));
      case "binding": return onDraftChange(setBinding(context, draft, control.component, control.peer, String(value)));
      case "resource": return onDraftChange(setResource(context, draft, control.owner, control.resource, value === true));
      case "subscription": return onDraftChange(setSubscription(context, draft, control.consumer, control.destination, value === true));
    }
  };
  const setText = (control: DesignControl & { kind: "option" }, text: string) => {
    setTexts(current => ({ ...current, [control.id]: text }));
    const result = readInteger(text, { key: control.key, domain: control.domain, targets: [] });
    setErrors(current => { const { [control.id]: _, ...rest } = current; return result.error ? { ...rest, [control.id]: result.error } : rest; });
    if (result.value !== undefined) change(control, result.value);
  };

  return <section className="design-choices design-edits" aria-labelledby={`${ids}-heading`}>
    <h3 id={`${ids}-heading`}>Architecture</h3>
    <p id={`${ids}-count`} className="field-help">{count} of {context.allowance.maxEdits} design edits</p>
    {placed.general.length ? <ul className="field-error" aria-label="Design problems">{placed.general.map(item => <li key={item}>{item}</li>)}</ul> : null}
    <div className="design-choices-grid">
      {controls.map(control => {
        const id = `${ids}-${control.id}`;
        const messages = [...(errors[control.id] ? [errors[control.id]!] : []), ...(placed.controls.get(control.id) ?? [])];
        const describedBy = messages.length ? `${id}-error` : undefined;
        const disabled = !editable || !controlAvailable(context, draft, control);
        const changed = control.kind === "option" ? control.value !== control.domain.default : !control.packaged;
        const common = { id, disabled, ...(describedBy ? { "aria-describedby": describedBy, "aria-invalid": true } : {}) };
        let field;
        if (control.kind === "resource" || control.kind === "subscription" || (control.kind === "option" && control.domain.type === "boolean")) {
          field = <label className="design-choice-toggle">
            <input type="checkbox" {...common} checked={control.value === true} onChange={event => change(control, event.target.checked)} />
            {control.label}
          </label>;
        } else if (control.kind === "option" && control.domain.type === "integer") {
          const domain = control.domain;
          field = <>
            <label htmlFor={id}>{control.label}</label>
            <input type="number" inputMode="numeric" min={domain.minimum} max={domain.maximum} step={1} autoComplete="off" {...common}
              value={texts[control.id] ?? String(control.value)} onChange={event => setText(control, event.target.value)} />
          </>;
        } else {
          const options = control.kind === "slot" ? control.choices.map(choice => ({ value: choice.value, label: choice.label }))
            : control.kind === "binding" ? control.candidates.map(candidate => ({ value: candidate, label: candidate }))
            : control.domain.type === "choice" ? control.domain.choices.map(choice => ({ value: choice, label: choice })) : [];
          field = <>
            <label htmlFor={id}>{control.label}</label>
            <select {...common} value={String(control.value)} onChange={event => change(control, event.target.value)}>
              {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </>;
        }
        return <div key={control.id} className={`design-choice${changed ? " is-changed" : ""}`} data-control={control.id}>
          {field}
          {messages.length ? <span id={`${id}-error`} className="field-error">{messages.join(" ")}</span> : null}
        </div>;
      })}
    </div>
  </section>;
}
