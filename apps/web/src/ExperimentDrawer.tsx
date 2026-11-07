import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ExperimentDrawerProps {
  /** The drawer stays mounted while closed, so an unfinished fault form survives Close. */
  readonly open: boolean;
  /** Keeps the draft; the shell returns focus to the control that opened the drawer. */
  readonly onClose: () => void;
  /** True while the draft differs from the applied overlay. */
  readonly pending: boolean;
  /** True while a design-choice field holds text that is not a value: Apply is withheld. */
  readonly invalid: boolean;
  /** False while a command is outstanding or the simulation runs. */
  readonly editable: boolean;
  /** Sends the whole draft overlay in one ordinary `load`. */
  readonly onApply: () => void;
  /** Returns both drafts to the applied overlay. */
  readonly onDiscard: () => void;
  /** Present only when the lesson's policy declares parameters. */
  readonly designChoices: ReactNode;
  readonly faults: ReactNode;
}

/**
 * The Experiment drawer (#143): the one place a student changes a session. It is non-modal and
 * docked beside the tab panels, so the graph stays visible and Pick on graph keeps working. Its
 * sections edit the draft overlay as UI state (ADR-004); only **Apply and restart** sends it, inside
 * an ordinary `load`. While a command is outstanding or the simulation runs, the drawer stays
 * readable and its inputs, Apply, and Discard are unavailable.
 */
export function ExperimentDrawer({ open, onClose, pending, invalid, editable, onApply, onDiscard, designChoices, faults }: ExperimentDrawerProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening the drawer moves focus to its heading, so keyboard users start at the top of it. A drawer
  // that mounts already open (a new lesson's session) leaves focus where the load put it.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) heading.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return <section id="experiment-drawer" className="experiment-drawer" aria-labelledby="experiment-drawer-heading" hidden={!open}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <h2 id="experiment-drawer-heading" ref={heading} tabIndex={-1}>Change the experiment</h2>
    <div className="experiment-drawer-body">
      {designChoices}
      {faults}
    </div>
    <div className="experiment-drawer-footer">
      {pending || invalid ? <p className="break-pending" role="note">These changes are not applied yet. Applying them replaces the session and starts again from the lesson’s start time, with the same seed. Reset keeps replaying the applied experiment.</p> : null}
      <div className="break-actions">
        <button type="button" className="primary" disabled={!editable || invalid || !pending} onClick={onApply}>Apply and restart</button>
        <button type="button" disabled={!editable || !(pending || invalid)} onClick={onDiscard}>Discard changes</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  </section>;
}
