import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, CatalogReference, LessonOverlayPolicy, RuntimeProjectionSet, ScenarioDiagnostic, ScenarioDocument, SessionIdentity, SessionOrigin, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, checkoutCatalogReference, checkoutOverlayPolicy, normalCheckout, responseLostCheckout, commerceAssessment, commerceCatalog, commerceCatalogReference, commerceLessonNames, commerceOverlayPolicy, commerceScenario, hostedCatalogs } from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, composeOverlay, normalizeScenario, validateScenarioDocument } from "@distlab/scenario";
import type { DeterministicScenarioSession, HostedCatalog } from "@distlab/scenario";
import { applicationError, detached, isCanonical, isWorkerCommand, requestIdOf } from "../protocol.ts";
import { checkoutComponents, commerceComponents } from "./student-projection.ts";

/** One loadable input: a scenario, the policy that governs its overlays, and the hosted catalog it runs against. */
interface Lesson {
  readonly scenario: CanonicalValue;
  /** Absent only for an imported document without `overlayPolicy`, which accepts the empty overlay alone. */
  readonly policy: LessonOverlayPolicy | undefined;
  readonly hosted: HostedCatalog;
  readonly origin: SessionOrigin;
  /** Present only for an imported session: the normalized document the worker validated. */
  readonly document?: ScenarioDocument;
}

const checkoutHosted: HostedCatalog = { catalog: checkoutCatalog, assessment: checkoutAssessment };
const commerceHosted: HostedCatalog = { catalog: commerceCatalog, assessment: commerceAssessment };
const packagedOrigin: SessionOrigin = { kind: "packaged" };

/** The packaged documents the host accepts, each with the overlay policy from the worker's own catalog. */
const packagedLessons: readonly Lesson[] = [
  { scenario: normalCheckout, policy: checkoutOverlayPolicy("normal"), hosted: checkoutHosted, origin: packagedOrigin },
  { scenario: responseLostCheckout, policy: checkoutOverlayPolicy("response-lost"), hosted: checkoutHosted, origin: packagedOrigin },
  ...commerceLessonNames.map(name => ({ scenario: commerceScenario(name), policy: commerceOverlayPolicy(name), hosted: commerceHosted, origin: packagedOrigin })),
];

const sameReference = (left: CatalogReference, right: CatalogReference) => left.id === right.id && left.version === right.version;

class OverlayRejected {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  constructor(diagnostics: readonly ScenarioDiagnostic[]) { this.diagnostics = diagnostics; }
}

class DocumentRejected {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  constructor(diagnostics: readonly ScenarioDiagnostic[]) { this.diagnostics = diagnostics; }
}

/**
 * Resolves a `load` to one lesson. A packaged scenario must equal a packaged
 * document exactly. An imported document (ADR-006) is parsed, bounded, and
 * validated here, against the worker's own hosted catalog registry, and its
 * overlay policy comes from that validated document.
 */
function resolveLesson(command: Extract<WorkerCommand, { type: "load" }>): Lesson {
  if (command.document !== undefined) {
    const validated = validateScenarioDocument(command.document, hostedCatalogs);
    if (!validated.ok) throw new DocumentRejected(validated.diagnostics);
    const { document, digest, hosted } = validated;
    return { scenario: validated.scenario, policy: document.overlayPolicy, hosted, document,
      origin: { kind: "imported", digest, catalog: { id: document.catalog.id, version: document.catalog.version } } };
  }
  const encoded = canonicalEncode(command.scenario);
  const lesson = packagedLessons.find(item => canonicalEncode(item.scenario) === encoded);
  if (!lesson) throw { code: "INVALID_SCENARIO", context: { reason: "Only packaged scenarios and imported scenario documents are supported." } };
  return lesson;
}

/** The sole runtime composition root. The transport delegates every control to Simulation. */
export class WorkerAdapter {
  /** The hosted catalog the loaded session runs against. Student projections are chosen by this reference. */
  #catalog: CatalogReference = checkoutCatalogReference;
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
        // ADR-004 order: command shape (checked on receive), packaged document or imported document, overlay, applied document.
        const lesson = resolveLesson(command);
        const { catalog, assessment } = lesson.hosted;
        this.#catalog = { id: catalog.id, version: catalog.version };
        const engine = new DeterministicScenarioEngine({ catalog, assessment });
        // The policy, including any architecture allowance, comes from this catalog or the validated document, never from the command.
        const composed = composeOverlay(lesson.scenario, lesson.policy, command.overlay, document => engine.validate(document), catalog);
        if (!composed.ok && composed.code === "INVALID_OVERLAY") throw new OverlayRejected(composed.diagnostics);
        // An imported document was already validated on its own, so a remaining diagnostic is the overlay's, never a catalog defect (ADR-006).
        if (!composed.ok && lesson.document) throw new OverlayRejected([...new Set(composed.diagnostics.map(item => item.code))].sort().map(code => ({ path: "", code })));
        if (!composed.ok) throw { code: "INVALID_SCENARIO", context: composed.diagnostics };
        const session = engine.create(composed.document);
        const normalized = normalizeScenario(composed.document, catalog, assessment).scenario!;
        this.#definition = normalized.architecture;
        this.#architecture = architectureProjection(normalized.architecture);
        this.#session = session;
        const identity: SessionIdentity = { lesson: normalized.name, seed: normalized.seed, overlay: composed.overlay, origin: lesson.origin };
        this.#emit({ version: 1, requestId: command.requestId, type: "loaded", projection: this.#project(), session: identity,
          ...(lesson.document ? { document: lesson.document } : {}) });
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
      if (error instanceof DocumentRejected) {
        // Stages 2 to 5 of ADR-006 validation. No session stays exposed; the main thread keeps the file text.
        this.#session = undefined; this.#architecture = undefined;
        this.#emit({ version: 1, requestId: command.requestId, type: "error", error: applicationError("INVALID_DOCUMENT",
          "The scenario document is not valid.", { diagnostics: detached(error.diagnostics) as unknown as CanonicalValue }) });
        return;
      }
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
    const results = detached(session.results()) as unknown as CanonicalValue;
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
        ...(sameReference(this.#catalog, commerceCatalogReference) ? commerceComponents(read, this.#definition!, results)
          : checkoutComponents(read, this.#definition!, results)),
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
