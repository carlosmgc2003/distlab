import type { ReactNode } from "react";
import type { SimulationHost, HostSnapshot } from "./host.ts";

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
  const pendingMessage = pendingCommands.includes("pause") ? "Pause requested; waiting for an event boundary…"
    : pendingCommands.includes("reset") ? "Resetting scenario…"
    : pendingCommands.includes("step") ? "Stepping one event…"
    : pendingCommands.includes("run") ? (runEnded ? "" : "Run in progress…")
    : loading ? "Loading…" : locked ? "Assessment running…" : "";
  // Between two assessment rows no session is loaded yet; that is not a request to choose one.
  const statusLabel = status ?? (error?.code === "SIMULATION_FAILED" ? "FAILED" : error ? "Simulation unavailable." : locked ? "Assessment running." : "Choose a scenario to begin.");
  const simulation = projection?.simulation;

  return <>
    <div className="execution-group">
      <h2 id="execution-label" className="control-group-label">Simulation execution</h2>
      <div className="control-buttons" role="group" aria-labelledby="execution-label" aria-describedby="controls-help">
        {/* aria-disabled keeps keyboard focus on a control while its command settles. */}
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.run().catch(() => {}); }}>Run</button>
        <button aria-disabled={!canPause} onClick={() => { if (canPause) void host.pause().catch(() => {}); }}>Pause</button>
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.step().catch(() => {}); }}>Step</button>
        <button aria-disabled={!canReset} onClick={() => { if (canReset) void host.reset().catch(() => {}); }}>Reset</button>
      </div>
      <p id="controls-help" className="sr-only">These four controls change the simulation. Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again. Replay, in the Architecture tab, is a separate group of controls that leaves the simulation unchanged.</p>
    </div>
    {/* The one visible presentation of the committed run: status, virtual time, and boundary counts. */}
    <section className="run-summary" aria-labelledby="run-summary-label">
      <h2 id="run-summary-label" className="sr-only">Committed simulation state</h2>
      <p className="run-status" role="status" aria-label="Simulation status" aria-atomic="true">
        {statusLabel}
        {pendingMessage ? ` · ${pendingMessage}` : ""}
      </p>
      <dl className="run-metrics">
        <div><dt>Virtual time</dt><dd>{simulation ? simulation.time : "—"}</dd></div>
        <div><dt>Processed events</dt><dd>{simulation ? simulation.processedEvents : "—"}</dd></div>
        <div><dt>Pending events</dt><dd>{simulation ? simulation.pendingEvents : "—"}</dd></div>
      </dl>
    </section>
  </>;
}

/** The error row directly under the top bar, rendered only while an error or a terminal notice exists. */
export function SimulationAlert({ snapshot, notices }: { readonly snapshot: HostSnapshot; readonly notices?: ReactNode }) {
  const { error } = snapshot;
  if (!error && !notices) return null;
  return <div className="top-bar-alerts">
    {error ? <div role="alert">
      <p>{error.code}: {error.message}</p>
      {error.context !== null ? <details><summary>Error details</summary><pre>{JSON.stringify(error.context, null, 2)}</pre></details> : null}
    </div> : null}
    {notices}
  </div>;
}
