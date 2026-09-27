import type { ReactNode } from "react";
import type { SimulationHost, HostSnapshot } from "./host.ts";

export function SimulationControls({ host, snapshot, children, notices }: {
  readonly host: SimulationHost;
  readonly snapshot: HostSnapshot;
  readonly children?: ReactNode;
  readonly notices?: ReactNode;
}) {
  const { projection, pendingCommands, loading, error } = snapshot;
  const status = projection?.simulation.status;
  const busy = pendingCommands.length > 0 || loading;
  const canAdvance = !busy && (status === "READY" || status === "PAUSED");
  const canPause = (status === "RUNNING" || ((status === "READY" || status === "PAUSED") && pendingCommands.includes("run")))
    && !pendingCommands.some(type => type !== "run");
  const canReset = !busy && status !== "RUNNING" && (projection !== null || error?.code === "SIMULATION_FAILED");
  const pendingMessage = pendingCommands.includes("pause") ? "Pause requested; waiting for an event boundary…"
    : pendingCommands.includes("reset") ? "Resetting scenario…"
    : pendingCommands.includes("step") ? "Stepping one event…"
    : pendingCommands.includes("run") ? "Run in progress…"
    : loading ? "Loading…" : "";
  const statusLabel = status ?? (error?.code === "SIMULATION_FAILED" ? "FAILED" : error ? "Simulation unavailable." : "Choose a scenario to begin.");
  const simulation = projection?.simulation;

  return <>
    <div className="toolbar-row command-row">
      <h2 id="execution-label" className="control-group-label">Simulation execution</h2>
      <div className="control-buttons" role="group" aria-labelledby="execution-label" aria-describedby="controls-help">
        {/* aria-disabled keeps keyboard focus on a control while its command settles. */}
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.run().catch(() => {}); }}>Run</button>
        <button aria-disabled={!canPause} onClick={() => { if (canPause) void host.pause().catch(() => {}); }}>Pause</button>
        <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.step().catch(() => {}); }}>Step</button>
        <button aria-disabled={!canReset} onClick={() => { if (canReset) void host.reset().catch(() => {}); }}>Reset</button>
      </div>
      <p id="controls-help" className="sr-only">These four controls change the simulation. Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again. Reading recorded history uses a separate group of controls that leaves the simulation unchanged.</p>
      {children}
    </div>
    <div className="status-line">
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
      {error ? <div role="alert">
        <p>{error.code}: {error.message}</p>
        {error.context !== null ? <details><summary>Error details</summary><pre>{JSON.stringify(error.context, null, 2)}</pre></details> : null}
      </div> : null}
      {notices}
    </div>
  </>;
}
