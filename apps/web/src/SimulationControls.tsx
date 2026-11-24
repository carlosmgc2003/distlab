import type { ReactNode } from "react";
import type { SimulationHost, HostSnapshot } from "./host.ts";
import { errorText } from "./error-text.ts";
import { byCode } from "./i18n/catalog.ts";
import { useMessages } from "./i18n/react.tsx";
import type { Playhead } from "./flight-playback.ts";

/**
 * The top bar's simulation part (#144): the one control group and the one run summary, both on the
 * bar's single row. The same component renders on both tabs.
 *
 * The group drives the playhead (RFC 0002 P2): the first `Run` or `Step` executes the run once, and
 * every later control moves the playhead over recorded milestones without a worker command. `Run`
 * reads `Pause` while the playhead plays. Only `Reset` always sends a command.
 */
export function SimulationControls({ host, snapshot, playhead, locked = false }: {
  readonly host: SimulationHost;
  readonly snapshot: HostSnapshot;
  /** The playhead's controls; absent while no session is loaded. */
  readonly playhead?: Pick<Playhead, "controls" | "toggle" | "forward" | "back" | "position" | "summary">;
  /** An assessment suite is running (#97): it owns the session until it ends, so every control waits. */
  readonly locked?: boolean;
}) {
  const m = useMessages();
  const { projection, pendingCommands, loading, error } = snapshot;
  const status = projection?.simulation.status;
  const busy = pendingCommands.length > 0 || loading || locked;
  const controls = locked ? undefined : playhead?.controls;
  const canReset = !busy && status !== "RUNNING" && (projection !== null || error?.code === "SIMULATION_FAILED");
  // A terminal projection can arrive before `run.finished` releases the command (#193): the run is
  // over, so it is not described as in progress while the command settles.
  const runEnded = status === "COMPLETED" || status === "FAILED";
  const pendingMessage = pendingCommands.includes("reset") ? m.simulationControls.pendingReset
    : pendingCommands.includes("run") ? (runEnded ? "" : m.simulationControls.pendingRun)
    : loading ? m.simulationControls.pendingLoading : locked ? m.simulationControls.pendingAssessment : "";
  // Between two assessment rows no session is loaded yet; that is not a request to choose one.
  const statusCode = status ?? (error?.code === "SIMULATION_FAILED" ? "FAILED" : null);
  const statusLabel = statusCode !== null ? byCode(m.simulationControls.status, statusCode) ?? statusCode
    : error ? m.simulationControls.statusUnavailable : locked ? m.simulationControls.statusAssessmentRunning : m.simulationControls.statusChoose;
  const summary = playhead?.summary;
  const position = playhead?.position;
  const toggle = controls?.toggle;

  return <>
    <div className="execution-group">
      <h2 id="execution-label" className="control-group-label">{m.simulationControls.executionLabel}</h2>
      <div className="control-buttons" role="group" aria-labelledby="execution-label" aria-describedby="controls-help">
        {/* aria-disabled keeps keyboard focus on a control while it is unavailable, so Run → Pause keeps focus. */}
        <button type="button" aria-disabled={!toggle?.available} aria-keyshortcuts="Space" className={toggle?.pauses ? "is-pause" : undefined}
          onClick={() => { if (toggle?.available) playhead?.toggle(); }}>{toggle?.label ?? m.simulationControls.run}</button>
        <button type="button" aria-disabled={!controls?.back} aria-keyshortcuts="ArrowLeft"
          onClick={() => { if (controls?.back) playhead?.back(); }}>{m.simulationControls.back}</button>
        <button type="button" aria-disabled={!controls?.step} aria-keyshortcuts="ArrowRight"
          onClick={() => { if (controls?.step) playhead?.forward(); }}>{m.simulationControls.step}</button>
        <button type="button" aria-disabled={!canReset} onClick={() => { if (canReset) void host.reset().catch(() => {}); }}>{m.simulationControls.reset}</button>
      </div>
      <p id="controls-help" className="sr-only">{m.simulationControls.help}</p>
    </div>
    {/* The one visible presentation of the run: its status and the playhead (RFC 0002 P2). Engine counters are in Advanced diagnostics. */}
    <section className="run-summary" aria-labelledby="run-summary-label">
      <h2 id="run-summary-label" className="sr-only">{m.simulationControls.committedState}</h2>
      <p className="run-status" role="status" aria-label={m.simulationControls.statusLabel} aria-atomic="true">
        {statusLabel}
        {pendingMessage ? ` · ${pendingMessage}` : ""}
      </p>
      <dl className="run-metrics">
        <div><dt>{m.simulationControls.milestone}</dt><dd>{summary?.milestone ?? "—"}</dd></div>
        <div><dt>{m.simulationControls.virtualTime}</dt><dd>{summary?.time ?? "—"}</dd></div>
      </dl>
      {/* The same position as one sentence, with the record's sequence and any virtual-time jump, for assistive technology. */}
      {position ? <p className="sr-only" role="status" aria-label={m.playback.narration.position} aria-live="polite" aria-atomic="true">
        {position.jump ? `${position.text} ${position.jump}` : position.text}
      </p> : null}
    </section>
  </>;
}

/** The error row directly under the top bar, rendered only while an error or a terminal notice exists. */
export function SimulationAlert({ snapshot, notices }: { readonly snapshot: HostSnapshot; readonly notices?: ReactNode }) {
  const m = useMessages();
  const { error } = snapshot;
  if (!error && !notices) return null;
  return <div className="top-bar-alerts">
    {error ? <div role="alert">
      <p>{error.code}: {errorText(error, m)}</p>
      {error.context !== null ? <details><summary>{m.simulationControls.errorDetails}</summary><pre>{JSON.stringify(error.context, null, 2)}</pre></details> : null}
    </div> : null}
    {notices}
  </div>;
}
