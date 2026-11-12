import { useEffect, useId, useMemo, useState } from "react";
import type { ArchitectureDefinition, LessonOverlayPolicy, ScenarioDiagnostic, SessionOverlay } from "@distlab/contracts";
import type { GraphPick } from "./ArchitectureView.tsx";
import {
  buildEntry, describeEntry, emptyForm, entryId, faultKindOptions, fieldErrorText, formFromEntry, nextStudentId, pickTarget, placeDiagnostics, targetOptions,
} from "./break-faults.ts";
import type { DraftEntry, FaultForm, FieldError, FormField } from "./break-faults.ts";
import { useMessages } from "./i18n/react.tsx";
import { Rich } from "./i18n/rich.tsx";

export interface FaultsSectionProps {
  readonly policy: LessonOverlayPolicy;
  readonly architecture: ArchitectureDefinition;
  /** The normalized overlay the worker applied, or null when no session is loaded. */
  readonly applied: SessionOverlay | null;
  readonly draft: readonly DraftEntry[];
  readonly onDraftChange: (draft: readonly DraftEntry[]) => void;
  /** True when the faults draft differs from the applied faults. */
  readonly pending: boolean;
  /** False while a command is outstanding or the simulation runs: the applied faults stay visible read-only. */
  readonly editable: boolean;
  /** Diagnostics from the last rejected load, and the overlay they point into. */
  readonly rejected: { readonly overlay: SessionOverlay; readonly diagnostics: readonly ScenarioDiagnostic[] } | null;
  readonly picking: boolean;
  readonly onPickingChange: (picking: boolean) => void;
  /** The latest graph pick; the token changes on every pick. */
  readonly pick: { readonly pick: GraphPick; readonly token: number } | null;
}

const srTag = { sr: (children: React.ReactNode) => <span className="sr-only">{children}</span> };

/**
 * The Faults section's part of the Experiment drawer's one hint (#147). Field help other than
 * probability is here, not under its field; each such field keeps it as a screen-reader description.
 */
export function FaultsHelp({ policy }: { readonly policy: LessonOverlayPolicy }) {
  const m = useMessages();
  const options = faultKindOptions(policy, m);
  if (options.length === 0) return null;
  const links = options.some(option => option.target === "link");
  const rules = options.some(option => option.kind === "rule");
  return <>
    <p>{m.faults.section.help.allowedApply}</p>
    <p>{m.faults.section.help.locked}</p>
    {links || rules ? <dl className="help-hint-fields">
      {links ? <><dt>{m.faults.section.fieldLabels.target}</dt><dd>{m.faults.section.help.link}</dd></> : null}
      {rules ? <><dt>{m.faults.section.fieldLabels.occurrence}</dt><dd>{m.faults.section.help.occurrence}</dd></> : null}
    </dl> : null}
  </>;
}

/**
 * Student faults (ADR-004, issue #94), a section of the Experiment drawer (#143).
 * The student composes a draft overlay of fault rules and scheduled faults that
 * the lesson allows. The drawer's one Apply sends one ordinary `load`; nothing
 * here edits a running simulation.
 */
