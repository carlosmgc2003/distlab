import type {
  AssertionResult,
  ClientDefinition,
  ExternalController,
  ExternalDefinition,
  FaultDecisionPort,
  MessageBus,
  ScenarioDefinition,
  ScenarioDiagnostic,
  ScenarioEngine,
  ScenarioSession,
  ServiceDefinition,
} from "@distlab/contracts";
import { ScenarioObservationTypes } from "@distlab/contracts";
import type {
  CanonicalValue,
  ExecutionHistoryReader,
  RunInputs,
  SimulationStatus,
  SimulationTime,
} from "@distlab/contracts/kernel";
import { ErrorCodes, SEEDED_RANDOM_ALGORITHM, throwSimulationError } from "@distlab/contracts/kernel";
import {
  DeterministicClientRuntime,
  DeterministicDatabase,
  DeterministicExternalServiceRuntime,
  DeterministicFaultEngine,
  DeterministicServiceRuntime,
  HeadlessSimulation,
  HeadlessSimulationFactory,
  canonicalCopy,
} from "@distlab/kernel";
import type { AssessmentProjection, ScenarioAssessment, ScenarioCatalog, ScenarioPredicate } from "./types.js";
import { normalizeScenario } from "./validate.js";
import { startAssessment } from "./assessment.js";

function fail(code: string, context: CanonicalValue = null): never {
  return throwSimulationError(code, context);
}
const RUNTIME_VERSION = "1";
const actionType = (id: string): string => `scenario.action.${id}`;
const assertionType = "scenario.assertion";
const actionKinds = new Set(["client", "service", "external", "external-behavior", "fault"]);

export interface ScenarioEngineOptions {
  readonly catalog: ScenarioCatalog;
  readonly assessment: ScenarioAssessment;
}

interface AttemptCell {
  results: () => readonly AssertionResult[];
  project: (time: SimulationTime, status: SimulationStatus) => AssessmentProjection;
  bindRuntime: () => void;
}

interface RuntimeBag {
  clients: Map<string, DeterministicClientRuntime>;
  services: Map<string, DeterministicServiceRuntime>;
  externals: Map<string, DeterministicExternalServiceRuntime>;
  databases: Map<string, DeterministicDatabase>;
  inspectStore: (owner: string) => CanonicalValue;
  inspectBus?: () => CanonicalValue;
}

/** Application adapter. The kernel package does not import this module. */
export class DeterministicScenarioEngine implements ScenarioEngine {
  readonly #options: ScenarioEngineOptions;
  constructor(options: ScenarioEngineOptions) {
    if (!options?.catalog || !options.assessment || !options.catalog.id.trim() || !options.catalog.version.trim() || !options.assessment.version.trim()) {
      fail(ErrorCodes.INVALID_SCENARIO);
    }
    this.#options = options;
  }

