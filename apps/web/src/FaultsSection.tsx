import { useEffect, useId, useMemo, useState } from "react";
import type { ArchitectureDefinition, LessonOverlayPolicy, ScenarioDiagnostic, SessionOverlay } from "@distlab/contracts";
import type { GraphPick } from "./ArchitectureView.tsx";
import {
  buildEntry, describeEntry, emptyForm, entryId, faultKindOptions, formFromEntry, nextStudentId, pickTarget, placeDiagnostics, targetOptions,
} from "./break-faults.ts";
import type { DraftEntry, FaultForm, FormField } from "./break-faults.ts";

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

/** The Faults section's reasoning (#147). It is in the Experiment drawer's hint, never in the section's layout. */
const FAULTS_ALLOWED_HELP = "Only the faults this lesson allows are listed.";
const FAULTS_APPLY_HELP = "A fault applies when you apply the draft, never during a run.";
const FAULTS_LOCKED_HELP = "Fault controls are unavailable while the simulation runs or a command is in progress. The applied faults stay listed.";
const REQUEST_HELP = "A request travels along the link, from the caller to the called component.";
const RESPONSE_HELP = "A response travels back along the link, from the called component to the caller.";
const OCCURRENCE_HELP = "1 means only the first matching request, message, or commit.";

const fieldLabels: Readonly<Record<FormField, string>> = {
  kind: "Fault", target: "Target", endpoint: "Endpoint (optional)", from: "From virtual time", until: "Until virtual time (optional, exclusive)",
  occurrence: "Only occurrence number (optional)", maxApplications: "Maximum applications", probability: "Probability",
  duration: "Delay duration", additionalCopies: "Additional copies", spacing: "Spacing between copies", at: "At virtual time", state: "Availability state",
};

/**
 * The Faults section's part of the Experiment drawer's one hint (#147). Field help other than
 * probability is here, not under its field; each such field keeps it as a screen-reader description.
 */
