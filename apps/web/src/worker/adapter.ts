import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, normalCheckout, responseLostCheckout, commerceAssessment, commerceCatalog, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, normalizeScenario } from "@distlab/scenario";
import type { DeterministicScenarioSession } from "@distlab/scenario";
import { applicationError, detached, isCanonical, isWorkerCommand, requestIdOf } from "../protocol.ts";
import { commerceComponents, studentComponents } from "./student-projection.ts";

/** The sole runtime composition root. The transport delegates every control to Simulation. */
export class WorkerAdapter {
  #commerce = false;
  #definition: ArchitectureDefinition | undefined;
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
        const encoded = canonicalEncode(command.scenario);
        this.#commerce = commerceLessonNames.some(name => canonicalEncode(commerceScenario(name)) === encoded);
        if (!this.#commerce && ![normalCheckout, responseLostCheckout].some(scenario => canonicalEncode(scenario) === encoded)) {
          throw { code: "INVALID_SCENARIO", context: { reason: "Only packaged scenarios are supported." } };
        }
        const catalog = this.#commerce ? commerceCatalog : checkoutCatalog;
        const assessment = this.#commerce ? commerceAssessment : checkoutAssessment;
        const engine = new DeterministicScenarioEngine({ catalog, assessment });
        const diagnostics = engine.validate(command.scenario);
        if (diagnostics.length) throw { code: "INVALID_SCENARIO", context: diagnostics };
        const session = engine.create(command.scenario);
        const normalized = normalizeScenario(command.scenario, catalog, assessment).scenario!;
        this.#definition = normalized.architecture;
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
        const boundary = this.#session.simulation.processedEvents;
        if (boundary !== previousBoundary) {
          previousBoundary = boundary;
          this.#emit({ version: 1, requestId, type: "projection.updated", projection: this.#project() });
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
    const { pendingEvents, processedEvents, randomDrawCount } = session.simulation;
    const components = read.components as Readonly<Record<string, CanonicalValue>>;
    return detached({
      architecture: this.#architecture!,
      simulation: {
        runId: history.runId, status: session.simulation.status, time: session.simulation.time,
        pendingEvents, processedEvents, randomDrawCount,
      },
      history: { observations: history.observations },
      components: [
        // Host entries preserve the assessment read model and stay unrendered.
        ...Object.entries(components).map(([componentId, state]) => ({ componentId, state, visibility: "host" as const })),
        ...(this.#commerce ? commerceComponents(read, this.#definition!, detached(session.results()) as unknown as CanonicalValue) : studentComponents(read)),
      ],
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
      // Declared publications of the exact versioned commerce models, not history inference.
      ...architecture.components.flatMap(component => {
        const destination = component.model === "commerce.outbox-payment" ? "PaymentApproved" : component.model === "commerce.order-write" ? "OrderUpdated" : undefined;
        return destination ? [{ source: component.id, target: destination, label: "publication" }] : [];
      }),
    ],
  };
}
