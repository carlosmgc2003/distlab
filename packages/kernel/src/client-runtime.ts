import type { ClientContext, ClientController, ClientDefinition, ClientState, LogLevel, NetworkController, NetworkReply, NetworkRequest, RuntimeLogger, VirtualNetwork } from "@distlab/contracts";
import { ClientObservationTypes, RuntimeObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, ControlledTask, HandlerContext, ScheduledEvent } from "@distlab/contracts/kernel";
import { ErrorCodes, ModeledErrorCodes, duration, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";
import { registerRuntimeLogSchema } from "./runtime-log.js";
import type { RuntimeSetup } from "./simulation.js";

const fail = (code: string): never => throwSimulationError(code);
const modeled = new Set<string>(Object.values(ModeledErrorCodes));
const levels = new Set<string>(["debug", "info", "warn", "error"]);
const codeOf = (error: unknown): string | undefined => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const reply = (value: unknown): value is NetworkReply => object(value) &&
  Object.keys(value).length === 2 && (value.status === "ok" || value.status === "error") && Object.hasOwn(value, "body");
const tagged = (value: CanonicalValue | undefined): CanonicalValue => value === undefined ? { present: false } : { present: true, value };

export interface ClientRuntimeOptions {
  readonly id: ComponentId;
  readonly version: string;
  readonly resolve: (id: ComponentId, version: string) => ClientDefinition;
  readonly setup: RuntimeSetup;
  readonly activeOwner: () => ComponentId | undefined;
  /** The scenario adapter owns this registered handler type. */
  readonly scenarioEventType: string;
}

export interface ClientActionView {
  readonly actionId: string;
  readonly name: string;
  readonly status: "RUNNING" | "COMPLETED" | "FAILED";
  readonly result?: CanonicalValue;
  readonly code?: string;
}

/** One client in one simulation attempt. Reset constructs another instance. */
export class DeterministicClientRuntime {
  readonly #options: ClientRuntimeOptions;
  readonly #definition: ClientDefinition;
  readonly #http: VirtualNetwork;
  readonly #networkController: NetworkController;
  readonly #actions = new Map<string, ClientActionView>();
  readonly #callbacks = new Set<string>();
  readonly #state = new Map<string, CanonicalValue>();
  readonly #actionType: string;
  readonly #callbackType: string;
  #nextTrace = 0;
  #violated = false;
  #dispatching = false;

  constructor(options: ClientRuntimeOptions) {
    this.#options = options;
    this.#definition = options.resolve(options.id, options.version);
    const definition = this.#definition;
    if (!options.id?.trim() || !options.version?.trim() || !options.scenarioEventType?.trim() ||
        !definition || definition.id !== options.id || definition.version !== options.version ||
        !object(definition.actions) || !object(definition.callbacks) || !object(definition.initialState) ||
        [...Object.entries(definition.actions), ...Object.entries(definition.callbacks)].some(([name, handler]) => !name.trim() || typeof handler !== "function") ||
        Object.keys(definition.actions).some(name => Object.hasOwn(definition.callbacks, name)))
      fail(ErrorCodes.INVALID_REGISTRATION);
    try {
      for (const [key, value] of Object.entries(definition.initialState)) {
        if (!key.trim()) fail(ErrorCodes.INVALID_CLIENT_STATE);
        this.#state.set(key, canonicalCopy(value));
      }
    } catch { fail(ErrorCodes.INVALID_CLIENT_STATE); }
    this.#http = options.setup.networkFor(options.id);
    this.#networkController = options.setup.networkController();
    this.#actionType = `client.${options.id}.action`;
    this.#callbackType = `client.${options.id}.callback`;
    const schemas: Record<string, (data: CanonicalValue | undefined) => boolean> = {
      [ClientObservationTypes.ActionStarted]: data => object(data) && typeof data.actionId === "string" && typeof data.name === "string" && Object.hasOwn(data, "input"),
      [ClientObservationTypes.ActionCompleted]: data => object(data) && typeof data.actionId === "string" && Object.hasOwn(data, "result"),
      [ClientObservationTypes.ActionFailed]: data => object(data) && typeof data.actionId === "string" && typeof data.code === "string",
      [ClientObservationTypes.StateChanged]: data => object(data) && typeof data.key === "string" && object(data.before) && object(data.after),
      [ClientObservationTypes.CallbackStarted]: data => object(data) && typeof data.requestId === "string" && typeof data.endpoint === "string",
      [ClientObservationTypes.CallbackCompleted]: data => object(data) && typeof data.requestId === "string" && (data.outcome === "completed" || data.outcome === "failed"),
    };
    for (const [type, validate] of Object.entries(schemas)) options.setup.registerObservationSchema(type, validate);
    registerRuntimeLogSchema(options.setup);
    options.setup.registerHandler(this.#actionType, options.id, (event, context) => this.#action(event, context));
    options.setup.registerHandler(this.#callbackType, options.id, (event, context) => this.#callback(event, context));
    this.#networkController.register(options.id, {
      accept: (requestId, request) => options.setup.enqueueNetworkWork(options.id, this.#callbackType,
        { requestId, endpoint: request.endpoint, body: request.body }),
      admit: (request: NetworkRequest) => Object.hasOwn(this.#definition.callbacks, request.endpoint) ? undefined : ErrorCodes.ENDPOINT_NOT_FOUND,
    } as Parameters<ReturnType<RuntimeSetup["networkController"]>["register"]>[1]);
  }

  get actionEventType(): string { return this.#actionType; }
  inspect(): Readonly<{ state: Readonly<Record<string, CanonicalValue>>; actions: readonly ClientActionView[]; callbacks: readonly string[] }> {
    return Object.freeze({ state: canonicalCopy(Object.fromEntries(this.#state)) as Readonly<Record<string, CanonicalValue>>,
      actions: Object.freeze([...this.#actions.values()].map(action => Object.freeze({ ...action }))),
      callbacks: Object.freeze([...this.#callbacks]) });
  }

  /** Give the scenario adapter its controller only for this dispatch's synchronous body. */
  dispatch(event: ScheduledEvent, context: HandlerContext, invoke: (controller: ClientController) => void): void {
    if (this.#dispatching || this.#options.activeOwner() !== this.#options.id ||
        event.type !== this.#options.scenarioEventType || typeof invoke !== "function")
      this.#violation(ErrorCodes.INVALID_CLIENT_ACTION);
    this.#dispatching = true;
    try { invoke(this.#controller(event, context)); }
    finally { this.#dispatching = false; }
  }

  #controller(event: ScheduledEvent, context: HandlerContext): ClientController {
    return Object.freeze({ start: (actionId: string, action: string, data: CanonicalValue) => {
      if (!this.#dispatching || this.#options.activeOwner() !== this.#options.id || event.type !== this.#options.scenarioEventType ||
          typeof actionId !== "string" || !actionId.trim() || typeof action !== "string" || !Object.hasOwn(this.#definition.actions, action) ||
          this.#actions.has(actionId)) this.#violation(ErrorCodes.INVALID_CLIENT_ACTION);
      let input: CanonicalValue;
      try { input = canonicalCopy(data); } catch { this.#violation(ErrorCodes.INVALID_CLIENT_ACTION); }
      const sequence = this.#nextTrace++;
      const traceId = `client:${this.#options.id}:trace:${sequence}`;
      const spanId = `client:${this.#options.id}:span:${sequence}`;
      // Scheduling through the bound handler clock enforces owner and active-run gates.
      this.#invoke(() => context.clock.schedule(duration(0), this.#actionType,
        { actionId, name: action, input }, { traceId, spanId, ...(event.causationId ? { causationId: event.causationId } : {}) }));
      this.#actions.set(actionId, { actionId, name: action, status: "RUNNING" });
    } });
  }

  #violation(code: string): never { this.#violated = true; this.#options.setup.failTask(code); }
  #invoke<T>(work: () => T): T {
    try { return work(); } catch (error) {
      const code = codeOf(error);
      if (code && modeled.has(code)) throw error;
      this.#violation(code || ErrorCodes.HANDLER_FAILED);
    }
  }
  #capability(): void {
    if (this.#violated || this.#options.activeOwner() !== this.#options.id) this.#violation(ErrorCodes.INVALID_OPERATION);
    try { this.#options.setup.networkInFlight(); } catch (error) { this.#violation(codeOf(error) || ErrorCodes.STALE_CAPABILITY); }
  }
  #observe(context: HandlerContext, event: ScheduledEvent, type: string, data: CanonicalValue): void {
    this.#invoke(() => context.observations.record({ type, source: this.#options.id, eventId: event.id,
      entityRefs: [{ kind: "client", id: this.#options.id }],
      ...(event.traceId ? { traceId: event.traceId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}),
      ...(event.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
      ...(event.causationId ? { causationId: event.causationId } : {}), data }));
  }
  #context(context: HandlerContext, event: ScheduledEvent): ClientContext {
    const state: ClientState = Object.freeze({
      get: (key: string) => { this.#capability(); if (typeof key !== "string" || !key.trim()) this.#violation(ErrorCodes.INVALID_CLIENT_STATE);
        const value = this.#state.get(key); return value === undefined ? undefined : canonicalCopy(value); },
      set: (key: string, value: CanonicalValue) => { this.#capability(); if (typeof key !== "string" || !key.trim()) this.#violation(ErrorCodes.INVALID_CLIENT_STATE);
        let next: CanonicalValue; try { next = canonicalCopy(value); } catch { this.#violation(ErrorCodes.INVALID_CLIENT_STATE); }
        const before = this.#state.get(key); this.#state.set(key, next);
        this.#observe(context, event, ClientObservationTypes.StateChanged, { key, before: tagged(before), after: tagged(next) }); },
    });
    const log: RuntimeLogger = Object.freeze({ write: (level: LogLevel, message: string, data?: CanonicalValue) => {
      this.#capability(); if (!levels.has(level) || typeof message !== "string") this.#violation(ErrorCodes.INVALID_OBSERVATION);
      let copied: CanonicalValue | undefined;
      if (data !== undefined) { try { copied = canonicalCopy(data); } catch { this.#violation(ErrorCodes.INVALID_OBSERVATION); } }
      this.#observe(context, event, RuntimeObservationTypes.Log, { level, message, ...(copied === undefined ? {} : { data: copied }) });
    } });
    const http: VirtualNetwork = Object.freeze({ request: (request: NetworkRequest) => {
      this.#capability(); return this.#invoke(() => this.#http.request(request)); } });
    const clock = Object.freeze({ now: () => { this.#capability(); return context.clock.now(); },
      sleep: (delay: Parameters<ClientContext["clock"]["sleep"]>[0]) => { this.#capability(); return this.#invoke(() => context.clock.sleep(delay)); },
      schedule: () => this.#violation(ErrorCodes.INVALID_EVENT_TYPE) });
    return Object.freeze({ state, log, http, clock });
  }
  #run<R>(invoke: () => R | Generator<ControlledOperation, R, CanonicalValue>, valid: (value: unknown) => boolean,
    complete: (value: R) => void, failed: (code: string) => void): void | ControlledTask {
    const finish = (value: unknown) => { if (this.#violated || !valid(value)) this.#violation(ErrorCodes.INVALID_OPERATION); complete(value as R); };
    try {
      const result = invoke();
      if (result && typeof (result as unknown as Promise<unknown>).then === "function") this.#violation(ErrorCodes.UNCONTROLLED_ASYNC);
      if (result && typeof result === "object" && Symbol.asyncIterator in result) this.#violation(ErrorCodes.UNCONTROLLED_ASYNC);
      if (result && typeof (result as Generator).next === "function") {
        const generator = result as Generator<ControlledOperation, R, CanonicalValue>;
        const drive = function* (runtime: DeterministicClientRuntime): ControlledTask {
          try { finish(yield* generator); }
          catch (error) { const code = codeOf(error); if (runtime.#violated || !code || !modeled.has(code)) throw error; failed(code); }
        };
        return drive(this);
      }
      finish(result);
    } catch (error) {
      const code = codeOf(error);
      if (this.#violated || !code || !modeled.has(code)) throw error;
      failed(code);
    }
  }
  #action(event: ScheduledEvent, context: HandlerContext): void | ControlledTask {
    const { actionId, name, input } = event.payload as { actionId: string; name: string; input: CanonicalValue };
    const handler = this.#definition.actions[name] ?? fail(ErrorCodes.INVALID_CLIENT_ACTION);
    this.#observe(context, event, ClientObservationTypes.ActionStarted, { actionId, name, input });
    return this.#run(() => handler(input, this.#context(context, event)), value => { try { canonicalCopy(value); return true; } catch { return false; } },
      value => { const result = canonicalCopy(value); this.#actions.set(actionId, { actionId, name, status: "COMPLETED", result });
        this.#observe(context, event, ClientObservationTypes.ActionCompleted, { actionId, result }); },
      code => { this.#actions.set(actionId, { actionId, name, status: "FAILED", code });
        this.#observe(context, event, ClientObservationTypes.ActionFailed, { actionId, code }); });
  }
  #callback(event: ScheduledEvent, context: HandlerContext): void | ControlledTask {
    const { requestId, endpoint, body } = event.payload as { requestId: string; endpoint: string; body: CanonicalValue };
    const handler = this.#definition.callbacks[endpoint] ?? fail(ErrorCodes.INVALID_REGISTRATION);
    this.#callbacks.add(requestId);
    this.#observe(context, event, ClientObservationTypes.CallbackStarted, { requestId, endpoint });
    const complete = (result: NetworkReply, outcome: "completed" | "failed") => {
      this.#invoke(() => this.#networkController.reply(requestId, result));
      this.#callbacks.delete(requestId);
      this.#observe(context, event, ClientObservationTypes.CallbackCompleted,
        { requestId, endpoint, outcome, ...(outcome === "completed" ? { reply: result as unknown as CanonicalValue } : { code: (result.body as { code: string }).code }) });
    };
    return this.#run(() => handler(body, this.#context(context, event)), value => {
      if (!reply(value)) return false; try { canonicalCopy(value); return true; } catch { return false; }
    }, value => complete(value, "completed"), code => complete({ status: "error", body: { code } }, "failed"));
  }
}
