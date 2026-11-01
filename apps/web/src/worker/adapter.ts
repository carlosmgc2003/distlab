import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, LessonOverlayPolicy, RuntimeProjectionSet, ScenarioDiagnostic, SessionIdentity, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, checkoutOverlayPolicy, normalCheckout, responseLostCheckout, commerceAssessment, commerceCatalog, commerceLessonNames, commerceOverlayPolicy, commerceScenario } from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, composeOverlay, normalizeScenario } from "@distlab/scenario";
import type { DeterministicScenarioSession } from "@distlab/scenario";
import { applicationError, detached, isCanonical, isWorkerCommand, requestIdOf } from "../protocol.ts";
import { commerceComponents, studentComponents } from "./student-projection.ts";

interface PackagedLesson {
  readonly scenario: CanonicalValue;
  readonly policy: LessonOverlayPolicy;
  readonly commerce: boolean;
}

/** The only documents the host accepts, each with the overlay policy from the worker's own catalog. */
const packagedLessons: readonly PackagedLesson[] = [
  { scenario: normalCheckout, policy: checkoutOverlayPolicy("normal"), commerce: false },
  { scenario: responseLostCheckout, policy: checkoutOverlayPolicy("response-lost"), commerce: false },
  ...commerceLessonNames.map(name => ({ scenario: commerceScenario(name), policy: commerceOverlayPolicy(name), commerce: true })),
];

class OverlayRejected {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  constructor(diagnostics: readonly ScenarioDiagnostic[]) { this.diagnostics = diagnostics; }
}

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
        // ADR-004 order: command shape (checked on receive), packaged document, overlay, applied document.
        const encoded = canonicalEncode(command.scenario);
        const lesson = packagedLessons.find(item => canonicalEncode(item.scenario) === encoded);
        if (!lesson) throw { code: "INVALID_SCENARIO", context: { reason: "Only packaged scenarios are supported." } };
        this.#commerce = lesson.commerce;
        const catalog = this.#commerce ? commerceCatalog : checkoutCatalog;
        const assessment = this.#commerce ? commerceAssessment : checkoutAssessment;
        const engine = new DeterministicScenarioEngine({ catalog, assessment });
        // The policy comes from this catalog, never from the command.
        const composed = composeOverlay(lesson.scenario, lesson.policy, command.overlay, document => engine.validate(document));
        if (!composed.ok && composed.code === "INVALID_OVERLAY") throw new OverlayRejected(composed.diagnostics);
        if (!composed.ok) throw { code: "INVALID_SCENARIO", context: composed.diagnostics };
        const session = engine.create(composed.document);
        const normalized = normalizeScenario(composed.document, catalog, assessment).scenario!;
        this.#definition = normalized.architecture;
        this.#architecture = architectureProjection(normalized.architecture);
        this.#session = session;
        const identity: SessionIdentity = { lesson: normalized.name, seed: normalized.seed, overlay: composed.overlay };
        this.#emit({ version: 1, requestId: command.requestId, type: "loaded", projection: this.#project(), session: identity });
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
      if (error instanceof OverlayRejected) {
        // A rejected load follows the atomic rule: no session stays exposed. The draft lives on the main thread.
        this.#session = undefined; this.#architecture = undefined;
        this.#emit({ version: 1, requestId: command.requestId, type: "error", error: applicationError("INVALID_OVERLAY",
          "The session overlay is not allowed for this lesson or makes the lesson invalid.",
          { diagnostics: detached(error.diagnostics) as unknown as CanonicalValue }) });
        return;
      }
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
