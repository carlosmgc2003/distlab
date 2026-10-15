import { useId, useMemo, useRef, useState } from "react";
import type { CanonicalValue } from "@distlab/contracts";
import { editableFlags, editableLinks, faultEffects, faultPoints, hasEdits, linkFields, noEdits, scenarioSeed, validateEdits } from "./experiment-edits.ts";
import type { ExperimentEdits, FaultDraft, LinkField } from "./experiment-edits.ts";

const fieldLabels: Record<LinkField, string> = {
  requestLatency: "Request latency", responseLatency: "Response latency", jitter: "Jitter", timeout: "Timeout", failureRate: "Failure rate",
};
const pointLabels: Record<FaultDraft["point"], string> = { "network.request": "Request (caller → callee)", "network.response": "Response (callee → caller)" };
const effectLabels: Record<FaultDraft["effect"], string> = { drop: "Drop", fail: "Fail", delay: "Delay", duplicate: "Duplicate" };
const numberValue = (text: string): number => text.trim() === "" ? Number.NaN : Number(text);
const shown = (value: number): string => Number.isNaN(value) ? "" : String(value);

/**
 * Edits the loaded scenario's data before a new session. Applying replaces the worker session
 * through the existing load command; nothing here changes a running simulation.
 */
export function ExperimentPanel({ scenario, applied, busy, onApply, onRestore }: {
  readonly scenario: CanonicalValue;
  readonly applied: ExperimentEdits | null;
  readonly busy: boolean;
  readonly onApply: (edits: ExperimentEdits) => void;
  readonly onRestore: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [draft, setDraft] = useState<ExperimentEdits>(applied ?? noEdits);
  const links = useMemo(() => editableLinks(scenario), [scenario]);
  const flags = useMemo(() => editableFlags(scenario), [scenario]);
  const problems = validateEdits(scenario, draft);
  const changed = hasEdits(scenario, draft);
  const pathError = (path: string) => problems.some(problem => problem.path === path);
  const errorId = `${id}-errors`;
  const policy = (key: string, field: LinkField) => draft.links[key]?.[field] ?? links.find(link => link.key === key)!.policy[field];
  const flag = (componentId: string, name: string, fallback: boolean) => draft.flags[componentId]?.[name] ?? fallback;
  const setLink = (key: string, field: LinkField, value: number) =>
    setDraft(current => ({ ...current, links: { ...current.links, [key]: { ...current.links[key], [field]: value } } }));
  const setFlag = (componentId: string, name: string, value: boolean) =>
    setDraft(current => ({ ...current, flags: { ...current.flags, [componentId]: { ...current.flags[componentId], [name]: value } } }));
  const setFault = (index: number, patch: Partial<FaultDraft>) =>
    setDraft(current => ({ ...current, faults: current.faults.map((fault, i) => i === index ? { ...fault, ...patch } : fault) }));
  const addFault = () => setDraft(current => ({ ...current, faults: [...current.faults,
    { link: links[0]?.key ?? "", point: "network.response", effect: "drop", name: "", from: 0, duration: 5 }] }));
  const canApply = !busy && changed && problems.length === 0;
  const invalid = (path: string) => pathError(path) ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  return <div className="experiment-panel">
    <button type="button" aria-haspopup="dialog" disabled={busy} onClick={() => dialog.current?.showModal()}>Modify experiment</button>
    {applied ? <>
      <span className="experiment-badge" role="status" aria-label="Experiment state">Modified</span>
      <button type="button" disabled={busy} onClick={() => { setDraft(noEdits); onRestore(); }}>Restore original</button>
    </> : null}
    <dialog ref={dialog} className="experiment-dialog" aria-labelledby={`${id}-title`}>
    <form className="experiment-form" aria-label="Modify experiment" onSubmit={event => { event.preventDefault(); if (canApply) { onApply(draft); close(); } }}>
      <h2 id={`${id}-title`}>Modify experiment</h2>
      <p className="experiment-help">Change the inputs, then apply to load a new session from virtual time 0. The same seed and edits always replay the same history.</p>
      <div className="experiment-field">
        <label htmlFor={`${id}-seed`}>Seed</label>
        <input id={`${id}-seed`} type="text" value={draft.seed ?? scenarioSeed(scenario)} disabled={busy} {...invalid("seed")}
          onChange={event => setDraft(current => ({ ...current, seed: event.target.value }))} />
      </div>
      {links.map(link => <fieldset key={link.key} className="experiment-group">
        <legend>Link {link.source} → {link.target}</legend>
        {linkFields.map(field => <div key={field} className="experiment-field">
          <label htmlFor={`${id}-${link.key}-${field}`}>{fieldLabels[field]}</label>
          <input id={`${id}-${link.key}-${field}`} type="number" inputMode="decimal" min={field === "timeout" ? 1 : 0} max={field === "failureRate" ? 1 : undefined}
            step={field === "failureRate" ? 0.05 : 1} value={shown(policy(link.key, field))} disabled={busy} {...invalid(`links.${link.key}.${field}`)}
            onChange={event => setLink(link.key, field, numberValue(event.target.value))} />
        </div>)}
      </fieldset>)}
      {flags.length ? <fieldset className="experiment-group">
        <legend>Design switches</legend>
        {flags.map(item => <div key={`${item.componentId}.${item.flag}`} className="experiment-check">
          <input id={`${id}-${item.componentId}-${item.flag}`} type="checkbox" checked={flag(item.componentId, item.flag, item.value)} disabled={busy}
            onChange={event => setFlag(item.componentId, item.flag, event.target.checked)} />
          <label htmlFor={`${id}-${item.componentId}-${item.flag}`}>{item.componentId}: {item.flag}</label>
        </div>)}
      </fieldset> : null}
      <fieldset className="experiment-group">
        <legend>Added faults</legend>
        {draft.faults.length === 0 ? <p className="experiment-help">No added faults. Packaged lesson faults stay in place.</p> : null}
        {draft.faults.map((fault, index) => <div key={index} className="experiment-fault" role="group" aria-label={`Added fault ${index + 1}`}>
          <div className="experiment-field"><label htmlFor={`${id}-f${index}-link`}>Link</label>
            <select id={`${id}-f${index}-link`} value={fault.link} disabled={busy} {...invalid(`faults.${index}.link`)} onChange={event => setFault(index, { link: event.target.value })}>
              {links.map(link => <option key={link.key} value={link.key}>{link.source} → {link.target}</option>)}
            </select></div>
          <div className="experiment-field"><label htmlFor={`${id}-f${index}-point`}>Where</label>
            <select id={`${id}-f${index}-point`} value={fault.point} disabled={busy} onChange={event => setFault(index, { point: event.target.value as FaultDraft["point"] })}>
              {faultPoints.map(point => <option key={point} value={point}>{pointLabels[point]}</option>)}
            </select></div>
          <div className="experiment-field"><label htmlFor={`${id}-f${index}-effect`}>Effect</label>
            <select id={`${id}-f${index}-effect`} value={fault.effect} disabled={busy} onChange={event => setFault(index, { effect: event.target.value as FaultDraft["effect"] })}>
              {faultEffects.map(effect => <option key={effect} value={effect}>{effectLabels[effect]}</option>)}
            </select></div>
          <div className="experiment-field"><label htmlFor={`${id}-f${index}-name`}>Endpoint (optional)</label>
            <input id={`${id}-f${index}-name`} type="text" placeholder="e.g. POST /pay" value={fault.name} disabled={busy} onChange={event => setFault(index, { name: event.target.value })} /></div>
          <div className="experiment-field"><label htmlFor={`${id}-f${index}-from`}>From time</label>
            <input id={`${id}-f${index}-from`} type="number" min={0} step={1} value={shown(fault.from)} disabled={busy} {...invalid(`faults.${index}.from`)}
              onChange={event => setFault(index, { from: numberValue(event.target.value) })} /></div>
          {fault.effect === "delay" || fault.effect === "duplicate" ? <div className="experiment-field">
            <label htmlFor={`${id}-f${index}-duration`}>{fault.effect === "delay" ? "Delay" : "Copy spacing"}</label>
            <input id={`${id}-f${index}-duration`} type="number" min={1} step={1} value={shown(fault.duration)} disabled={busy} {...invalid(`faults.${index}.duration`)}
              onChange={event => setFault(index, { duration: numberValue(event.target.value) })} /></div> : null}
          <button type="button" disabled={busy} onClick={() => setDraft(current => ({ ...current, faults: current.faults.filter((_, i) => i !== index) }))}>Remove fault {index + 1}</button>
        </div>)}
        <button type="button" disabled={busy || links.length === 0} onClick={addFault}>Add fault</button>
      </fieldset>
      {problems.length ? <div id={errorId} role="alert" className="experiment-errors">
        <p>Fix these values before applying. The loaded session is unchanged.</p>
        <ul>{problems.map(problem => <li key={problem.path}>{problem.message}</li>)}</ul>
      </div> : null}
      <div className="experiment-actions">
        <button type="submit" aria-disabled={!canApply}>Apply and reload</button>
        <button type="button" disabled={busy || !changed} onClick={() => setDraft(noEdits)}>Discard edits</button>
        <button type="button" onClick={close}>Close</button>
      </div>
    </form>
    </dialog>
  </div>;
}
