import { useEffect, useId, useMemo, useState } from "react";
import type { ArchitectureDefinition, LessonOverlayPolicy, ScenarioDiagnostic, SessionOverlay } from "@distlab/contracts";
import type { GraphPick } from "./ArchitectureView.tsx";
import {
  buildEntry, describeEntry, emptyForm, entryId, faultKindOptions, formFromEntry, isEmptyOverlay, nextStudentId,
  draftFromOverlay, overlayFromDraft, pickTarget, placeDiagnostics, sameOverlay, targetOptions,
} from "./break-faults.ts";
import type { DraftEntry, FaultForm, FormField } from "./break-faults.ts";

export interface BreakPanelProps {
  readonly policy: LessonOverlayPolicy;
  readonly architecture: ArchitectureDefinition;
  /** The normalized overlay the worker applied, or null when no session is loaded. */
  readonly applied: SessionOverlay | null;
  readonly draft: readonly DraftEntry[];
  readonly onDraftChange: (draft: readonly DraftEntry[]) => void;
  /** False while a command is outstanding or the simulation runs: the applied faults stay visible read-only. */
  readonly editable: boolean;
  /** Diagnostics from the last rejected load, and the overlay they point into. */
  readonly rejected: { readonly overlay: SessionOverlay; readonly diagnostics: readonly ScenarioDiagnostic[] } | null;
  /** Sends `load` with the packaged document and this overlay, which replaces the session. */
  readonly onApply: (overlay: SessionOverlay) => void;
  readonly picking: boolean;
  readonly onPickingChange: (picking: boolean) => void;
  /** The latest graph pick; the token changes on every pick. */
  readonly pick: { readonly pick: GraphPick; readonly token: number } | null;
  /** Owned by the shell, so the editor stays open while Apply replaces the session. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Hidden (not unmounted) outside the Architecture tab, so an unfinished form survives a tab switch. */
  readonly hidden?: boolean;
}

const fieldLabels: Readonly<Record<FormField, string>> = {
  kind: "Fault", target: "Target", endpoint: "Endpoint (optional)", from: "From virtual time", until: "Until virtual time (optional, exclusive)",
  occurrence: "Only occurrence number (optional)", maxApplications: "Maximum applications", probability: "Probability",
  duration: "Delay duration", additionalCopies: "Additional copies", spacing: "Spacing between copies", at: "At virtual time", state: "Availability state",
};

/**
 * Break panel (ADR-004, issue #94). The student composes a draft overlay of
 * fault rules and scheduled faults that the lesson allows. Applying sends one
 * ordinary `load`; nothing here edits a running simulation.
 */
export function BreakPanel({ policy, architecture, applied, draft, onDraftChange, editable, rejected, onApply, picking, onPickingChange, pick, open, onOpenChange, hidden = false }: BreakPanelProps) {
  const ids = useId();
  const [form, setForm] = useState<FaultForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const options = useMemo(() => faultKindOptions(policy), [policy]);
  const option = options.find(item => item.id === form.kind);
  const targets = useMemo(() => targetOptions(option, architecture), [option, architecture]);
  const draftOverlay = useMemo(() => overlayFromDraft(draft), [draft]);
  const pending = applied ? !sameOverlay(draftOverlay, applied) : !isEmptyOverlay(draftOverlay);
  const placed = useMemo(() => rejected ? placeDiagnostics(rejected.diagnostics, rejected.overlay) : { entries: [], general: [] }, [rejected]);
  const appliedIds = new Set(applied ? [...applied.faults.map(rule => rule.id), ...applied.scheduledFaults.map(action => action.id)] : []);
  const remaining = policy.faults.maxEntries - draft.length;

  useEffect(() => { if (rejected) onOpenChange(true); }, [rejected, onOpenChange]);
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
    onOpenChange(true);
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
  const field = (name: FormField, input: React.ReactNode, help?: string) => {
    const error = errors[name];
    return <div className="break-field">
      <label htmlFor={`${ids}-${name}`}>{fieldLabels[name]}</label>
      {input}
      {help ? <span id={`${ids}-${name}-help`} className="field-help">{help}</span> : null}
      {error ? <span id={`${ids}-${name}-error`} className="field-error">{error}</span> : null}
    </div>;
  };
  const inputProps = (name: FormField) => ({
    id: `${ids}-${name}`, name, value: form[name], disabled: !editable,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": [errors[name] ? `${ids}-${name}-error` : "", `${ids}-${name}-help`].filter(Boolean).join(" ") || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(name, event.target.value),
  });
  const number = (name: FormField, help?: string) => field(name, <input {...inputProps(name)} inputMode={name === "probability" ? "decimal" : "numeric"} autoComplete="off" />, help);
  const usesSeed = option?.kind === "rule" && form.probability.trim() !== "" && Number(form.probability) !== 1;
  const summary = applied
    ? applied.faults.length + applied.scheduledFaults.length === 0 ? "No student faults applied." : `${applied.faults.length + applied.scheduledFaults.length} student fault${applied.faults.length + applied.scheduledFaults.length === 1 ? "" : "s"} applied.`
    : "The draft is not applied.";

  return <section className={`break-panel${open ? " is-open" : ""}`} aria-labelledby={`${ids}-heading`} hidden={hidden}>
    <div className="break-header">
      <h2 id={`${ids}-heading`}>Break the system</h2>
      <span className="break-summary">{summary}</span>
      <button type="button" aria-expanded={open} aria-controls={`${ids}-body`} onClick={() => onOpenChange(!open)}>
        {open ? "Hide fault editor" : "Add or change faults"}
      </button>
    </div>
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
    {pending ? <div className="break-pending" role="note">
      <p>The draft is not applied yet. Applying it replaces the session and starts again from the lesson’s start time. Reset keeps replaying the applied faults.</p>
      <div className="break-actions">
        <button type="button" className="primary" disabled={!editable} onClick={() => onApply(draftOverlay)}>
          {draft.length ? "Apply faults and reload" : "Remove all faults and reload"}
        </button>
        {applied ? <button type="button" disabled={!editable} onClick={() => { onDraftChange(draftFromOverlay(applied)); setNotice("Draft changes discarded."); }}>Discard draft changes</button> : null}
      </div>
    </div> : null}
    {placed.general.length ? <ul className="field-error" aria-label="Fault problems">{placed.general.map(item => <li key={item}>{item}</li>)}</ul> : null}
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    <div id={`${ids}-body`} hidden={!open} className="break-body">
      {!editable ? <p className="break-locked">Fault controls are unavailable while the simulation runs or a command is in progress. The applied faults stay listed.</p> : null}
      {options.length === 0 ? <p>This lesson does not allow student faults.</p> : <form className="break-form" onSubmit={submit} aria-labelledby={`${ids}-form-heading`} noValidate>
        <h3 id={`${ids}-form-heading`}>{editing ? `Edit ${editing}` : "Add a fault"}</h3>
        <p className="field-help">Only the faults this lesson allows are listed. {remaining > 0 ? `You can add ${remaining} more.` : "The draft is at this lesson’s fault limit."} A fault applies when you apply the draft, never during a run.</p>
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
          </span>, option.target === "link" ? (option.point === "network.response" ? "A response travels back along the link, from the called component to the caller." : "A request travels along the link, from the caller to the called component.") : undefined) : null}
          {option?.kind === "rule" && option.target === "link" ? field("endpoint", <input {...inputProps("endpoint")} autoComplete="off" placeholder="Any endpoint, for example POST /authorize" />) : null}
          {option?.kind === "rule" ? <>
            {number("from")}
            {number("until")}
            {number("occurrence", "1 means only the first matching request, message, or commit.")}
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
