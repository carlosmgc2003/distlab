import type { BoundaryReadHook, CanonicalValue, ClockController, ComponentId, ControlledOperation, ControlledTask, Duration, ScheduleMetadata, EventHandler, ExecutionHistoryReader, HandlerContext, HistoryController, ObservationInput, ObservationSink, OperationController, OperationOutcome, RunInputs, RunOptions, RunResult, ScheduledEvent, ScheduledHandle, Scheduler, SeededRandomPort, Simulation, SimulationError, SimulationFactory, SimulationSetup, SimulationStatus, SimulationStep, TaskLifecycleController, VirtualClock } from "@distlab/contracts/kernel";
import { ErrorCodes, SimulationObservationTypes as Obs, throwSimulationError, simulationTime } from "@distlab/contracts/kernel";
import { canonicalCopy, fingerprintRunInputs } from "./canonical.js";
import { DeterministicVirtualClock, type ClockOptions } from "./clock.js";
import { DeterministicScheduler, type SchedulerOptions } from "./scheduler.js";
import { ExecutionHistory, type ExecutionHistoryOptions } from "./history.js";
import { DeterministicIdAllocator } from "./identity.js";
import { SeededRandom } from "./random.js";
import { DeterministicVirtualNetwork, type NetworkLinks, type NetworkSetup } from "./network.js";
import { DeterministicMessageBus, neutralFaultPort, type MessageBusInspection, type MessageCounterStart, type MessageDestinationInput } from "./message-bus.js";
import type { FaultDecisionPort, MessageBus, MessageBusController } from "@distlab/contracts";

/** Setup surface passed to a service adapter, including the terminal latch. */
export type RuntimeSetup = SimulationSetup & NetworkSetup & {
  /** Latch a terminal adapter error. A handler catch does not clear the run. */
  failTask(code: string): never;
  /** Owner-bound publish port. Admission success is not consumption. */
  messageBusFor(owner: ComponentId): MessageBus;
  messageBusController(): MessageBusController;
  /** Detached destinations, routing records, cursors, counters, and dead letters. */
  inspectMessageBus(): MessageBusInspection;
};

export type CoreClockPort = VirtualClock & ClockController & {
  advanceTo(time: ReturnType<VirtualClock["now"]>, causingEventId?: string): void;
  forOwner(owner: ComponentId, allowedTypes: ReadonlySet<string>): VirtualClock;
  resumeSleep(eventId: string, taskId: string): void;
};
export type CoreSchedulerPort = Scheduler & {
  forOwner(owner: ComponentId, allowedTypes: ReadonlySet<string>): Pick<Scheduler, "schedule">;
};
export type CoreHistoryPort = ObservationSink & ExecutionHistoryReader & HistoryController & {
  registerSchema(type: string, validate: (data: CanonicalValue | undefined) => boolean): void;
  flushNotifications(): void;
};

type Task = { id: string; owner: string; event: ScheduledEvent; generator: ControlledTask; waiting: string | undefined; created: string | undefined; processGeneration: number };
type Operation = { task: Task; handle: ControlledOperation; settled: boolean; wake?: ScheduledHandle };

export interface HeadlessFactoryOptions {
  /** Port constructors run anew on every reset; the core never owns adapter state across attempts. */
  readonly createClock?: (options: ClockOptions) => CoreClockPort;
  readonly createScheduler?: (options: SchedulerOptions) => CoreSchedulerPort;
  readonly createHistory?: (options: ExecutionHistoryOptions) => CoreHistoryPort;
  readonly createRandom?: (seed: string) => SeededRandomPort;
  /** Construct a fresh read-only assessment hook for every attempt, before setup. */
  readonly createBoundaryHook?: (history: ExecutionHistoryReader, observations: ObservationSink) => BoundaryReadHook;
  /** Network configuration and neutral or injected fault decisions, recreated on reset. */
  readonly network?: { readonly targets: readonly ComponentId[]; readonly links: NetworkLinks; readonly faults?: FaultDecisionPort };
  /** Broker destinations recreated on reset. Fault decisions default to a neutral port. */
  readonly messageBus?: { readonly destinations: readonly MessageDestinationInput[]; readonly faults?: FaultDecisionPort; readonly initialCounters?: MessageCounterStart };
}