  validate(input: CanonicalValue): readonly ScenarioDiagnostic[] {
    return normalizeScenario(input, this.#options.catalog, this.#options.assessment).diagnostics;
  }

  create(input: CanonicalValue): DeterministicScenarioSession {
    const normalized = normalizeScenario(input, this.#options.catalog, this.#options.assessment);
    if (!normalized.scenario) fail(ErrorCodes.INVALID_SCENARIO, canonicalCopy(normalized.diagnostics));
    return compose(normalized.scenario, this.#options.catalog, this.#options.assessment);
  }
}

export class DeterministicScenarioSession implements ScenarioSession {
  readonly simulation: HeadlessSimulation;
  readonly #cell: AttemptCell;
  constructor(simulation: HeadlessSimulation, cell: AttemptCell) {
    this.simulation = simulation;
    this.#cell = cell;
  }
  results(): readonly AssertionResult[] {
    return this.#cell.results();
  }
  /** Detached component, resource, and history projection for the current generation. */
  projection(): AssessmentProjection {
    return this.#cell.project(this.simulation.time, this.simulation.status);
  }
  /** Returns a closure over this generation's runtime port. Reset makes that closure stale. */
  bindRuntime(): () => void {
    const touch = this.#cell.bindRuntime;
    return () => touch();
  }
}

function compose(scenario: ScenarioDefinition, catalog: ScenarioCatalog, assessment: ScenarioAssessment): DeterministicScenarioSession {
  const predicates = new Map<string, ScenarioPredicate>();
  for (const assertion of scenario.assertions) {
    const predicate = assessment.find(assertion.predicate);
    if (!predicate) fail(ErrorCodes.INVALID_SCENARIO);
    predicates.set(assertion.predicate, predicate);
  }
  const live: { simulation?: HeadlessSimulation } = {};
  const current = (): HeadlessSimulation => live.simulation ?? fail(ErrorCodes.INVALID_OPERATION);
  const bag: RuntimeBag = {
    clients: new Map(), services: new Map(), externals: new Map(), databases: new Map(),
    inspectStore: () => null,
  };
  const cell: AttemptCell = {
    results: () => [],
    project: (time, status) => project(scenario, bag, current().history, time, status),
    bindRuntime: () => fail(ErrorCodes.STALE_CAPABILITY),
  };
  let engine: DeterministicFaultEngine | undefined;
  const needsFaults = scenario.faults.length > 0 || scenario.actions.some(action => action.kind === "fault");
  const faultPort: FaultDecisionPort = { evaluate: probe => engine ? engine.evaluate(probe) : fail(ErrorCodes.INVALID_FAULT) };
  const hasBus = scenario.architecture.destinations.length > 0;
  const factory = new HeadlessSimulationFactory({
    network: {
      targets: scenario.architecture.components.map(component => component.id),
      links: scenario.architecture.links.map(link => ({ source: link.source, target: link.target, policy: link.policy })),
      ...(needsFaults ? { faults: faultPort } : {}),
    },
    ...(hasBus ? { messageBus: {
      destinations: scenario.architecture.destinations.map(destination => ({
        id: destination.id, kind: destination.kind, deliveryDelay: destination.deliveryDelay, ackTimeout: destination.ackTimeout,
        retryDelay: destination.retryDelay, maxAttempts: destination.maxAttempts, capacity: destination.capacity,
      })),
      ...(needsFaults ? { faults: faultPort } : {}),
    } } : {}),
    ...(scenario.architecture.stores.length ? { keyValues: scenario.architecture.stores } : {}),
    createBoundaryHook: (history, observations) => {
      const attempt = startAssessment({
        assertions: scenario.assertions,
        predicates,
        startTime: scenario.startTime,
        project: time => project(scenario, bag, history, time, "RUNNING"),
        record: input => observations.record(input),
      });
      cell.results = () => attempt.results;
      return attempt;
    },
  });
  const simulation = factory.createSimulation(runInputs(scenario, catalog, assessment), setup => {
    bag.clients.clear(); bag.services.clear(); bag.externals.clear(); bag.databases.clear();
    registerSchemas(setup);
    const events: MessageBus = { publish: () => fail(ErrorCodes.INVALID_MESSAGE_OPERATION) };
    for (const definition of scenario.architecture.databases) {
      const owner = scenario.architecture.components.find(component => component.id === definition.owner);
      const model = owner ? catalog.find(owner.model, owner.version) : undefined;
      bag.databases.set(definition.owner, new DeterministicDatabase({
        definition, checks: model?.checks ?? {}, setup, clock: { now: () => current().time },
        schedule: (type, payload) => current().scheduleStorage(type, payload),
        operations: { create: () => current().operations.create(), complete: (id, outcome) => current().operations.complete(id, outcome) },
        observations: { record: input => current().storageObservations.record(input) },
        task: () => current().activeTaskIdentity, event: () => current().activeTaskEvent,
        ...(needsFaults ? { faults: faultPort } : {}),
      }));
    }
    for (const component of scenario.architecture.components) {
      const model = catalog.find(component.model, component.version) ?? fail(ErrorCodes.INVALID_SCENARIO);
      if (component.kind === "service") {
        const db = bag.databases.get(component.id);
        bag.services.set(component.id, new DeterministicServiceRuntime({
          id: component.id, version: component.version, setup,
          resolve: () => model.instantiate(component) as ServiceDefinition,
          taskLifecycle: () => current().taskLifecycle, activeOwner: () => current().activeTaskOwner, activeEvent: () => current().activeEvent,
          events: hasBus ? setup.messageBusFor(component.id) : events,
          ...(hasBus ? { busController: setup.messageBusController() } : {}),
          ...(db ? { db } : {}),
        }));
      } else if (component.kind === "client") {
        bag.clients.set(component.id, new DeterministicClientRuntime({
          id: component.id, version: component.version, setup, scenarioEventType: actionType(component.id),
          resolve: () => model.instantiate(component) as ClientDefinition,
          activeOwner: () => current().activeTaskOwner, activeEvent: () => current().activeEvent,
        }));
      } else {
        const behaviors = scenario.external.filter(entry => entry.target === component.id);
        bag.externals.set(component.id, new DeterministicExternalServiceRuntime({
          definition: model.instantiate(component) as ExternalDefinition,
          setup, scenarioEventType: actionType(component.id), activeOwner: () => current().activeTaskOwner, activeEvent: () => current().activeEvent,
          ...(behaviors.length ? { configure: (controller: ExternalController) => {
            for (const entry of behaviors) controller.configure(entry.operation, entry.behavior);
          } } : {}),
        }));
      }
    }
    if (needsFaults) {
      const crash: Record<string, () => void> = {};
      const externalAvailability: Record<string, (state: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED") => void> = {};
      for (const [id, service] of bag.services) crash[id] = () => service.crash(current().activeEvent ?? fail(ErrorCodes.INVALID_FAULT));
      for (const [id, external] of bag.externals) externalAvailability[id] = state => external.dispatch(current().activeEvent ?? fail(ErrorCodes.INVALID_FAULT), controller => controller.setAvailability(state));
      engine = new DeterministicFaultEngine({
        rules: scenario.faults, components: scenario.architecture.components.map(component => component.id),
        clock: { now: () => current().time }, random: { draw: label => current().random.draw(label) },
        observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
        activeEvent: () => current().activeEvent, crash, externalAvailability,
      });
    }
    const actions = new Map(scenario.actions.map(action => [action.id, action]));
    for (const component of scenario.architecture.components) {
      setup.registerHandler(actionType(component.id), component.id, (event, context) => {
        const actionId = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? (event.payload as { actionId?: string }).actionId : undefined;
        const action = actionId ? actions.get(actionId) : undefined;
        if (!action) fail(ErrorCodes.INVALID_SCENARIO);
        const target = action.kind === "fault" ? action.fault.target : action.target;
        context.observations.record({
          type: ScenarioObservationTypes.ActionDispatched, source: component.id, eventId: event.id,
          entityRefs: [{ kind: component.kind, id: component.id }],
          data: { actionId: action.id, kind: action.kind, target },
        });
        if (action.kind === "client") bag.clients.get(component.id)?.dispatch(event, context, controller => controller.start(action.id, action.action, action.data));
        else if (action.kind === "external") bag.externals.get(component.id)?.dispatch(event, controller => controller.setAvailability(action.state));
        else if (action.kind === "external-behavior") bag.externals.get(component.id)?.dispatch(event, controller => controller.configure(action.operation, action.behavior));
        else if (action.kind === "fault") (engine ?? fail(ErrorCodes.INVALID_FAULT)).apply(action.fault);
      });
    }
    if (scenario.assertions.some(assertion => assertion.mode !== "always")) setup.registerHandler(assertionType, "simulation", () => {});
    bag.inspectStore = owner => canonicalCopy(setup.inspectKeyValueStore(owner));
    if (hasBus) bag.inspectBus = () => canonicalCopy(setup.inspectMessageBus());
    cell.bindRuntime = () => { setup.networkInFlight(); };
    cell.project = (time, status) => project(scenario, bag, current().history, time, status);
    // Resource expiries arm on the first schedule, before these drafts, in store then key order.
    for (const action of scenario.actions) {
      const target = action.kind === "fault" ? action.fault.target : action.target;
      setup.schedule({ time: action.at, type: actionType(target), payload: { actionId: action.id } });
      if (action.kind === "service") setup.schedule({ time: action.at, type: bag.services.get(action.target)?.lifecycleEventType ?? fail(ErrorCodes.INVALID_SCENARIO), payload: { next: action.state } });
    }
    for (const assertion of scenario.assertions) {
      if (assertion.mode === "at" && assertion.at !== undefined) setup.schedule({ time: assertion.at, type: assertionType, payload: { assertionId: assertion.id } });
      if (assertion.mode === "eventually" && assertion.deadline !== undefined) setup.schedule({ time: assertion.deadline, type: assertionType, payload: { assertionId: assertion.id } });
    }
  });
  live.simulation = simulation;
  return new DeterministicScenarioSession(simulation, cell);
}

function project(scenario: ScenarioDefinition, bag: RuntimeBag, history: ExecutionHistoryReader, time: SimulationTime, status: SimulationStatus): AssessmentProjection {
  const read = (load: () => unknown): CanonicalValue => { try { return canonicalCopy(load()); } catch { return null; } };
  const components: Record<string, CanonicalValue> = {};
  for (const component of scenario.architecture.components) {
    const client = bag.clients.get(component.id);
    const service = bag.services.get(component.id);
    const external = bag.externals.get(component.id);
    components[component.id] = read(() => client ? client.inspect() : service ? service.inspect() : external ? external.boundary() : null);
  }
  const databases: Record<string, CanonicalValue> = {};
  for (const [owner, database] of bag.databases) databases[owner] = read(() => database.inspect());
  const stores: Record<string, CanonicalValue> = {};
  for (const store of scenario.architecture.stores) stores[store.owner] = read(() => bag.inspectStore(store.owner));
  return Object.freeze({
    time, status, history: read(() => history.export()), components: canonicalCopy(components), databases: canonicalCopy(databases),
    stores: canonicalCopy(stores), messageBus: bag.inspectBus ? read(bag.inspectBus) : null,
  });
}

function registerSchemas(setup: { registerObservationSchema: (type: string, validate: (data: CanonicalValue | undefined) => boolean) => void }): void {
  setup.registerObservationSchema(ScenarioObservationTypes.ActionDispatched, data => plain(data)
    && typeof data.actionId === "string" && data.actionId.length > 0
    && typeof data.kind === "string" && actionKinds.has(data.kind)
    && typeof data.target === "string" && data.target.length > 0
    && Object.keys(data).every(key => key === "actionId" || key === "kind" || key === "target"));
  setup.registerObservationSchema(ScenarioObservationTypes.AssertionEvaluated, data => plain(data)
    && typeof data.assertionId === "string" && typeof data.verdict === "boolean" && Object.hasOwn(data, "evidence")
    && (data.boundaryEvent === undefined || typeof data.boundaryEvent === "string")
    && Object.keys(data).every(key => key === "assertionId" || key === "verdict" || key === "evidence" || key === "boundaryEvent"));
}

function runInputs(scenario: ScenarioDefinition, catalog: ScenarioCatalog, assessment: ScenarioAssessment): RunInputs {
  const modelVersions: Record<string, string> = {
    "kernel.random": SEEDED_RANDOM_ALGORITHM,
    "kernel.scenario-engine": RUNTIME_VERSION,
    "kernel.client-runtime": RUNTIME_VERSION,
    "kernel.service-runtime": RUNTIME_VERSION,
    "kernel.external-service-runtime": RUNTIME_VERSION,
    "kernel.fault-engine": RUNTIME_VERSION,
    "kernel.network": RUNTIME_VERSION,
    "kernel.message-bus": RUNTIME_VERSION,
    "kernel.database": RUNTIME_VERSION,
    "kernel.kv-store": RUNTIME_VERSION,
    [`catalog.${catalog.id}`]: catalog.version,
    "assessment": assessment.version,
  };
  for (const component of scenario.architecture.components) modelVersions[`model.${component.id}`] = `${component.model}@${component.version}`;
  for (const assertion of scenario.assertions) {
    const predicate = assessment.find(assertion.predicate);
    if (predicate) modelVersions[`predicate.${assertion.id}`] = `${predicate.id}@${predicate.version}`;
  }
  const document = canonicalCopy({
    version: scenario.version, name: scenario.name, seed: scenario.seed, startTime: scenario.startTime,
    architecture: scenario.architecture, external: scenario.external, faults: scenario.faults,
    actions: scenario.actions, assertions: scenario.assertions, configuration: scenario.configuration,
  });
  return {
    contractVersion: 1,
    modelVersions,
    architecture: canonicalCopy(scenario.architecture),
    scenario: document,
    configuration: scenario.configuration,
    seed: scenario.seed,
  };
}

function plain(value: CanonicalValue | undefined): value is { [key: string]: CanonicalValue } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
