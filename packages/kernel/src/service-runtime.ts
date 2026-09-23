import type { BackgroundHandler, BusMessage, ConsumerHandler, Database, Delivery, KeyValueStore, LogLevel, MessageBus, MessageBusController, NetworkController, NetworkReply, NetworkRequest, RuntimeLogger, ServiceContext, ServiceDefinition, ServiceState, VirtualNetwork } from "@distlab/contracts";
import { ServiceObservationTypes, RuntimeObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, ControlledTask, HandlerContext, ScheduledEvent, ScheduledHandle, SimulationSetup, TaskLifecycleController } from "@distlab/contracts/kernel";
import { ErrorCodes, ModeledErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";
import type { NetworkSetup } from "./network.js";

const fail = (code: string): never => throwSimulationError(code);
const allowed: Record<ServiceState, readonly ServiceState[]> = {
  STARTING: ["RUNNING", "CRASHED", "STOPPED"],
  RUNNING: ["PAUSED", "CRASHED", "STOPPED"],
  PAUSED: ["RUNNING", "CRASHED", "STOPPED"],
  CRASHED: ["STARTING", "STOPPED"],
  STOPPED: ["STARTING"],
};
const modeled = new Set<string>(Object.values(ModeledErrorCodes));
const registeredSchemas = new WeakSet<SimulationSetup>();
type WorkKind = "endpoint" | "consumer" | "background";
type Work = { readonly kind: WorkKind; readonly name: string; readonly reference: string; readonly generation: number };

export interface ServiceRuntimeOptions {
  readonly id: ComponentId;
  readonly version: string;
  /** Called for each process generation; it must return fresh handler instances. */
  readonly resolve: (id: ComponentId, version: string) => ServiceDefinition;
  readonly setup: SimulationSetup & NetworkSetup;
  readonly taskLifecycle: () => TaskLifecycleController;
  readonly activeOwner: () => ComponentId | undefined;
  readonly events: MessageBus;
  readonly busController?: MessageBusController;
  readonly db?: Database;
  readonly kv?: KeyValueStore;
  /** Trusted resource cleanup discards this process's uncommitted work. */
  readonly abandonResources?: (processGeneration: number) => void;
}

/** One service in one simulation attempt. Construct it again during reset setup. */
export class DeterministicServiceRuntime {
  readonly #options: ServiceRuntimeOptions;
  readonly #types: { lifecycle: string; endpoint: string; consumer: string; background: string };
  readonly #http: VirtualNetwork;
  readonly #networkController: NetworkController;
  readonly #tasks = new Map<string, Work>();
  readonly #local = new Set<ScheduledHandle>();
  #definition: ServiceDefinition;
  #state: ServiceState = "STARTING";
  #generation = 0;
  #nextWork = 0;

  constructor(options: ServiceRuntimeOptions) {
    this.#options = options;
    this.#definition = this.#resolve();
    if (Object.keys(this.#definition.consumers).length && !options.busController) fail(ErrorCodes.INVALID_REGISTRATION);
    this.#http = options.setup.networkFor(options.id);
    this.#networkController = options.setup.networkController();
    this.#types = { lifecycle: `service.${options.id}.lifecycle`, endpoint: `service.${options.id}.endpoint`,
      consumer: `service.${options.id}.consumer`, background: `service.${options.id}.background` };
    if (!registeredSchemas.has(options.setup)) {
      for (const type of [...Object.values(ServiceObservationTypes), RuntimeObservationTypes.Log])
        options.setup.registerObservationSchema(type, data => !!data && typeof data === "object" && !Array.isArray(data));
      registeredSchemas.add(options.setup);
    }
    options.setup.registerHandler(this.#types.lifecycle, options.id, (event, context) => {
      const payload = event.payload as { next: ServiceState; reason?: string };
      this.#transition(payload.next, context, event, payload.reason ?? "scenario");
    });
    options.setup.registerHandler(this.#types.endpoint, options.id, (event, context) => this.#endpoint(event, context));
    options.setup.registerHandler(this.#types.consumer, options.id, (event, context) => this.#consumer(event, context));
    options.setup.registerHandler(this.#types.background, options.id, (event, context) => this.#background(event, context));
    this.#networkController.register(options.id, {
      admit: (request: NetworkRequest) => this.#state !== "RUNNING" ? ErrorCodes.TARGET_UNAVAILABLE :
        !Object.hasOwn(this.#definition.endpoints, request.endpoint) ? ErrorCodes.ENDPOINT_NOT_FOUND : undefined,
      accept: (requestId, request) => { options.setup.enqueueNetworkWork(options.id, this.#types.endpoint,
        { requestId, endpoint: request.endpoint, body: request.body, generation: this.#generation }); },
    } as Parameters<NetworkController["register"]>[1]);
    for (const destination of Object.keys(this.#definition.consumers)) options.busController?.subscribe(destination, options.id, {
      ready: () => this.#state === "RUNNING",
      accept: delivery => { options.setup.enqueueNetworkWork(options.id, this.#types.consumer,
        { delivery: canonicalCopy(delivery) as CanonicalValue, generation: this.#generation }); },
    });
  }

  get state(): ServiceState { return this.#state; }
  get processGeneration(): number { return this.#generation; }
  get lifecycleEventType(): string { return this.#types.lifecycle; }
  get backgroundEventType(): string { return this.#types.background; }
  inspect(): Readonly<{ state: ServiceState; processGeneration: number; tasks: readonly Readonly<Work>[] }> {
    return Object.freeze({ state: this.#state, processGeneration: this.#generation,
      tasks: Object.freeze([...this.#tasks.values()].map(task => Object.freeze({ ...task }))) });
  }
  #resolve(): ServiceDefinition {
    const definition = this.#options.resolve(this.#options.id, this.#options.version);
    if (!definition || definition.id !== this.#options.id || definition.version !== this.#options.version ||
        !definition.endpoints || !definition.consumers || !definition.background ||
        !this.#options.version.trim() ||
        [...Object.keys(definition.endpoints), ...Object.keys(definition.consumers), ...Object.keys(definition.background)].some(name => !name.trim()) ||
        [...Object.values(definition.endpoints), ...Object.values(definition.consumers), ...Object.values(definition.background)].some(handler => typeof handler !== "function"))
      fail(ErrorCodes.INVALID_REGISTRATION);
    return definition;
  }
  #observe(context: HandlerContext, event: ScheduledEvent, type: string, data: CanonicalValue): void {
    context.observations.record({ type, source: this.#options.id, eventId: event.id,
      ...(event.traceId ? { traceId: event.traceId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}), data });
  }
  #transition(next: ServiceState, context: HandlerContext, event: ScheduledEvent, reason: string): void {
    if (typeof reason !== "string" || !reason.trim()) fail(ErrorCodes.INVALID_EVENT_PAYLOAD);
    if (next === this.#state) return;
    if (!allowed[this.#state].includes(next)) fail(ErrorCodes.INVALID_SERVICE_TRANSITION);
    const previous = this.#state;
    if ((next === "CRASHED" || next === "STOPPED") && previous !== "CRASHED") {
      for (const work of this.#tasks.values()) this.#observe(context, event, ServiceObservationTypes.HandlerAbandoned,
        { kind: work.kind, name: work.name, reference: work.reference, reason });
      this.#tasks.clear();
      for (const handle of this.#local) handle.cancel();
      this.#local.clear();
      this.#options.abandonResources?.(this.#generation);
      this.#options.taskLifecycle().abandon(this.#options.id, this.#generation);
      this.#generation++;
    } else if (next === "STARTING") this.#definition = this.#resolve();
    this.#state = next;
    this.#options.busController?.consumerChanged(this.#options.id);
    this.#observe(context, event, ServiceObservationTypes.LifecycleChanged,
      { before: previous, after: next, processGeneration: this.#generation, reason });
  }
  #capability(generation: number): void {
    this.#options.setup.networkInFlight(); // Also revokes capabilities from a prior reset attempt.
    if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
    if (this.#options.activeOwner() !== this.#options.id) fail(ErrorCodes.INVALID_OPERATION);
  }
  #context(context: HandlerContext, event: ScheduledEvent, generation: number): ServiceContext {
    const check = () => this.#capability(generation);
    const http = this.#http;
    const clock = context.clock;
    const log: RuntimeLogger = Object.freeze({ write: (level: LogLevel, message: string, data?: CanonicalValue) => {
      check();
      if (!["debug", "info", "warn", "error"].includes(level) || typeof message !== "string") fail(ErrorCodes.INVALID_OBSERVATION);
      this.#observe(context, event, RuntimeObservationTypes.Log,
        { level, message, ...(data === undefined ? {} : { data: canonicalCopy(data) }) });
    } });
    const scopedHttp: VirtualNetwork = Object.freeze({ request: (request: NetworkRequest) => { check(); return http.request(request); } });
    const scopedEvents: MessageBus = Object.freeze({ publish: (destination: string, message: BusMessage) => { check(); return this.#options.events.publish(destination, message); } });
    const scopedClock = Object.freeze({ now: () => { check(); return clock.now(); }, sleep: (delay: Parameters<typeof clock.sleep>[0]) => { check(); return clock.sleep(delay); },
      schedule: <T extends CanonicalValue>(delay: Parameters<typeof clock.schedule>[0], type: string, payload: T) => { check();
        if (type !== this.#types.background) fail(ErrorCodes.INVALID_EVENT_TYPE);
        const handle = clock.schedule(delay, type, payload); this.#local.add(handle); return handle; } });
    const db = this.#options.db && Object.freeze({ begin: () => { check(); const transaction = this.#options.db!.begin();
      return new Proxy(transaction, { get(target, property) { const value = Reflect.get(target, property);
        return typeof value === "function" ? (...args: unknown[]) => { check(); return Reflect.apply(value, target, args); } : value; } }); } });
    const kv = this.#options.kv && new Proxy(this.#options.kv, { get(target, property) { const value = Reflect.get(target, property);
      return typeof value === "function" ? (...args: unknown[]) => { check(); return Reflect.apply(value, target, args); } : value; } });
    return Object.freeze({ ...(db ? { db } : {}), ...(kv ? { kv } : {}), events: scopedEvents, http: scopedHttp, clock: scopedClock, log });
  }
  #start(kind: WorkKind, name: string, reference: string, context: HandlerContext, event: ScheduledEvent): Work {
    const work = { kind, name, reference, generation: this.#generation };
    this.#tasks.set(reference, work);
    this.#observe(context, event, ServiceObservationTypes.HandlerStarted, { kind, name, reference });
    return work;
  }
  #finish(work: Work, context: HandlerContext, event: ScheduledEvent, outcome: "completed" | "failed", code?: string): void {
    this.#tasks.delete(work.reference);
    this.#observe(context, event, outcome === "completed" ? ServiceObservationTypes.HandlerCompleted : ServiceObservationTypes.HandlerFailed,
      { kind: work.kind, name: work.name, reference: work.reference, outcome, ...(code ? { code } : {}) });
  }
  #run<R>(work: Work, invoke: () => R | Generator<ControlledOperation, R, CanonicalValue>, context: HandlerContext,
    event: ScheduledEvent, complete: (value: R) => void, failed: (code: string) => void): void | ControlledTask {
    let result: R | Generator<ControlledOperation, R, CanonicalValue>;
    try { result = invoke(); }
    catch (error) {
      const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
      if (!code || !modeled.has(code)) throw error;
      failed(code); this.#finish(work, context, event, "failed", code); return;
    }
    if (result && typeof (result as unknown as Promise<unknown>).then === "function") fail(ErrorCodes.UNCONTROLLED_ASYNC);
    if (result && typeof (result as Generator).next === "function") {
      const generator = result as Generator<ControlledOperation, R, CanonicalValue>;
      return (function* (runtime: DeterministicServiceRuntime): ControlledTask {
        try {
          const value = yield* generator;
          complete(value); runtime.#finish(work, context, event, "completed");
        } catch (error) {
          const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
          if (!code || !modeled.has(code)) throw error;
          failed(code); runtime.#finish(work, context, event, "failed", code);
        }
      })(this);
    }
    if (work.kind !== "endpoint" && result !== undefined) fail(ErrorCodes.INVALID_OPERATION);
    complete(result as R); this.#finish(work, context, event, "completed");
  }
  #endpoint(event: ScheduledEvent, context: HandlerContext): void | ControlledTask {
    const { requestId, endpoint, body, generation } = event.payload as { requestId: string; endpoint: string; body: CanonicalValue; generation: number };
    if (generation !== this.#generation) return;
    const handler = this.#definition.endpoints[endpoint] ?? fail(ErrorCodes.INVALID_REGISTRATION);
    const work = this.#start("endpoint", endpoint, requestId, context, event);
    const serviceContext = this.#context(context, event, work.generation);
    const complete = (reply: NetworkReply) => this.#networkController.reply(requestId, reply);
    return this.#run(work, () => handler(body, serviceContext), context, event, complete,
      code => complete({ status: "error", body: { code } }));
  }
  #consumer(event: ScheduledEvent, context: HandlerContext): void | ControlledTask {
    const { delivery, generation } = event.payload as unknown as { delivery: Delivery; generation: number };
    if (generation !== this.#generation) return;
    const handler: ConsumerHandler = this.#definition.consumers[delivery.destination] ?? fail(ErrorCodes.INVALID_REGISTRATION);
    const work = this.#start("consumer", delivery.destination, delivery.deliveryId, context, event);
    return this.#run(work, () => handler(delivery, this.#context(context, event, work.generation)), context, event,
      () => this.#options.busController?.acknowledge(delivery.deliveryId, "ack"), () => this.#options.busController?.acknowledge(delivery.deliveryId, "nack"));
  }
  #background(event: ScheduledEvent, context: HandlerContext): void | ControlledTask {
    for (const handle of this.#local) if (handle.eventId === event.id) this.#local.delete(handle);
    const { name, data } = event.payload as { name: string; data: CanonicalValue };
    if (this.#state !== "RUNNING") { this.#observe(context, event, ServiceObservationTypes.WorkSkipped, { name, lifecycle: this.#state }); return; }
    const handler: BackgroundHandler = this.#definition.background[name] ?? fail(ErrorCodes.INVALID_REGISTRATION);
    const work = this.#start("background", name, `${event.id}:${this.#nextWork++}`, context, event);
    return this.#run(work, () => handler(data, this.#context(context, event, work.generation)), context, event, () => {}, () => {});
  }
}
