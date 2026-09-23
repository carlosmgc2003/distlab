import type { SimulationHost, HostSnapshot } from "./host.ts";

export function SimulationControls({ host, snapshot }: {
  readonly host: SimulationHost;
  readonly snapshot: HostSnapshot;
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

  return <section className="simulation-controls" aria-labelledby="controls-heading">
    <h2 id="controls-heading">Simulation controls</h2>
    <div className="control-buttons" role="group" aria-label="Simulation commands" aria-describedby="controls-help">
      {/* aria-disabled keeps keyboard focus on a control while its command settles. */}
      <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.run().catch(() => {}); }}>Run</button>
      <button aria-disabled={!canPause} onClick={() => { if (canPause) void host.pause().catch(() => {}); }}>Pause</button>
      <button aria-disabled={!canAdvance} onClick={() => { if (canAdvance) void host.step().catch(() => {}); }}>Step</button>
      <button aria-disabled={!canReset} onClick={() => { if (canReset) void host.reset().catch(() => {}); }}>Reset</button>
    </div>
    <p id="controls-help">Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again.</p>
    <p role="status" aria-label="Simulation status" aria-atomic="true">
      {status ?? (error ? "Simulation unavailable." : "Choose a scenario to begin.")}
      {pendingMessage ? ` · ${pendingMessage}` : ""}
    </p>
    {status === "COMPLETED" ? <p>Execution completed. Reset to run this scenario again.</p> : null}
    {error ? <div role="alert">
      <p>{error.code}: {error.message}</p>
      {error.context !== null ? <details><summary>Error details</summary><pre>{JSON.stringify(error.context, null, 2)}</pre></details> : null}
    </div> : null}
  </section>;
}