export function FaultsSection({ policy, architecture, applied, draft, onDraftChange, pending, editable, rejected, picking, onPickingChange, pick }: FaultsSectionProps) {
  const ids = useId();
  const m = useMessages();
  const [form, setForm] = useState<FaultForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FormField, FieldError>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const options = useMemo(() => faultKindOptions(policy, m), [policy, m]);
  const option = options.find(item => item.id === form.kind);
  const targets = useMemo(() => targetOptions(option, architecture, m), [option, architecture, m]);
  const placed = useMemo(() => rejected ? placeDiagnostics(rejected.diagnostics, rejected.overlay, m) : { entries: [], general: [] }, [rejected, m]);
  const appliedIds = new Set(applied ? [...applied.faults.map(rule => rule.id), ...applied.scheduledFaults.map(action => action.id)] : []);
  const remaining = policy.faults.maxEntries - draft.length;

  useEffect(() => { if (!editable && picking) onPickingChange(false); }, [editable, picking, onPickingChange]);
  useEffect(() => {
    if (!pick || !picking) return;
    const chosen = pickTarget(targets, pick.pick);
    const name = pick.pick.kind === "node" ? pick.pick.id : `${pick.pick.source} → ${pick.pick.target}`;
    if (chosen) {
      setForm(current => ({ ...current, target: chosen.value }));
      setErrors(current => { const { target: _, ...rest } = current; return rest; });
      setNotice(m.faults.section.notice.targetSet(chosen.label));
      onPickingChange(false);
    } else setNotice(option ? m.faults.section.notice.cannotBeTarget[option.target]({ name, kind: option.label }) : m.faults.section.notice.chooseFirst);
    // Only a new pick token is handled; the other values are read at that moment.
  }, [pick?.token]);

  const update = (field: FormField, value: string) => {
    setForm(current => ({ ...current, [field]: value, ...(field === "kind" ? { target: "" } : {}) }));
    setErrors(current => { const { [field]: _, ...rest } = current; return rest; });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const id = editing ?? nextStudentId(draft);
    const result = buildEntry(form, options, targets, id);
    setErrors(result.errors);
    if (!result.entry) { setNotice(m.faults.section.notice.notAdded); return; }
    const entry = result.entry;
    onDraftChange(editing ? draft.map(item => entryId(item) === editing ? entry : item) : [...draft, entry]);
    setNotice(editing ? m.faults.section.notice.updated(describeEntry(entry, m)) : m.faults.section.notice.added(describeEntry(entry, m)));
    setEditing(null);
    setForm(current => ({ ...emptyForm, kind: current.kind }));
  };
  const edit = (entry: DraftEntry) => {
    setEditing(entryId(entry));
    setErrors({});
    setForm(formFromEntry(entry, kind => targetOptions(options.find(item => item.id === kind), architecture, m)));
    setNotice(m.faults.section.notice.editing(entryId(entry)));
    requestAnimationFrame(() => document.getElementById(`${ids}-kind`)?.focus());
  };
  const remove = (entry: DraftEntry) => {
    onDraftChange(draft.filter(item => entryId(item) !== entryId(entry)));
    if (editing === entryId(entry)) { setEditing(null); setForm(emptyForm); }
    setNotice(m.faults.section.notice.removed(describeEntry(entry, m)));
  };
  // Help shown under its field changes what the student types (probability). Other field help is read
  // as the field's description only, and shown in the drawer's hint (#147).
  const field = (name: FormField, input: React.ReactNode, help?: string, shown = false) => {
    const error = errors[name];
    return <div className="break-field">
      <label htmlFor={`${ids}-${name}`}>{m.faults.section.fieldLabels[name]}</label>
      {input}
      {help ? <span id={`${ids}-${name}-help`} className={shown ? "field-help" : "sr-only"}>{help}</span> : null}
      {error ? <span id={`${ids}-${name}-error`} className="field-error">{fieldErrorText(error, m)}</span> : null}
    </div>;
  };
  const inputProps = (name: FormField) => ({
    id: `${ids}-${name}`, name, value: form[name], disabled: !editable,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": [errors[name] ? `${ids}-${name}-error` : "", `${ids}-${name}-help`].filter(Boolean).join(" ") || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(name, event.target.value),
  });
  const number = (name: FormField, help?: string) => field(name, <input {...inputProps(name)} inputMode={name === "probability" ? "decimal" : "numeric"} autoComplete="off" />, help, name === "probability");
  const usesSeed = option?.kind === "rule" && form.probability.trim() !== "" && Number(form.probability) !== 1;

  return <section className="faults-section" aria-labelledby={`${ids}-heading`}>
    <h3 id={`${ids}-heading`}>{m.faults.section.heading}</h3>
    {draft.length ? <ul className="fault-chips" aria-label={m.faults.section.chipsLabel}>
      {draft.map(entry => {
        const id = entryId(entry);
        const problems = placed.entries.filter(item => item.entryId === id);
        return <li key={id} className={`fault-chip${appliedIds.has(id) && !pending ? " is-applied" : ""}${problems.length ? " has-error" : ""}`}>
          <span className="fault-chip-text"><span aria-hidden="true">⚡ </span><code>{id}</code> {describeEntry(entry, m)}
            <span className="fault-chip-state">{" · "}{appliedIds.has(id) ? pending ? m.faults.section.chipState.appliedChanged : m.faults.section.chipState.applied : m.faults.section.chipState.notApplied}</span>
          </span>
          {problems.length ? <ul className="fault-chip-errors">{problems.map((problem, index) => <li key={index}>
            {problem.field ? `${m.faults.section.fieldLabels[problem.field]}: ` : ""}{problem.message}
          </li>)}</ul> : null}
          <span className="fault-chip-actions">
            <button type="button" disabled={!editable} onClick={() => edit(entry)}><Rich text={m.faults.section.edit(id)} tags={srTag} /></button>
            <button type="button" disabled={!editable} onClick={() => remove(entry)}><Rich text={m.faults.section.remove(id)} tags={srTag} /></button>
          </span>
        </li>;
      })}
    </ul> : null}
    {placed.general.length ? <ul className="field-error" aria-label={m.faults.section.problemsLabel}>{placed.general.map(item => <li key={item}>{item}</li>)}</ul> : null}
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    <div className="break-body">
      {options.length === 0 ? <p>{m.faults.section.noFaults}</p> : <form className="break-form" onSubmit={submit} aria-labelledby={`${ids}-form-heading`} noValidate>
        <h4 id={`${ids}-form-heading`}>{editing ? m.faults.section.editTitle(editing) : m.faults.section.addTitle}</h4>
        <p className="field-help">{remaining > 0 ? m.faults.section.remaining(remaining) : m.faults.section.atLimit}</p>
        <div className="break-grid">
          {field("kind", <select {...inputProps("kind")}>
            <option value="">{m.faults.section.chooseFault}</option>
            {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>)}
          {option ? field("target", <span className="break-target">
            <select {...inputProps("target")}>
              <option value="">{m.faults.section.chooseTarget[option.target]}</option>
              {targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" aria-pressed={picking} disabled={!editable} onClick={() => { onPickingChange(!picking); setNotice(picking ? m.faults.section.notice.pickingStopped : m.faults.section.notice.selectOnGraph[option.target]); }}>
              {picking ? m.faults.section.stopPicking : m.faults.section.pickOnGraph}
            </button>
          </span>, option.target === "link" ? (option.point === "network.response" ? m.faults.section.help.response : m.faults.section.help.request) : undefined) : null}
          {option?.kind === "rule" && option.target === "link" ? field("endpoint", <input {...inputProps("endpoint")} autoComplete="off" placeholder={m.faults.section.endpointPlaceholder} />) : null}
          {option?.kind === "rule" ? <>
            {number("from")}
            {number("until")}
            {number("occurrence", m.faults.section.help.occurrence)}
            {number("maxApplications")}
            {number("probability", usesSeed ? m.faults.section.help.seedUsed : m.faults.section.help.seedProbability)}
            {option.effect === "delay" ? number("duration") : null}
            {option.effect === "duplicate" ? <>{number("additionalCopies")}{number("spacing")}</> : null}
          </> : null}
          {option?.kind === "scheduled" ? <>
            {number("at")}
            {option.scheduled === "external-availability" ? field("state", <select {...inputProps("state")}>
              {(["UNAVAILABLE", "RATE_LIMITED", "DEGRADED", "AVAILABLE"] as const).map(state => <option key={state} value={state}>{m.faults.section.availability[state]}</option>)}
            </select>) : null}
          </> : null}
        </div>
        <div className="break-actions">
          <button type="submit" disabled={!editable || !option || (!editing && remaining <= 0)}>{editing ? m.faults.section.updateFault : m.faults.section.addFault}</button>
          {editing ? <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); setErrors({}); }}>{m.faults.section.cancelEdit}</button> : null}
        </div>
      </form>}
    </div>
  </section>;
}
