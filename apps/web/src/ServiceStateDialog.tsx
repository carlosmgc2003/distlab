import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * The Service state dialog (#142): what each service knows right now, reached from ③ Investigate.
 * A native modal dialog, so focus stays inside it while it is open. Escape and Close close it; the
 * shell returns focus to the button that opened it. It only renders projection facts the shell
 * passes in, and sends no worker command.
 */
export function ServiceStateDialog({ open, time, onClose, children }: {
  readonly open: boolean;
  /** The projection's virtual time, named in the dialog's title. */
  readonly time: number | undefined;
  /** Called after the dialog closes by Escape or Close. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The dialog may close natively (Escape): the shell's state follows it, never the reverse.
  const expected = useRef(open);
  expected.current = open;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>(".service-state-close")?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  return <dialog ref={dialog} className="service-state-dialog" role="dialog" aria-modal="true" aria-labelledby="service-state-title"
    onClose={() => { if (expected.current) onClose(); }}>
    <div className="service-state-header">
      <h2 id="service-state-title">Service state at t={time ?? "—"}</h2>
      <button type="button" className="service-state-close" onClick={onClose}>Close</button>
    </div>
    {/* Focusable so keyboard users can scroll a tall body. */}
    <div className="service-state-body" tabIndex={0}>{open ? children : null}</div>
  </dialog>;
}