/** Yield only between boundaries; never consult host time or change modeled state. */
function yieldToHost(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}
const wakeType = "kernel.sleep.wake";
const isError = (error: unknown): error is SimulationError => !!error && typeof error === "object" && typeof (error as SimulationError).code === "string" && "context" in error;
const fail = (code: string): never => throwSimulationError(code);

/** A headless composition root. Each attempt owns its own concrete ports. */
export class HeadlessSimulationFactory implements SimulationFactory {
  readonly #options: HeadlessFactoryOptions;
  constructor(options: HeadlessFactoryOptions = {}) { this.#options = Object.freeze({ ...options }); }
  createSimulation(inputs: RunInputs, initialize: (setup: RuntimeSetup) => void): HeadlessSimulation {
    return new HeadlessSimulation(inputs, initialize, this.#options);
  }
}

export class HeadlessSimulation implements Simulation {
  #status: SimulationStatus = "READY";
  #locked = false;
  #pause = false;
  #failure: SimulationError | undefined;
  #generation = 0;
  #total = 0;
  #active: Task | undefined;
  #dispatching = false;
  #event: ScheduledEvent | undefined;
  #originEvent: ScheduledEvent | undefined;
  #tasks = new Map<string, Task>();
  #processGenerations = new Map<string, number>();
  #operations = new Map<string, Operation>();
  #handlers = new Map<string, { owner: string; handler: EventHandler }>();
  #taskIds!: DeterministicIdAllocator;
  #operationIds!: DeterministicIdAllocator;
  #clock!: CoreClockPort;
  #scheduler!: CoreSchedulerPort;
  #history!: CoreHistoryPort;
  #random!: SeededRandomPort;
  readonly #inputs!: RunInputs;
  readonly #initialize!: (setup: RuntimeSetup) => void;
  readonly #runId!: string;
  readonly #options: HeadlessFactoryOptions;
  #boundaryHook: BoundaryReadHook | undefined;

  constructor(inputs: RunInputs, initialize: (setup: RuntimeSetup) => void, options: HeadlessFactoryOptions = {}) {
    this.#options = options;
    try {
      const copied = canonicalCopy(inputs) as unknown as RunInputs;
      if (!copied || typeof copied !== "object" || Array.isArray(copied) ||
          !["contractVersion", "modelVersions", "architecture", "scenario", "configuration", "seed"].every(key => Object.hasOwn(copied, key)) ||
          copied.contractVersion !== 1 || typeof copied.seed !== "string" || !copied.seed.trim() ||
          !copied.modelVersions || typeof copied.modelVersions !== "object" || Array.isArray(copied.modelVersions) ||
          !Object.keys(copied.modelVersions).every(k => k.trim().length > 0 && typeof copied.modelVersions[k] === "string" && !!copied.modelVersions[k]?.trim()) ||
          !copied.configuration || typeof copied.configuration !== "object" || Array.isArray(copied.configuration) ||
          !["startTime", "historyLimit", "visibility", "models"].every(key => Object.hasOwn(copied.configuration, key)) ||
          !Number.isSafeInteger(copied.configuration.historyLimit) || copied.configuration.historyLimit <= 0) fail(ErrorCodes.INVALID_RUN_INPUT);
      simulationTime(copied.configuration.startTime);
      this.#inputs = canonicalCopy({ ...copied, seed: copied.seed.trim().normalize("NFC") }) as unknown as RunInputs;
      this.#runId = fingerprintRunInputs(this.#inputs);
      this.#initialize = initialize;
    } catch { return fail(ErrorCodes.INVALID_RUN_INPUT); }
    this.#compose();
  }
  get status(): SimulationStatus { return this.#status; }
  /** Trusted adapters use this to fence owner-bound capabilities. */
  get activeTaskOwner(): ComponentId | undefined {
    return this.#active?.owner ?? (this.#dispatching && this.#event ? this.#handlers.get(this.#event.type)?.owner : undefined);
  }
  /** Trusted storage adapters use task identity to fence writable handles. */
  get activeTaskIdentity(): Readonly<{ id: string; owner: ComponentId; processGeneration: number }> | undefined {
    const task = this.#active;
    if (task) return Object.freeze({ id: task.id, owner: task.owner, processGeneration: task.processGeneration });
    const event = this.#dispatching ? this.#event : undefined;
    const owner = event && this.#handlers.get(event.type)?.owner;
    const processGeneration = owner ? this.#processGenerations.get(owner) : undefined;
    return event && owner && processGeneration !== undefined
      ? Object.freeze({ id: `dispatch:${event.id}`, owner, processGeneration }) : undefined;
  }
  /** Trusted adapter ports; every use remains subject to the run's terminal latch. */
  get storageObservations(): ObservationSink { const generation = this.#generation; return Object.freeze({
    record: (input: ObservationInput) => this.#guard(generation, () => { this.#check(generation); return this.#history.record(input); }),
  }); }
  scheduleStorage(type: string, payload: CanonicalValue): void {
    const generation = this.#generation;
    this.#guard(generation, () => {
      this.#check(generation);
      const owner = this.#active?.owner;
      if (!owner || this.#handlers.get(type)?.owner !== owner) return fail(ErrorCodes.INVALID_EVENT_TYPE);
      const event = this.#originEvent ?? this.#event;
      this.#scheduler.schedule({ time: this.#clock.now(), type, payload, source: owner, target: owner,
        ...(event?.traceId ? { traceId: event.traceId } : {}), ...(event?.spanId ? { spanId: event.spanId } : {}),
        ...(event?.parentSpanId ? { parentSpanId: event.parentSpanId } : {}), ...(event?.causationId ? { causationId: event.causationId } : {}) });
    });
  }
  /** Event whose handler is on the stack. Adapters use it to reject stale dispatch. */
  get activeEvent(): ScheduledEvent | undefined { return this.#event; }
  get time() { return this.#clock.now(); }
  get history(): ExecutionHistoryReader {
    const history = this.#history;
    const reader: ExecutionHistoryReader = { all: () => history.all(), query: filter => history.query(filter),
      byId: id => history.byId(id), export: () => history.export(),
      subscribe: listener => history.subscribe(listener) };
    return Object.freeze(reader);
  }
  get random(): SeededRandomPort {
    const generation = this.#generation;
    return Object.freeze({ draw: (label: string) => this.#guard(generation, () => { this.#check(generation); return this.#random.draw(label); }) });
  }
  get operations(): OperationController { const generation = this.#generation; return Object.freeze({
    create: () => this.#guard(generation, () => { this.#check(generation); const task = this.#active; if (!task || task.created || task.waiting) return fail(ErrorCodes.INVALID_OPERATION);
      const id = this.#operationIds.allocate(); const handle = Object.freeze({ operationId: id });
      task.created = id; this.#operations.set(id, { task, handle, settled: false }); return handle; }),
    complete: (id: string, outcome: OperationOutcome) => this.#guard(generation, () => { this.#check(generation); if (!this.#dispatching) return fail(ErrorCodes.INVALID_OPERATION);
      const operation = this.#operations.get(id); if (!operation) return fail(ErrorCodes.INVALID_OPERATION);
      if (operation.settled || !this.#tasks.has(operation.task.id)) return;
      if (operation.task.waiting !== id) return fail(ErrorCodes.INVALID_OPERATION);
      if (!outcome || (outcome.kind !== "success" && outcome.kind !== "failure")) fail(ErrorCodes.INVALID_OPERATION);
      let value: CanonicalValue | SimulationError;
      try {
        if (outcome.kind === "success") value = canonicalCopy(outcome.value);
        else {
          if (!isError(outcome.error) || !outcome.error.code) fail(ErrorCodes.INVALID_OPERATION);
          value = { code: outcome.error.code, context: canonicalCopy(outcome.error.context) };
        }
      } catch { return fail(ErrorCodes.INVALID_OPERATION); }
      operation.settled = true; operation.task.waiting = undefined;
      this.#advance(operation.task, value, outcome.kind === "failure");
    }),
  }); }
  get taskLifecycle(): TaskLifecycleController { const generation = this.#generation; return Object.freeze({ abandon: (owner: string, processGeneration: number) => this.#guard(generation, () => {
    this.#check(generation);
    if (!this.#dispatching || !owner || !Number.isSafeInteger(processGeneration) || processGeneration < 0 ||
        this.#processGenerations.get(owner) !== processGeneration) fail(ErrorCodes.INVALID_OPERATION);
    if (processGeneration === Number.MAX_SAFE_INTEGER) fail(ErrorCodes.IDENTITY_OVERFLOW);
    for (const task of this.#tasks.values()) if (task.owner === owner && task.processGeneration === processGeneration) {
      this.#tasks.delete(task.id);
      for (const id of [task.created, task.waiting]) {
        if (!id) continue;
        const operation = this.#operations.get(id);
        if (operation) { operation.settled = true; operation.wake?.cancel(); }
      }
    }
    this.#processGenerations.set(owner, processGeneration + 1);
  }) }); }
  #guard<T>(generation: number, action: () => T): T {
    if (generation === this.#generation && this.#failure) throw this.#failure;
    try { return action(); }
    catch (error) {
      if (this.#dispatching || generation === this.#generation) this.#terminal(error, this.#event);
      throw (generation === this.#generation ? this.#failure : undefined) ?? error;
    }
  }
  #boundHandle<T extends { eventId: string; dueTime: ReturnType<CoreClockPort["now"]>; cancel(): boolean }>(handle: T, generation: number): T {
    return Object.freeze({ eventId: handle.eventId, dueTime: handle.dueTime, cancel: () => this.#guard(generation, () => { this.#check(generation); return handle.cancel(); }) }) as T;
  }
  #check(generation: number): void {
    if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
    if (this.#failure) throw this.#failure;
  }
  #record(type: string, event?: ScheduledEvent, data?: CanonicalValue): void {
    this.#history.record({ type, source: "simulation", ...(event ? { eventId: event.id } : {}), ...(data === undefined ? {} : { data }) });
  }
  #compose(): void {
    const generation = ++this.#generation;
    this.#failure = undefined;
    this.#status = "READY";
    this.#boundaryHook = undefined;
    this.#total = 0; this.#tasks = new Map(); this.#operations = new Map(); this.#processGenerations = new Map();
    this.#handlers = new Map([[wakeType, { owner: "simulation", handler: e => {
      const id = (e.payload as { operationId: string }).operationId;
      const op = this.#operations.get(id);
      if (op && !op.settled && this.#tasks.has(op.task.id)) {
        this.#clock.resumeSleep(e.id, op.task.id);
        this.operations.complete(id, { kind: "success", value: null });
      }
    } }]]);
    this.#taskIds = new DeterministicIdAllocator("task", this.#runId);
    this.#operationIds = new DeterministicIdAllocator("operation", this.#runId);
    this.#random = this.#options.createRandom?.(this.#inputs.seed) ?? new SeededRandom(this.#inputs.seed);
    const clockOptions: ClockOptions = { startTime: this.#inputs.configuration.startTime,
      scheduler: { schedule: draft => { this.#check(generation); return this.#scheduler.schedule(draft); } },
      observations: { record: input => { this.#check(generation); return this.#history.record(input); } },
      sleep: { active: () => generation === this.#generation && !!this.#active, scheduleWake: dueTime => {
        const task = this.#active!;
        const operation = this.operations.create();
        const handle = this.#scheduler.schedule({ time: dueTime, type: wakeType, payload: { operationId: operation.operationId }, source: "simulation", target: "simulation" });
        this.#operations.get(operation.operationId)!.wake = handle;
        return { operation, handle, taskId: task.id };
      } },
    };
    this.#clock = this.#options.createClock?.(clockOptions) ?? new DeterministicVirtualClock(clockOptions);
    const historyOptions: ExecutionHistoryOptions = { runId: this.#runId, clock: this.#clock, historyLimit: this.#inputs.configuration.historyLimit, visibility: this.#inputs.configuration.visibility };
    this.#history = this.#options.createHistory?.(historyOptions) ?? new ExecutionHistory(historyOptions);
    for (const type of [...Object.values(Obs), "scheduler.event.scheduled", "scheduler.event.cancelled", "scheduler.event.dispatched", "clock.advanced", "clock.sleep.scheduled", "clock.sleep.resumed"]) this.#history.registerSchema(type, () => true);
    const owners = new Map<string, string>([[wakeType, "simulation"]]);
    const schedulerOptions: SchedulerOptions = { runId: this.#runId, clock: this.#clock, handlers: owners, observations: this.#history };
    this.#scheduler = this.#options.createScheduler?.(schedulerOptions) ?? new DeterministicScheduler(schedulerOptions);
    // Record through the run guard so a caught sink failure still seals the run.
    const networkObservations = {
      record: (input: ObservationInput) => this.#guard(generation, () => {
        this.#check(generation);
        try { return this.#history.record(input); }
        catch (error) { this.#terminal(error, this.#event, ErrorCodes.HANDLER_FAILED, input.type); throw this.#failure; }
      }),
      registerSchema: (type: string, validate: (data: CanonicalValue | undefined) => boolean) => this.#history.registerSchema(type, validate),
    };
    const network = this.#options.network ? new DeterministicVirtualNetwork({
      ...this.#options.network, clock: this.#clock, scheduler: this.#scheduler, operations: this.operations,
      observations: networkObservations, random: this.random, runId: this.#runId,
      activeOwner: () => this.#active?.owner, dispatching: () => this.#dispatching,
      correlation: () => { const event = this.#originEvent ?? this.#event; return event ? { ...(event.traceId ? { traceId: event.traceId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}), eventId: event.id } : {}; },
      check: () => this.#check(generation),
    }) : undefined;
    if (network) for (const [type, handler] of network.handlers()) { owners.set(type, "simulation"); this.#handlers.set(type, { owner: "simulation", handler }); }
    const messageBus = this.#options.messageBus ? new DeterministicMessageBus({
      runId: this.#runId, destinations: this.#options.messageBus.destinations, clock: this.#clock, scheduler: this.#scheduler,
      operations: this.operations, observations: networkObservations, faults: this.#options.messageBus.faults ?? neutralFaultPort,
      ...(this.#options.messageBus.initialCounters ? { initialCounters: this.#options.messageBus.initialCounters } : {}),
      activeOwner: () => this.#active?.owner, dispatching: () => this.#dispatching,
      correlation: () => { const event = this.#originEvent ?? this.#event; return event ? { ...(event.traceId ? { traceId: event.traceId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}), eventId: event.id } : {}; },
      check: () => this.#check(generation),
    }) : undefined;
    if (messageBus) for (const [type, handler] of messageBus.handlers()) { owners.set(type, "simulation"); this.#handlers.set(type, { owner: "simulation", handler }); }
    let sealed = false;
    let active = true;
    const setup: RuntimeSetup = Object.freeze({
      failTask: (code: string): never => this.#guard(generation, () => fail(code)),
      networkFor: (owner: ComponentId) => { this.#check(generation); if (!active || !network) return fail(ErrorCodes.INVALID_REGISTRATION); return network.forOwner(owner); },
      networkController: () => { this.#check(generation); if (!active || !network) return fail(ErrorCodes.INVALID_REGISTRATION); return network.controller; },
      networkInFlight: () => { this.#check(generation); if (!network) return fail(ErrorCodes.INVALID_REGISTRATION); return network.inFlight(); },
      messageBusFor: (owner: ComponentId) => { this.#check(generation); if (!active || !messageBus) return fail(ErrorCodes.INVALID_REGISTRATION); return messageBus.forOwner(owner); },
      messageBusController: () => { this.#check(generation); if (!active || !messageBus) return fail(ErrorCodes.INVALID_REGISTRATION); return messageBus.controller; },
      inspectMessageBus: () => { this.#check(generation); if (!messageBus) return fail(ErrorCodes.INVALID_REGISTRATION); return messageBus.inspect(); },
      enqueueNetworkWork: (owner: ComponentId, type: string, payload: CanonicalValue) => this.#guard(generation, () => {
        this.#check(generation);
        if (!this.#dispatching || !network || this.#handlers.get(type)?.owner !== owner) return fail(ErrorCodes.INVALID_EVENT_TYPE);
        const event = this.#event;
        return this.#boundHandle(this.#scheduler.schedule({ time: this.#clock.now(), type, payload,
          source: owner, target: owner, ...(event?.traceId ? { traceId: event.traceId } : {}),
          ...(event?.spanId ? { spanId: event.spanId } : {}), ...(event?.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
          ...(event?.causationId ? { causationId: event.causationId } : {}) }), generation);
      }),
      registerHandler: (type: string, owner: string, handler: EventHandler) => {
        this.#check(generation);
        if (!active) fail(ErrorCodes.STALE_CAPABILITY);
        if (sealed || !type || !owner || typeof handler !== "function" || /^(simulation|scheduler|clock|kernel)\./.test(type) || owners.has(type)) fail(ErrorCodes.INVALID_REGISTRATION);
        owners.set(type, owner); this.#handlers.set(type, { owner, handler });
        if (!this.#processGenerations.has(owner)) this.#processGenerations.set(owner, 0);
      },
      registerObservationSchema: (type: string, validate: (data: CanonicalValue | undefined) => boolean) => {
        this.#check(generation);
        if (!active) fail(ErrorCodes.STALE_CAPABILITY);
        if (sealed || /^(simulation|scheduler|clock|kernel)\./.test(type)) fail(ErrorCodes.INVALID_REGISTRATION);
        this.#history.registerSchema(type, validate);
      },
      schedule: (draft: Parameters<SimulationSetup["schedule"]>[0]) => {
        this.#check(generation); if (!active) fail(ErrorCodes.STALE_CAPABILITY); sealed = true; network?.seal(); messageBus?.seal();
        if (draft.type === wakeType) return fail(ErrorCodes.INVALID_EVENT_TYPE);
        return this.#boundHandle(this.#scheduler.schedule(draft), generation);
      },
    });
    try {
      this.#record(Obs.Created, undefined, { runId: this.#runId, inputFingerprint: this.#runId });
      const history = this.#history;
      this.#boundaryHook = this.#options.createBoundaryHook?.(this.history, Object.freeze({ record: (input: ObservationInput) => this.#guard(generation, () => {
        this.#check(generation); return history.record(input);
      }) }));
      this.#initialize(setup);
      network?.seal();
      messageBus?.seal();
      sealed = true; active = false;
      this.#boundaryHook?.afterInitialization();
      this.#status = "READY";
    } catch (error) {
      sealed = true; active = false;
      this.#terminal(generation === 1 && isError(error)
        ? error
        : { code: ErrorCodes.INITIALIZATION_FAILED, context: isError(error) ? { cause: error.code } : null });
      throw this.#failure;
    }
  }
  #advance(task: Task, value?: CanonicalValue | SimulationError, failure = false): "COMPLETED" | "SUSPENDED" {
    this.#active = task;
    this.#originEvent = task.event;
    try {
      const result = failure ? task.generator.throw(value) : task.generator.next(value as CanonicalValue);
      if (this.#failure) throw this.#failure;
      if (result && typeof (result as unknown as Promise<unknown>).then === "function") fail(ErrorCodes.UNCONTROLLED_ASYNC);
      if (result.done) {
        if (task.created) fail(ErrorCodes.UNAWAITED_OPERATION);
        this.#tasks.delete(task.id);
        this.#record(Obs.EventCompleted, task.event, { type: task.event.type, time: task.event.time, sequence: task.event.sequence, taskId: task.id });
        return "COMPLETED";
      }
      const op = task.created && this.#operations.get(task.created);
      if (!op || result.value !== op.handle || op.settled) fail(ErrorCodes.INVALID_OPERATION);
      task.waiting = task.created; task.created = undefined;
      this.#record(Obs.EventSuspended, task.event, { taskId: task.id });
      return "SUSPENDED";
    } catch (error) {
      this.#terminal(error, this.#event);
      throw this.#failure;
    } finally { this.#active = undefined; this.#originEvent = undefined; }
  }
  #terminal(error: unknown, event?: ScheduledEvent, fallback: string = ErrorCodes.HANDLER_FAILED, rejectedObservationType?: string): void {
    if (this.#failure) return;
    let original: SimulationError = isError(error) && error.code.length > 0 ? error : { code: fallback, context: null };
    try { original = { code: original.code, context: canonicalCopy(original.context) }; }
    catch { original = { code: fallback, context: null }; }
    const context = { ...(event ? { eventId: this.#originEvent?.id ?? event.id, dispatchedEventId: this.#event?.id ?? event.id } : {}),
      ...(rejectedObservationType ? { rejectedObservationType } : {}), cause: original.context };
    const failure = Object.assign(new Error(original.code), { code: original.code, context });
    this.#failure = failure; this.#status = "FAILED";
    let historyComplete = rejectedObservationType === undefined;
    if (historyComplete) {
      try { if (event) this.#record(Obs.EventFailed, event, { code: failure.code }); this.#record(Obs.Failed, undefined, { code: failure.code, context }); }
      catch { historyComplete = false; }
    }
    const last = this.#history.all().at(-1);
    this.#history.sealFailure({ time: this.#clock.now(), code: failure.code, context, historyComplete, ...(last ? { lastObservationId: last.id } : {}) });
    try { this.#boundaryHook?.onFailure(failure); } catch { /* original failure wins */ }
  }
  #boundary(): void {
    if (this.#failure) throw this.#failure;
    if (this.#scheduler.size() !== 0) return;
    if (this.#tasks.size) { this.#terminal({ code: ErrorCodes.SIMULATION_DEADLOCK, context: null }); throw this.#failure; }
    try {
      this.#boundaryHook?.onCompletion();
      this.#record(Obs.Completed, undefined, { time: this.time, eventCount: this.#total });
      this.#status = "COMPLETED";
    } catch (error) { this.#terminal(error); throw this.#failure; }
  }
  #dispatch(): SimulationStep | undefined {
    let event: ScheduledEvent | undefined;
    const pending = this.#scheduler.peek();
    try { event = this.#scheduler.takeNext(); }
    catch (error) { this.#terminal(error, pending); throw this.#failure; }
    if (!event) { this.#boundary(); return undefined; }
    this.#event = event; this.#dispatching = true;
    const generation = this.#generation;
    try {
      this.#clock.advanceTo(event.time, event.id);
      this.#record(Obs.EventStarted, event, { type: event.type, time: event.time, sequence: event.sequence });
      const entry = this.#handlers.get(event.type)!;
      const types = new Set([...this.#handlers].filter(([, h]) => h.owner === entry.owner).map(([type]) => type));
      const ownerClock = this.#clock.forOwner(entry.owner, types);
      const clock: typeof ownerClock = Object.freeze({
        now: () => this.#guard(generation, () => { this.#check(generation); return ownerClock.now(); }),
        sleep: (delay: Duration) => this.#guard(generation, () => { this.#check(generation); return ownerClock.sleep(delay); }),
        schedule: <T extends CanonicalValue>(delay: Duration, type: string, payload: T, metadata?: ScheduleMetadata) => this.#guard(generation, () => { this.#check(generation); return this.#boundHandle(ownerClock.schedule(delay, type, payload, metadata), generation); }),
      });
      const scheduler = this.#scheduler.forOwner(entry.owner, types);
      const context: HandlerContext = Object.freeze({ clock, observations: Object.freeze({ record: (input: Parameters<HandlerContext["observations"]["record"]>[0]) => { return this.#guard(generation, () => { this.#check(generation); if (input.source !== entry.owner) fail(ErrorCodes.INVALID_OBSERVATION); return this.#history.record(input); }); } }),
        schedule: (work: { type: string; payload: CanonicalValue }) => { return this.#guard(generation, () => { this.#check(generation); return this.#boundHandle(scheduler.schedule({ ...work, time: clock.now() }), generation); }); } });
      const returned = entry.handler(event, context);
      if (this.#failure) throw this.#failure;
      if (returned && typeof (returned as unknown as Promise<unknown>).then === "function") {
        // Rejection is a host diagnostic, not a modeled continuation or unhandled process error.
        if (returned instanceof Promise) void returned.catch(() => {});
        fail(ErrorCodes.UNCONTROLLED_ASYNC);
      }
      let outcome: "COMPLETED" | "SUSPENDED" = "COMPLETED";
      if (returned && typeof returned === "object" && typeof (returned as ControlledTask).next === "function") {
        const task: Task = { id: this.#taskIds.allocate(), owner: entry.owner, event, generator: returned as ControlledTask, waiting: undefined, created: undefined, processGeneration: this.#processGenerations.get(entry.owner)! };
        this.#tasks.set(task.id, task); outcome = this.#advance(task);
      } else if (returned !== undefined) fail(ErrorCodes.INVALID_OPERATION);
      if (outcome === "COMPLETED" && !returned) this.#record(Obs.EventCompleted, event, { type: event.type, time: event.time, sequence: event.sequence });
      this.#total++;
      this.#boundaryHook?.afterEvent(event);
      this.#boundary();
      return { eventId: event.id, time: event.time, sequence: event.sequence, outcome };
    } catch (error) { this.#terminal(error, event); throw this.#failure; }
    finally { this.#event = undefined; this.#dispatching = false; }
  }
  #lock(): void { if (this.#locked) fail(ErrorCodes.CONTROL_BUSY); if (this.#failure) throw this.#failure; this.#locked = true; }
  async step(): Promise<SimulationStep | undefined> {
    this.#lock();
    try { if (this.#status === "COMPLETED") return undefined;
      this.#status = "PAUSED"; return this.#dispatch();
    } finally { this.#locked = false; this.#history.flushNotifications(); }
  }
  async run(options: RunOptions = {}): Promise<RunResult> {
    if (this.#locked) fail(ErrorCodes.CONTROL_BUSY);
    if (this.#failure) throw this.#failure;
    if (!options || typeof options !== "object" || Array.isArray(options) ||
        Object.keys(options).some(key => key !== "maxEvents" && key !== "maxEventsPerYield") ||
        (Object.hasOwn(options, "maxEvents") && options.maxEvents === null) ||
        (Object.hasOwn(options, "maxEventsPerYield") && options.maxEventsPerYield === null)) fail(ErrorCodes.INVALID_RUN_OPTIONS);
    const max = options.maxEvents ?? Number.MAX_SAFE_INTEGER;
    const yieldEvery = options.maxEventsPerYield ?? 1000;
    if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(yieldEvery) || yieldEvery <= 0) fail(ErrorCodes.INVALID_RUN_OPTIONS);
    this.#lock();
    let processed = 0;
    try {
      if (this.#status === "COMPLETED") return { status: "COMPLETED", reason: "EMPTY", time: this.time, processedEvents: 0, totalEvents: this.#total };
      this.#status = "RUNNING"; this.#pause = false;
      this.#boundary();
      while (this.#status === "RUNNING" && !this.#pause && processed < max) {
        this.#dispatch(); processed++;
        if (processed % yieldEvery === 0 && this.#status === "RUNNING") await yieldToHost();
      }
      if (this.#status === "RUNNING") this.#status = "PAUSED";
      return { status: this.status as "PAUSED" | "COMPLETED", reason: this.status === "COMPLETED" ? "EMPTY" : this.#pause ? "PAUSE_REQUESTED" : "EVENT_LIMIT", time: this.time, processedEvents: processed, totalEvents: this.#total };
    } finally { this.#locked = false; this.#history.flushNotifications(); }
  }
  pause(): void { if (this.#status === "RUNNING") this.#pause = true; }
  async reset(): Promise<void> {
    if (this.#locked) fail(ErrorCodes.CONTROL_BUSY);
    this.#locked = true;
    try { this.#compose(); this.#pause = false; }
    finally { this.#locked = false; this.#history.flushNotifications(); }
  }
}
