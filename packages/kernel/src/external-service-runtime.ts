import type { ExternalAvailability, ExternalBehavior, ExternalController, ExternalDefinition, ExternalOperation, ExternalRuntime, NetworkController, NetworkReply, NetworkRequest, VirtualNetwork } from "@distlab/contracts";
import { ExternalObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, ControlledTask, Duration, HandlerContext, ScheduleMetadata, ScheduledEvent, ScheduledHandle, SimulationSetup, SimulationTime } from "@distlab/contracts/kernel";
import { ErrorCodes, duration, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "./canonical.js";
import { addDuration } from "./clock.js";
import { isIdentifier } from "./identity.js";
import type { RuntimeSetup } from "./simulation.js";

const availabilityStates = ["AVAILABLE", "DEGRADED", "UNAVAILABLE", "RATE_LIMITED"] as const;
const registeredSchemas = new WeakSet<SimulationSetup>();

function fail(code: string): never {
  return throwSimulationError(code);
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exact(data: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = new Set(required);
  return Object.keys(data).every(key => keys.has(key)) && required.every(key => Object.hasOwn(data, key));
}

function isAvailability(value: unknown): value is ExternalAvailability {
  return typeof value === "string" && (availabilityStates as readonly string[]).includes(value);
}

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function codeOf(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function published(behavior: ExternalBehavior): CanonicalValue {
  return {
    latency: behavior.latency,
    degradedExtraLatency: behavior.degradedExtraLatency,
    dropResponse: behavior.dropResponse,
    parameters: behavior.parameters,
  };
}

function sameBehavior(left: ExternalBehavior, right: ExternalBehavior): boolean {
  return left.latency === right.latency
    && left.degradedExtraLatency === right.degradedExtraLatency
    && left.dropResponse === right.dropResponse
    && canonicalEncode(left.parameters) === canonicalEncode(right.parameters);
}

function freezeBehavior(behavior: ExternalBehavior): ExternalBehavior {
  return Object.freeze({
    latency: behavior.latency,
    degradedExtraLatency: behavior.degradedExtraLatency,
    dropResponse: behavior.dropResponse,
    parameters: behavior.parameters,
  });
}

const schemas: Readonly<Record<string, (data: CanonicalValue | undefined) => boolean>> = {
  [ExternalObservationTypes.AvailabilityChanged]: data => plain(data) && exact(data, ["before", "after"])
    && isAvailability(data.before) && isAvailability(data.after),
  [ExternalObservationTypes.BehaviorChanged]: data => plain(data) && exact(data, ["operation", "before", "after"])
    && typeof data.operation === "string" && data.operation.trim().length > 0 && behaviorData(data.before) && behaviorData(data.after),
  [ExternalObservationTypes.OperationAdmitted]: data => plain(data) && exact(data, ["requestId", "operation", "completionTime"])
    && text(data.requestId) && text(data.operation) && isDuration(data.completionTime),
  [ExternalObservationTypes.OperationRejected]: data => plain(data) && exact(data, ["requestId", "operation", "code"])
    && text(data.requestId) && text(data.operation) && text(data.code),
  [ExternalObservationTypes.EffectCommitted]: data => plain(data) && exact(data, ["requestId", "operation", "visibleChanges"])
    && text(data.requestId) && text(data.operation) && Object.hasOwn(data, "visibleChanges"),
  [ExternalObservationTypes.ResponseSuppressed]: data => plain(data) && exact(data, ["requestId", "reason"])
    && text(data.requestId) && text(data.reason),
  [ExternalObservationTypes.CallbackScheduled]: data => plain(data) && exact(data, ["originRequestId", "ordinal", "dueTime", "target"])
    && text(data.originRequestId) && isDuration(data.ordinal) && isDuration(data.dueTime) && text(data.target),
  [ExternalObservationTypes.CallbackCompleted]: data => plain(data) && exact(data, ["originRequestId", "ordinal", "outcome"])
    && text(data.originRequestId) && isDuration(data.ordinal) && (data.outcome === "reply" || data.outcome === "timeout"),
};

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function behaviorData(value: unknown): boolean {
  return plain(value) && exact(value, ["latency", "degradedExtraLatency", "dropResponse", "parameters"])
    && isDuration(value.latency) && isDuration(value.degradedExtraLatency) && typeof value.dropResponse === "boolean"
    && Object.hasOwn(value, "parameters");
}

function validateDefinition(definition: ExternalDefinition): void {
  if (!definition || typeof definition !== "object" || !isIdentifier(definition.id)
    || typeof definition.version !== "string" || !definition.version.trim() || !plain(definition.operations)) {
    fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  }
  const names = Object.keys(definition.operations);
  if (names.some(name => !name.trim())) fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  for (const name of names) {
    const operation: ExternalOperation | undefined = definition.operations[name];
    if (!operation || typeof operation.apply !== "function") fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  }
  try { canonicalCopy(definition.initialState); }
  catch { fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION); }
}

interface Admission {
  readonly requestId: string;
  readonly operation: string;
  readonly body: CanonicalValue;
  readonly behavior: ExternalBehavior;
  readonly availability: ExternalAvailability;
}

interface ParsedCallback {
  readonly after: Duration;
  readonly due: SimulationTime;
  readonly request: NetworkRequest;
}

interface ParsedDecision {
  readonly nextState: CanonicalValue;
  readonly reply: NetworkReply;
  readonly visibleChanges: CanonicalValue;
  readonly callbacks: readonly ParsedCallback[];
}

export interface ExternalServiceRuntimeOptions {
  readonly definition: ExternalDefinition;
  readonly setup: RuntimeSetup;
  readonly activeOwner: () => ComponentId | undefined;
  readonly activeEvent: () => ScheduledEvent | undefined;
  /** Scenario adapter event whose handler may call `dispatch`. */
  readonly scenarioEventType: string;
  readonly initialAvailability?: ExternalAvailability;
  /** Invoked synchronously during initialization with the only controller. */
  readonly configure?: (controller: ExternalController) => void;
}

/** Student-facing boundary. Private provider state and in-flight handles are absent. */
export interface ExternalInspection {
  readonly availability: ExternalAvailability;
  readonly visible: CanonicalValue;
}

/** Trusted assessment projection. Not a snapshot of private state or tasks. */
export interface ExternalBoundary extends ExternalInspection {
  readonly effectCount: number;
  readonly admittedCount: number;
  readonly rejectedCount: number;
  readonly suppressedCount: number;
  readonly scheduledCallbackCount: number;
  readonly callbackTimeoutCount: number;
}

/**
 * Scenario-controlled provider. Service code reaches it only through VirtualNetwork.
 * One instance belongs to one simulation attempt; reset constructs another.
 */
export class DeterministicExternalServiceRuntime implements ExternalRuntime {
  readonly #options: ExternalServiceRuntimeOptions;
  readonly #definition: ExternalDefinition;
  readonly #types: { readonly arrival: string; readonly complete: string; readonly callback: string };
  readonly #http: VirtualNetwork;
  readonly #networkController: NetworkController;
  readonly #controller: ExternalController;
  readonly #behaviors = new Map<string, ExternalBehavior>();
  readonly #admissions = new Map<string, Admission>();
  readonly #handles = new Set<ScheduledHandle>();
  #availability: ExternalAvailability = "AVAILABLE";
  #state: CanonicalValue;
  #visible: CanonicalValue = null;
  #effectCount = 0;
  #admittedCount = 0;
  #rejectedCount = 0;
  #suppressedCount = 0;
  #scheduledCallbackCount = 0;
  #callbackTimeoutCount = 0;
  #controlDepth = 0;
  #initializing = true;
  #violated = false;

  constructor(options: ExternalServiceRuntimeOptions) {
    validateDefinition(options.definition);
    if (!isIdentifier(options.scenarioEventType) || !options.scenarioEventType.trim()) fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    if (options.initialAvailability !== undefined && !isAvailability(options.initialAvailability)) fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    if (options.configure !== undefined && typeof options.configure !== "function") fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    const types = {
      arrival: `external.${options.definition.id}.arrival`,
      complete: `external.${options.definition.id}.complete`,
      callback: `external.${options.definition.id}.callback`,
    };
    if (options.scenarioEventType === types.arrival || options.scenarioEventType === types.complete || options.scenarioEventType === types.callback) {
      fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    this.#options = options;
    this.#definition = options.definition;
    this.#types = types;
    this.#state = canonicalCopy(options.definition.initialState);
    for (const name of Object.keys(options.definition.operations)) this.#behaviors.set(name, freezeBehavior({
      latency: duration(0), degradedExtraLatency: duration(0), dropResponse: false, parameters: null,
    }));
    if (!registeredSchemas.has(options.setup)) {
      for (const [type, validate] of Object.entries(schemas)) options.setup.registerObservationSchema(type, validate);
      registeredSchemas.add(options.setup);
    }
    options.setup.registerHandler(types.arrival, options.definition.id, (event, context) => this.#arrival(event, context));
    options.setup.registerHandler(types.complete, options.definition.id, (event, context) => this.#complete(event, context));
    options.setup.registerHandler(types.callback, options.definition.id, (event, context) => this.#callback(event, context));
    this.#http = options.setup.networkFor(options.definition.id);
    this.#networkController = options.setup.networkController();
    this.#networkController.register(options.definition.id, {
      accept: (requestId, request) => this.#accept(requestId, request),
    });
    this.#controller = Object.freeze({
      configure: (operation: string, behavior: ExternalBehavior) => this.#configure(operation, behavior),
      setAvailability: (state: ExternalAvailability) => this.#setAvailability(state),
    });
    this.#controlDepth = 1;
    try {
      if (options.initialAvailability !== undefined) this.#controller.setAvailability(options.initialAvailability);
      options.configure?.(this.#controller);
    } finally {
      this.#controlDepth = 0;
      this.#initializing = false;
    }
  }

  get availability(): ExternalAvailability { return this.#availability; }
  get scenarioEventType(): string { return this.#options.scenarioEventType; }

  /** Scenario/fault adapter entry. Legal only while this scenario event is on the stack. */
  dispatch(event: ScheduledEvent, invoke: (controller: ExternalController) => void): void {
    this.#live();
    if (this.#initializing || this.#controlDepth !== 0 || typeof invoke !== "function" || !this.#scenario(event)) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    this.#controlDepth += 1;
    try { invoke(this.#controller); }
    finally { this.#controlDepth -= 1; }
  }

  inspect(): ExternalInspection {
    return Object.freeze({ availability: this.#availability, visible: canonicalCopy(this.#visible) });
  }

  boundary(): ExternalBoundary {
    return Object.freeze({
      availability: this.#availability,
      visible: canonicalCopy(this.#visible),
      effectCount: this.#effectCount,
      admittedCount: this.#admittedCount,
      rejectedCount: this.#rejectedCount,
      suppressedCount: this.#suppressedCount,
      scheduledCallbackCount: this.#scheduledCallbackCount,
      callbackTimeoutCount: this.#callbackTimeoutCount,
    });
  }

  #scenario(event: ScheduledEvent): boolean {
    return this.#options.activeEvent() === event
      && this.#options.activeOwner() === this.#definition.id
      && event.type === this.#options.scenarioEventType;
  }

  #fail(code: string): never {
    this.#violated = true;
    this.#options.setup.failTask(code);
  }

  #live(): void {
    try { this.#options.setup.networkInFlight(); }
    catch (error) {
      const code = codeOf(error);
      if (code === ErrorCodes.STALE_CAPABILITY) throw error;
      this.#fail(code ?? ErrorCodes.STALE_CAPABILITY);
    }
    if (this.#violated) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  }

  #control(): void {
    this.#live();
    if (this.#controlDepth === 0) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    if (this.#initializing) return;
    if (this.#options.activeOwner() !== this.#definition.id || this.#options.activeEvent()?.type !== this.#options.scenarioEventType) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
  }

  #duration(value: unknown): Duration {
    if (typeof value !== "number") this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    try { return duration(value); }
    catch { this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION); }
  }

  #behavior(input: ExternalBehavior): ExternalBehavior {
    if (!plain(input) || !exact(input, ["latency", "degradedExtraLatency", "dropResponse", "parameters"])) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    if (typeof input.dropResponse !== "boolean") this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    let parameters: CanonicalValue;
    try { parameters = canonicalCopy(input.parameters); }
    catch { this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION); }
    return freezeBehavior({
      latency: this.#duration(input.latency),
      degradedExtraLatency: this.#duration(input.degradedExtraLatency),
      dropResponse: input.dropResponse,
      parameters,
    });
  }

  #configure(operation: string, behavior: ExternalBehavior): void {
    this.#control();
    if (typeof operation !== "string" || !operation.trim() || !Object.hasOwn(this.#definition.operations, operation)) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    const next = this.#behavior(behavior);
    const current = this.#behaviors.get(operation);
    if (!current) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    if (sameBehavior(current, next)) return;
    const before = published(current);
    this.#behaviors.set(operation, next);
    this.#observe(ExternalObservationTypes.BehaviorChanged, { operation, before, after: published(next) });
  }

  #setAvailability(state: ExternalAvailability): void {
    this.#control();
    if (!isAvailability(state)) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    if (state === this.#availability) return;
    const before = this.#availability;
    this.#availability = state;
    this.#observe(ExternalObservationTypes.AvailabilityChanged, { before, after: state });
  }

  #observe(type: string, data: CanonicalValue, event?: ScheduledEvent): void {
    this.#options.setup.observations.record({
      type,
      source: this.#definition.id,
      entityRefs: [{ kind: "external", id: this.#definition.id }],
      ...(event?.id ? { eventId: event.id } : {}),
      ...(event?.traceId ? { traceId: event.traceId } : {}),
      ...(event?.spanId ? { spanId: event.spanId } : {}),
      ...(event?.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
      ...(event?.causationId ? { causationId: event.causationId } : {}),
      data,
    });
  }

  #link(event: ScheduledEvent): ScheduleMetadata {
    const metadata: ScheduleMetadata = {};
    if (event.traceId !== undefined) metadata.traceId = event.traceId;
    if (event.spanId !== undefined) metadata.spanId = event.spanId;
    if (event.parentSpanId !== undefined) metadata.parentSpanId = event.parentSpanId;
    if (event.causationId !== undefined) metadata.causationId = event.causationId;
    return metadata;
  }

  #release(event: ScheduledEvent): void {
    for (const handle of this.#handles) if (handle.eventId === event.id) this.#handles.delete(handle);
  }

  #reject(requestId: string, operation: string, code: string): void {
    this.#rejectedCount += 1;
    this.#observe(ExternalObservationTypes.OperationRejected, { requestId, operation, code }, this.#options.activeEvent());
    this.#networkController.reply(requestId, { status: "error", body: { code } });
  }

  #accept(requestId: string, request: NetworkRequest): void {
    const operation = request.endpoint;
    if (this.#availability === "UNAVAILABLE" || this.#availability === "RATE_LIMITED") {
      const code = this.#availability === "UNAVAILABLE" ? ErrorCodes.EXTERNAL_UNAVAILABLE : ErrorCodes.EXTERNAL_RATE_LIMITED;
      this.#reject(requestId, operation, code);
      return;
    }
    if (!Object.hasOwn(this.#definition.operations, operation)) {
      this.#reject(requestId, operation, ErrorCodes.ENDPOINT_NOT_FOUND);
      return;
    }
    const behavior = this.#behaviors.get(operation);
    if (!behavior) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    // Captured at admission. Later availability and configure calls apply only to new arrivals.
    this.#admissions.set(requestId, {
      requestId,
      operation,
      body: canonicalCopy(request.body),
      behavior,
      availability: this.#availability,
    });
    this.#options.setup.enqueueNetworkWork(this.#definition.id, this.#types.arrival, { requestId });
  }

  #delay(admission: Admission): Duration {
    if (admission.availability !== "DEGRADED") return admission.behavior.latency;
    const sum = admission.behavior.latency + admission.behavior.degradedExtraLatency;
    if (!Number.isSafeInteger(sum)) this.#fail(ErrorCodes.TIME_OVERFLOW);
    return duration(sum);
  }

  #arrival(event: ScheduledEvent, context: HandlerContext): void {
    this.#release(event);
    const requestId = (event.payload as { requestId?: string }).requestId;
    const admission = requestId ? this.#admissions.get(requestId) : undefined;
    if (!admission) this.#fail(ErrorCodes.INVALID_OPERATION);
    const delay = this.#delay(admission);
    const completionTime = addDuration(context.clock.now(), delay);
    this.#admittedCount += 1;
    this.#observe(ExternalObservationTypes.OperationAdmitted, {
      requestId: admission.requestId, operation: admission.operation, completionTime,
    }, event);
    this.#handles.add(context.clock.schedule(delay, this.#types.complete, { requestId: admission.requestId }, this.#link(event)));
  }

  #parseDecision(value: unknown, now: SimulationTime): ParsedDecision {
    let copied: CanonicalValue;
    try { copied = canonicalCopy(value); }
    catch { this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION); }
    if (!plain(copied) || !exact(copied, ["nextState", "reply", "visibleChanges", "callbacks"]) || !Array.isArray(copied.callbacks)) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    const reply = copied.reply;
    if (!plain(reply) || !exact(reply, ["status", "body"]) || (reply.status !== "ok" && reply.status !== "error")) {
      this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    }
    const callbacks: ParsedCallback[] = [];
    for (const plan of copied.callbacks) {
      if (!plain(plan) || !exact(plan, ["after", "request"]) || !isDuration(plan.after)) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
      const request = plan.request;
      if (!plain(request) || !exact(request, ["target", "endpoint", "body"]) || !isIdentifier(request.target)
        || typeof request.endpoint !== "string" || !request.endpoint.trim()) {
        this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
      }
      let due: SimulationTime;
      try { due = addDuration(now, duration(plan.after)); }
      catch { this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION); }
      callbacks.push({
        after: duration(plan.after),
        due,
        request: { target: request.target, endpoint: request.endpoint, body: request.body as CanonicalValue },
      });
    }
    return {
      nextState: copied.nextState as CanonicalValue,
      visibleChanges: copied.visibleChanges as CanonicalValue,
      reply: { status: reply.status, body: reply.body as CanonicalValue },
      callbacks,
    };
  }

  #complete(event: ScheduledEvent, context: HandlerContext): void {
    this.#release(event);
    const requestId = (event.payload as { requestId?: string }).requestId;
    const admission = requestId ? this.#admissions.get(requestId) : undefined;
    if (!admission) this.#fail(ErrorCodes.INVALID_OPERATION);
    const operation = this.#definition.operations[admission.operation];
    if (!operation) this.#fail(ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
    const decision = operation.apply(
      canonicalCopy(admission.body),
      canonicalCopy(this.#state),
      canonicalCopy(admission.behavior.parameters),
    );
    const parsed = this.#parseDecision(decision, context.clock.now());
    this.#state = parsed.nextState;
    this.#visible = parsed.visibleChanges;
    this.#effectCount += 1;
    this.#admissions.delete(admission.requestId);
    this.#observe(ExternalObservationTypes.EffectCommitted, {
      requestId: admission.requestId, operation: admission.operation, visibleChanges: parsed.visibleChanges,
    }, event);
    for (let ordinal = 0; ordinal < parsed.callbacks.length; ordinal += 1) {
      const callback = parsed.callbacks[ordinal]!;
      this.#scheduledCallbackCount += 1;
      this.#observe(ExternalObservationTypes.CallbackScheduled, {
        originRequestId: admission.requestId, ordinal, dueTime: callback.due, target: callback.request.target,
      }, event);
      this.#handles.add(context.clock.schedule(callback.after, this.#types.callback, {
        originRequestId: admission.requestId,
        ordinal,
        request: { target: callback.request.target, endpoint: callback.request.endpoint, body: callback.request.body },
      }, this.#link(event)));
    }
    if (admission.behavior.dropResponse) {
      // The effect stays. The caller still reaches its network deadline.
      this.#suppressedCount += 1;
      this.#observe(ExternalObservationTypes.ResponseSuppressed, { requestId: admission.requestId, reason: "dropResponse" }, event);
      return;
    }
    this.#networkController.reply(admission.requestId, parsed.reply);
  }

  #callback(event: ScheduledEvent, _context: HandlerContext): ControlledTask {
    this.#release(event);
    const payload = event.payload as unknown as { originRequestId: string; ordinal: number; request: NetworkRequest };
    const http = this.#http;
    const runtime = this;
    return (function* (): Generator<ControlledOperation, void, CanonicalValue> {
      try {
        yield http.request(payload.request);
        runtime.#finishCallback(event, payload.originRequestId, payload.ordinal, "reply");
      } catch (error) {
        const code = codeOf(error);
        if (runtime.#violated || code !== ErrorCodes.NETWORK_TIMEOUT) throw error;
        runtime.#callbackTimeoutCount += 1;
        runtime.#finishCallback(event, payload.originRequestId, payload.ordinal, "timeout");
      }
    })();
  }

  #finishCallback(event: ScheduledEvent, originRequestId: string, ordinal: number, outcome: "reply" | "timeout"): void {
    this.#observe(ExternalObservationTypes.CallbackCompleted, { originRequestId, ordinal, outcome }, event);
  }
}
