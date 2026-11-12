import type { ReactNode } from "react";
import type { SimulationHost, HostSnapshot } from "./host.ts";
import { errorText } from "./error-text.ts";
import { byCode } from "./i18n/catalog.ts";
import { useMessages } from "./i18n/react.tsx";

/**
 * The top bar's simulation part (#144): the **Simulation execution** group and the one run summary,
 * both on the bar's single row. The same component renders on both tabs.
 */
export function SimulationControls({ host, snapshot, locked = false }: {
  readonly host: SimulationHost;
  readonly snapshot: HostSnapshot;
  /** An assessment suite is running (#97): it owns the session until it ends, so every control waits. */
  readonly locked?: boolean;
}) {
  const m = useMessages();
  const { projection, pendingCommands, loading, error } = snapshot;
  const status = projection?.simulation.status;
  const busy = pendingCommands.length > 0 || loading || locked;
  const canAdvance = !busy && (status === "READY" || status === "PAUSED");
  const canPause = !locked && (status === "RUNNING" || ((status === "READY" || status === "PAUSED") && pendingCommands.includes("run")))
    && !pendingCommands.some(type => type !== "run");
  const canReset = !busy && status !== "RUNNING" && (projection !== null || error?.code === "SIMULATION_FAILED");
  // A terminal projection can arrive before `run.finished` releases the command (#193): the run is
  // over, so it is not described as in progress while the command settles.
  const runEnded = status === "COMPLETED" || status === "FAILED";
  const pendingMessage = pendingCommands.includes("pause") ? m.simulationControls.pendingPause
    : pendingCommands.includes("reset") ? m.simulationControls.pendingReset
    : pendingCommands.includes("step") ? m.simulationControls.pendingStep
    : pendingCommands.includes("run") ? (runEnded ? "" : m.simulationControls.pendingRun)
    : loading ? m.simulationControls.pendingLoading : locked ? m.simulationControls.pendingAssessment : "";
  // Between two assessment rows no session is loaded yet; that is not a request to choose one.
  const statusCode = status ?? (error?.code === "SIMULATION_FAILED" ? "FAILED" : null);
  const statusLabel = statusCode !== null ? byCode(m.simulationControls.status, statusCode) ?? statusCode
    : error ? m.simulationControls.statusUnavailable : locked ? m.simulationControls.statusAssessmentRunning : m.simulationControls.statusChoose;
  const simulation = projection?.simulation;

  return <>
    <div className="execution-group">
      <h2 id="execution-label" className="control-group-label">{m.simulationControls.executionLabel}</h2>
      <div className="control-buttons" role="group" aria-labelledby="execution-label" aria-describedby="controls-help">
        {/* aria-disabled keeps keyboard focus on a control while its command settles. */}
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.run().catch(() => {}); }}>{m.simulationControls.run}</button>
        <button aria-disabled={!canPause} onClick={() => { if (canPause) void host.pause().catch(() => {}); }}>{m.simulationControls.pause}</button>
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.step().catch(() => {}); }}>{m.simulationControls.step}</button>
        <button aria-disabled={!canReset} onClick={() => { if (canReset) void host.reset().catch(() => {}); }}>{m.simulationControls.reset}</button>
      </div>
      <p id="controls-help" className="sr-only">{m.simulationControls.help}</p>
    </div>
    {/* The one visible presentation of the committed run: status, virtual time, and boundary counts. */}
    <section className="run-summary" aria-labelledby="run-summary-label">
      <h2 id="run-summary-label" className="sr-only">{m.simulationControls.committedState}</h2>
      <p className="run-status" role="status" aria-label={m.simulationControls.statusLabel} aria-atomic="true">
        {statusLabel}
        {pendingMessage ? ` · ${pendingMessage}` : ""}
      </p>
      <dl className="run-metrics">
        <div><dt>{m.simulationControls.virtualTime}</dt><dd>{simulation ? simulation.time : "—"}</dd></div>
        <div><dt>{m.simulationControls.processedEvents}</dt><dd>{simulation ? simulation.processedEvents : "—"}</dd></div>
        <div><dt>{m.simulationControls.pendingEvents}</dt><dd>{simulation ? simulation.pendingEvents : "—"}</dd></div>
      </dl>
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
