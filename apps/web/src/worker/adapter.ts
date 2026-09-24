import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, normalizeScenario } from "@distlab/scenario";
import type { DeterministicScenarioSession } from "@distlab/scenario";
import { applicationError, detached, isCanonical, isWorkerCommand, requestIdOf } from "../protocol.ts";

/** The sole runtime composition root. The transport delegates every control to Simulation. */
export class WorkerAdapter {
  readonly #engine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });
  readonly #send: (event: WorkerEvent) => void;
  #session: DeterministicScenarioSession | undefined;
  #architecture: ArchitectureProjection | undefined;
  #active: Promise<void> | undefined;

  constructor(send: (event: WorkerEvent) => void) { this.#send = send; }

  async receive(value: unknown): Promise<void> {
    if (!isWorkerCommand(value)) {
      this.#emit({ version: 1, requestId: requestIdOf(value), type: "error", error: applicationError("INVALID_WORKER_COMMAND", "Expected a version 1 worker command.") });
      return;
    }
    const command = detached(value);
    if (this.#active && command.type !== "pause") {
      this.#emit({ version: 1, requestId: command.requestId, type: "error", error: applicationError("INVALID_WORKER_COMMAND", "A simulation control is already in progress.", { reason: "CONTROL_BUSY" }) });
      return;
    }
    this.#emit({ version: 1, requestId: command.requestId, type: "accepted" });
    if (command.type === "pause") {
      if (!this.#session) { this.#noSession(command.requestId); return; }
      this.#session.simulation.pause();
      await this.#active;
      if (this.#session.simulation.status === "FAILED") {
        const failure = this.#session.simulation.history.export().terminalFailure;
        this.#emit({ version: 1, requestId: command.requestId, type: "error", error: applicationError("SIMULATION_FAILED", "The simulation failed before the pause completed.", failure ? detached(failure) as unknown as CanonicalValue : null) });
      } else this.#publish(command.requestId);
      return;
    }
    this.#active = this.#execute(command);
    try { await this.#active; } finally { this.#active = undefined; }
  }

  async #execute(command: Exclude<WorkerCommand, { type: "pause" }>): Promise<void> {
    try {
      if (command.type === "load") {
        // Construction is atomic from the host's perspective: failures expose no old session.
        this.#session = undefined; this.#architecture = undefined;
        const diagnostics = this.#engine.validate(command.scenario);
        if (diagnostics.length) throw { code: "INVALID_SCENARIO", context: diagnostics };
        // These fixtures have complete visible history and no random draws. Broader scenario
        // hosting needs a kernel counter read port; do not guess counts for arbitrary inputs.
        const encoded = canonicalEncode(command.scenario);
        if (![normalCheckout, responseLostCheckout].some(scenario => canonicalEncode(scenario) === encoded)) {
          throw { code: "INVALID_SCENARIO", context: { reason: "Only packaged checkout scenarios are supported." } };
        }
        const session = this.#engine.create(command.scenario);
        const normalized = normalizeScenario(command.scenario, checkoutCatalog, checkoutAssessment).scenario!;
        this.#architecture = architectureProjection(normalized.architecture);
        this.#session = session;
        this.#emit({ version: 1, requestId: command.requestId, type: "loaded", projection: this.#project() });
        return;
      }
      if (!this.#session) { this.#noSession(command.requestId); return; }
      const simulation = this.#session.simulation;
      if (command.type === "run") {
        // Yield cadence is host-only; the kernel retains all scheduling and pause semantics.
        const running = simulation.run({ maxEventsPerYield: 16, ...(command.maxEvents === undefined ? {} : { maxEvents: command.maxEvents }) });
        const stopUpdates = this.#streamBoundaries(command.requestId);
        let result;
        try { result = await running; } finally { stopUpdates(); }
        this.#publish(command.requestId);
        this.#emit({ version: 1, requestId: command.requestId, type: "run.finished", status: result.status });
      } else {
        if (command.type === "step") await simulation.step();
        else await simulation.reset();
        this.#publish(command.requestId);
      }
    } catch (error) {
      const failed = this.#session?.simulation.status === "FAILED";
      const failure = failed && this.#session ? this.#session.simulation.history.export().terminalFailure : undefined;
      if (command.type === "load") { this.#session = undefined; this.#architecture = undefined; }
      else if (failed && failure?.historyComplete !== false) this.#publish(command.requestId);
      const detail = error !== null && typeof error === "object" ? error as { code?: unknown; context?: unknown } : {};
      const code = failure?.code ?? (typeof detail.code === "string" ? detail.code : "UNKNOWN");
      const nested = failure ? failure.context : isCanonical(detail.context) ? detail.context : null;
      this.#emit({ version: 1, requestId: command.requestId, type: "error", error: applicationError(
        failed ? "SIMULATION_FAILED" : command.type === "load" ? "INVALID_SCENARIO" : "INVALID_WORKER_COMMAND",
        failed ? "The simulation failed at an event boundary." : command.type === "load" ? "The scenario could not be loaded." : "The simulation control could not be applied.",
        {
          code, context: nested,
          ...(failure ? { historyComplete: failure.historyComplete, time: failure.time } : {}),
          ...(failure?.lastObservationId ? { lastObservationId: failure.lastObservationId } : {}),
        },
      ) });
    }
  }

  #noSession(requestId: string): void {
    this.#emit({ version: 1, requestId, type: "error", error: applicationError("INVALID_WORKER_COMMAND", "Load a scenario before sending controls.") });
  }
  /** Message tasks can read only between synchronous kernel event boundaries.
   * Sampling neither advances nor pauses the run, and duplicate samples are coalesced.
   */
  #streamBoundaries(requestId: string): () => void {
    const channel = new MessageChannel();
    let previousBoundary = -1;
    const sample = () => {
      if (this.#session?.simulation.status !== "RUNNING") return;
      try {
        const projection = this.#project();
        if (projection.simulation.processedEvents !== previousBoundary) {
          previousBoundary = projection.simulation.processedEvents;
          this.#emit({ version: 1, requestId, type: "projection.updated", projection });
        }
      } catch { /* Projection subscribers cannot fail or control simulation execution. */ }
      channel.port2.postMessage(null);
    };
    channel.port1.onmessage = sample;
    sample();
    return () => { channel.port1.close(); channel.port2.close(); };
  }
  #publish(requestId: string): void {
    this.#emit({ version: 1, requestId, type: "projection.updated", projection: this.#project() });
  }
  #project(): RuntimeProjectionSet {
    const session = this.#session!;
    const read = session.projection();
    const history = session.simulation.history.export();
    if (history.terminalFailure?.historyComplete === false) throw new Error("Incomplete history cannot supply projection counters.");
    let pendingEvents = 0;
    let processedEvents = 0;
    for (const observation of history.observations) {
      if (observation.type === "scheduler.event.scheduled") pendingEvents++;
      else if (observation.type === "scheduler.event.cancelled") pendingEvents--;
      else if (observation.type === "scheduler.event.dispatched") { pendingEvents--; processedEvents++; }
    }
    const components = read.components as Readonly<Record<string, CanonicalValue>>;
    return detached({
      architecture: this.#architecture!,
      simulation: {
        runId: history.runId, status: session.simulation.status, time: session.simulation.time,
        pendingEvents, processedEvents, randomDrawCount: 0,
      },
      history: { observations: history.observations },
      // The scenario boundary is authorized host state, not implicitly student-visible state.
      components: Object.entries(components).map(([componentId, state]) => ({ componentId, state, visibility: "host" as const })),
    });
  }
  #emit(event: WorkerEvent): void {
    try { this.#send(detached(event)); } catch { /* A failed host subscriber cannot affect the run. */ }
  }
}

function architectureProjection(architecture: ArchitectureDefinition): ArchitectureProjection {
  return {
    components: [
      ...architecture.components.map(({ id, kind, model, version }) => ({ id, kind, label: id, model, version })),
      ...architecture.destinations.map(({ id }) => ({ id, kind: "infrastructure" as const, label: id })),
    ],
    links: [
      ...architecture.links.map(({ source, target }) => ({ source, target })),
      ...architecture.subscriptions.map(({ destination, consumer }) => ({ source: destination, target: consumer, label: "subscription" })),
    ],
  };
}