export function FaultsHelp({ policy }: { readonly policy: LessonOverlayPolicy }) {
  const options = faultKindOptions(policy);
  if (options.length === 0) return null;
  const links = options.some(option => option.target === "link");
  const rules = options.some(option => option.kind === "rule");
  return <>
    <p>{FAULTS_ALLOWED_HELP} {FAULTS_APPLY_HELP}</p>
    <p>{FAULTS_LOCKED_HELP}</p>
    {links || rules ? <dl className="help-hint-fields">
      {links ? <><dt>{fieldLabels.target}</dt><dd>{REQUEST_HELP} {RESPONSE_HELP}</dd></> : null}
      {rules ? <><dt>{fieldLabels.occurrence}</dt><dd>{OCCURRENCE_HELP}</dd></> : null}
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
  const [form, setForm] = useState<FaultForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const options = useMemo(() => faultKindOptions(policy), [policy]);
  const option = options.find(item => item.id === form.kind);
  const targets = useMemo(() => targetOptions(option, architecture), [option, architecture]);
  const placed = useMemo(() => rejected ? placeDiagnostics(rejected.diagnostics, rejected.overlay) : { entries: [], general: [] }, [rejected]);
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
      setNotice(`Target set from the graph: ${chosen.label}.`);
      onPickingChange(false);
    } else setNotice(option ? `${name} cannot be a target for “${option.label}”. Pick ${targetHint(option.target)}.` : "Choose a fault first, then pick its target.");
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
    if (!result.entry) { setNotice("The fault was not added. Fix the marked fields."); return; }
    const entry = result.entry;
    onDraftChange(editing ? draft.map(item => entryId(item) === editing ? entry : item) : [...draft, entry]);
    setNotice(`${editing ? "Updated" : "Added"} to the draft: ${describeEntry(entry)}. Apply the draft to run with it.`);
    setEditing(null);
    setForm(current => ({ ...emptyForm, kind: current.kind }));
  };
  const edit = (entry: DraftEntry) => {
    setEditing(entryId(entry));
    setErrors({});
    setForm(formFromEntry(entry, kind => targetOptions(options.find(item => item.id === kind), architecture)));
    setNotice(`Editing ${entryId(entry)}. Change the fields, then choose Update fault.`);
    requestAnimationFrame(() => document.getElementById(`${ids}-kind`)?.focus());
  };
  const remove = (entry: DraftEntry) => {
    onDraftChange(draft.filter(item => entryId(item) !== entryId(entry)));
    if (editing === entryId(entry)) { setEditing(null); setForm(emptyForm); }
    setNotice(`Removed ${describeEntry(entry)} from the draft. Apply the draft to run without it.`);
  };
  // Help shown under its field changes what the student types (probability). Other field help is read
  // as the field's description only, and shown in the drawer's hint (#147).
  const field = (name: FormField, input: React.ReactNode, help?: string, shown = false) => {
    const error = errors[name];
    return <div className="break-field">
      <label htmlFor={`${ids}-${name}`}>{fieldLabels[name]}</label>
      {input}
      {help ? <span id={`${ids}-${name}-help`} className={shown ? "field-help" : "sr-only"}>{help}</span> : null}
      {error ? <span id={`${ids}-${name}-error`} className="field-error">{error}</span> : null}
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
    <h3 id={`${ids}-heading`}>Faults</h3>
    {draft.length ? <ul className="fault-chips" aria-label="Student faults">
      {draft.map(entry => {
        const id = entryId(entry);
        const problems = placed.entries.filter(item => item.entryId === id);
        return <li key={id} className={`fault-chip${appliedIds.has(id) && !pending ? " is-applied" : ""}${problems.length ? " has-error" : ""}`}>
          <span className="fault-chip-text"><span aria-hidden="true">⚡ </span><code>{id}</code> {describeEntry(entry)}
            <span className="fault-chip-state">{appliedIds.has(id) ? pending ? " · applied, draft changed" : " · applied" : " · not applied yet"}</span>
          </span>
          {problems.length ? <ul className="fault-chip-errors">{problems.map((problem, index) => <li key={index}>
            {problem.field ? `${fieldLabels[problem.field]}: ` : ""}{problem.message}
          </li>)}</ul> : null}
          <span className="fault-chip-actions">
            <button type="button" disabled={!editable} onClick={() => edit(entry)}>Edit<span className="sr-only"> {id}</span></button>
            <button type="button" disabled={!editable} onClick={() => remove(entry)}>Remove<span className="sr-only"> {id}</span></button>
          </span>
        </li>;
      })}
    </ul> : null}
    {placed.general.length ? <ul className="field-error" aria-label="Fault problems">{placed.general.map(item => <li key={item}>{item}</li>)}</ul> : null}
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    <div className="break-body">
      {options.length === 0 ? <p>This lesson does not allow student faults.</p> : <form className="break-form" onSubmit={submit} aria-labelledby={`${ids}-form-heading`} noValidate>
        <h4 id={`${ids}-form-heading`}>{editing ? `Edit ${editing}` : "Add a fault"}</h4>
        <p className="field-help">{remaining > 0 ? `You can add ${remaining} more.` : "The draft is at this lesson’s fault limit."}</p>
        <div className="break-grid">
          {field("kind", <select {...inputProps("kind")}>
            <option value="">Choose a fault…</option>
            {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>)}
          {option ? field("target", <span className="break-target">
            <select {...inputProps("target")}>
              <option value="">Choose {targetHint(option.target)}…</option>
              {targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" aria-pressed={picking} disabled={!editable} onClick={() => { onPickingChange(!picking); setNotice(picking ? "Graph picking stopped." : `Select ${targetHint(option.target)} in the Architecture graph.`); }}>
              {picking ? "Stop picking" : "Pick on graph"}
            </button>
          </span>, option.target === "link" ? (option.point === "network.response" ? RESPONSE_HELP : REQUEST_HELP) : undefined) : null}
          {option?.kind === "rule" && option.target === "link" ? field("endpoint", <input {...inputProps("endpoint")} autoComplete="off" placeholder="Any endpoint, for example POST /authorize" />) : null}
          {option?.kind === "rule" ? <>
            {number("from")}
            {number("until")}
            {number("occurrence", OCCURRENCE_HELP)}
            {number("maxApplications")}
            {number("probability", usesSeed ? "Uses the session seed: the same seed gives the same choice, and it can shift later random outcomes." : "1 always applies. Any other value uses the session seed.")}
            {option.effect === "delay" ? number("duration") : null}
            {option.effect === "duplicate" ? <>{number("additionalCopies")}{number("spacing")}</> : null}
          </> : null}
          {option?.kind === "scheduled" ? <>
            {number("at")}
            {option.scheduled === "external-availability" ? field("state", <select {...inputProps("state")}>
              {["UNAVAILABLE", "RATE_LIMITED", "DEGRADED", "AVAILABLE"].map(state => <option key={state} value={state}>{state}</option>)}
            </select>) : null}
          </> : null}
        </div>
        <div className="break-actions">
          <button type="submit" disabled={!editable || !option || (!editing && remaining <= 0)}>{editing ? "Update fault" : "Add fault"}</button>
          {editing ? <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); setErrors({}); }}>Cancel edit</button> : null}
        </div>
      </form>}
    </div>
  </section>;
}

function targetHint(target: "link" | "destination" | "database" | "service" | "external"): string {
  return target === "link" ? "a link" : target === "destination" ? "a message destination" : target === "database" ? "a database" : target === "service" ? "an internal service" : "an external service";
}
