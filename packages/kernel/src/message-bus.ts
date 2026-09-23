import type { BusMessage, DestinationDefinition, DestinationKind, FaultDecision, FaultDecisionPort, MessageBus, MessageBusController, MessageReceiver } from "@distlab/contracts";
import { MessageObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, EventHandler, Observation, ObservationSink, OperationController, ScheduledHandle, Scheduler, SimulationTime } from "@distlab/contracts/kernel";
import { duration, ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { addDuration } from "./clock.js";
import { canonicalCopy } from "./canonical.js";
import { DeterministicIdAllocator, isIdentifier } from "./identity.js";

const admissionType = "kernel.message.admission";
const dispatchType = "kernel.message.dispatch";
const arrivalType = "kernel.message.arrival";
const timeoutType = "kernel.message.timeout";
const retryType = "kernel.message.retry";
function fail(code: string): never {
  return throwSimulationError(code);
}
function requireId(value: unknown, code = ErrorCodes.INVALID_EVENT_PAYLOAD): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}
function present<T>(value: T | undefined, code = ErrorCodes.INVALID_EVENT_PAYLOAD): T {
  if (value === undefined) fail(code);
  return value;
}
const neutralDecision = (): FaultDecision => Object.freeze({
  ruleIds: Object.freeze([]), extraDelay: duration(0), drop: false, additionalCopies: 0, copySpacing: duration(0), fail: false,
});

/** Injected when a run does not supply its own delay, drop, or duplicate decisions. */
export const neutralFaultPort: FaultDecisionPort = Object.freeze({ evaluate: () => neutralDecision() });

export interface MessageDestinationInput {
  readonly id: string;
  readonly kind: DestinationKind;
  readonly deliveryDelay?: number;
  readonly ackTimeout?: number;
  readonly retryDelay?: number;
  readonly maxAttempts?: number;
  readonly capacity?: number;
}

export interface MessageCounterStart {
  readonly message?: number;
  readonly routing?: number;
  readonly delivery?: number;
  readonly trace?: number;
  readonly span?: number;
}

export interface MessageBusOptions {
  readonly runId: string;
  readonly destinations: readonly MessageDestinationInput[];
  readonly clock: { now(): SimulationTime };
  readonly scheduler: Pick<Scheduler, "schedule">;
  readonly operations: OperationController;
  readonly observations: ObservationSink & { registerSchema(type: string, validate: (data: CanonicalValue | undefined) => boolean): void };
  readonly faults: FaultDecisionPort;
  readonly activeOwner: () => ComponentId | undefined;
  readonly dispatching: () => boolean;
  readonly correlation: () => { readonly traceId?: string; readonly spanId?: string; readonly eventId?: string };
  readonly check: () => void;
  /** Starts namespaced counters at zero unless a test needs to prove overflow. */
  readonly initialCounters?: MessageCounterStart;
}

export interface MessageBusInspection {
  readonly destinations: readonly DestinationDefinition[];
  readonly subscriptions: readonly { readonly destination: string; readonly consumer: string }[];
  readonly records: readonly {
    readonly routingId: string;
    readonly messageId: string;
    readonly destination: string;
    readonly state: string;
    readonly attempt: number;
    readonly order: number;
    readonly message: BusMessage;
    readonly subscriber?: string;
    readonly consumer?: string;
  }[];
  readonly deadLetters: readonly {
    readonly routingId: string;
    readonly messageId: string;
    readonly destination: string;
    readonly message: BusMessage;
    readonly attempts: number;
    readonly reason: string;
    readonly subscriber?: string;
    readonly consumer?: string;
  }[];
  readonly cursors: readonly { readonly destination: string; readonly index: number }[];
  readonly counters: { readonly publications: number; readonly routing: number; readonly deliveries: number };
}

interface Sub {
  readonly destination: string;
  readonly consumer: ComponentId;
  readonly receiver: MessageReceiver;
  reserved: boolean;
}
interface Copy {
  readonly deliveryId: string;
  readonly routingId: string;
  readonly attempt: number;
  readonly consumer: ComponentId;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly traceId: string;
  readonly causationId: string;
  readonly dropped: boolean;
  delivered: boolean;
}
interface Routing {
  readonly routingId: string;
  readonly messageId: string;
  readonly destination: string;
  readonly order: number;
  readonly message: BusMessage;
  readonly publisher: ComponentId;
  readonly traceId: string;
  readonly publicationSpanId: string;
  readonly publicationParentSpanId?: string;
  readonly publishedObservationId: string;
  readonly subscriber?: ComponentId;
  state: "QUEUED" | "IN_FLIGHT" | "ACKED" | "RETRY" | "DEAD";
  attempt: number;
  settled: boolean;
  consumer?: ComponentId;
  deliveryCausationId: string;
  deadline?: ScheduledHandle;
}
interface Link { readonly traceId?: string; readonly spanId?: string; readonly parentSpanId?: string; readonly causationId?: string; readonly eventId?: string }
type FailureReason = "nack" | "timeout" | "unavailable";

const isData = (value: CanonicalValue | undefined): value is { [key: string]: CanonicalValue } => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: CanonicalValue | undefined): value is string => typeof value === "string" && value.length > 0;
const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function shape(data: CanonicalValue | undefined, required: readonly string[], optional: readonly string[] = []): data is { [key: string]: CanonicalValue } {
  if (!isData(data)) return false;
  const keys = Object.keys(data);
  const allowed = new Set([...required, ...optional]);
  return keys.every(key => allowed.has(key)) && required.every(key => Object.hasOwn(data, key));
}
function isMessage(value: CanonicalValue | undefined): boolean {
  return shape(value, ["type", "body"]) && text(value.type);
}
function sequence(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!whole(value)) fail(ErrorCodes.INVALID_RUN_INPUT);
  return value;
}

/** One run's trusted broker. Publish admission is not consumption, and reset constructs a new bus. */
export class DeterministicMessageBus {
  readonly #options: MessageBusOptions;
  readonly #definitions = new Map<string, DestinationDefinition>();
  readonly #subscriptions = new Map<string, Sub>();
  readonly #byDestination = new Map<string, Sub[]>();
  readonly #records = new Map<string, Routing>();
  readonly #copies = new Map<string, Copy>();
  readonly #cursors = new Map<string, number>();
  readonly #dead: MessageBusInspection["deadLetters"][number][] = [];
  readonly #messages: DeterministicIdAllocator;
  readonly #routingIds: DeterministicIdAllocator;
  readonly #deliveries: DeterministicIdAllocator;
  readonly #traces: DeterministicIdAllocator;
  readonly #spans: DeterministicIdAllocator;
  #nextOrder = 0;
  #sealed = false;
  #dispatchPending = false;
  readonly controller: MessageBusController;

  constructor(options: MessageBusOptions) {
    this.#options = options;
    if (!isIdentifier(options.runId) || !Array.isArray(options.destinations) || !options.faults || typeof options.faults.evaluate !== "function") fail(ErrorCodes.INVALID_RUN_INPUT);
    const start = options.initialCounters;
    const messageStart = sequence(start?.message);
    const routingStart = sequence(start?.routing);
    const deliveryStart = sequence(start?.delivery);
    const traceStart = sequence(start?.trace);
    const spanStart = sequence(start?.span);
    if (start && (!plain(start) || Object.keys(start).some(key => !["message", "routing", "delivery", "trace", "span"].includes(key)))) fail(ErrorCodes.INVALID_RUN_INPUT);
    for (const input of options.destinations) this.#define(input);
    this.#messages = new DeterministicIdAllocator("message", options.runId, messageStart);
    this.#routingIds = new DeterministicIdAllocator("routing", options.runId, routingStart);
    this.#deliveries = new DeterministicIdAllocator("delivery", options.runId, deliveryStart);
    this.#traces = new DeterministicIdAllocator("trace", options.runId, traceStart);
    this.#spans = new DeterministicIdAllocator("span", options.runId, spanStart);
    this.#registerSchemas();
    this.controller = Object.freeze({
      subscribe: (destination: string, consumer: ComponentId, receiver: MessageReceiver) => this.#subscribe(destination, consumer, receiver),
      acknowledge: (deliveryId: string, outcome: "ack" | "nack") => this.#acknowledge(deliveryId, outcome),
      consumerChanged: (consumer: ComponentId) => this.#consumerChanged(consumer),
    });
  }

  seal(): void { this.#options.check(); this.#sealed = true; }
  forOwner(owner: ComponentId): MessageBus {
    this.#options.check();
    if (!isIdentifier(owner)) fail(ErrorCodes.INVALID_REGISTRATION);
    return Object.freeze({ publish: (destination: string, message: BusMessage) => this.#publish(owner, destination, message) });
  }
  inspect(): MessageBusInspection {
    this.#options.check();
    const destinations = [...this.#definitions.values()];
    const view = {
      destinations,
      subscriptions: [...this.#subscriptions.values()].map(({ destination, consumer }) => ({ destination, consumer })),
      records: [...this.#records.values()].sort((left, right) => left.order - right.order).map(record => ({
        routingId: record.routingId, messageId: record.messageId, destination: record.destination, state: record.state,
        attempt: record.attempt, order: record.order, message: record.message,
        ...(record.subscriber ? { subscriber: record.subscriber } : {}), ...(record.consumer ? { consumer: record.consumer } : {}),
      })),
      deadLetters: this.#dead,
      cursors: destinations.filter(destination => destination.kind === "queue").map(destination => ({ destination: destination.id, index: this.#cursors.get(destination.id) ?? 0 })),
      counters: { publications: this.#messages.nextSequence, routing: this.#routingIds.nextSequence, deliveries: this.#deliveries.nextSequence },
    };
    return canonicalCopy(view) as unknown as MessageBusInspection;
  }
  handlers(): readonly (readonly [string, EventHandler])[] {
    return [
      [admissionType, event => this.#admit(event)],
      [dispatchType, () => this.#onDispatch()],
      [arrivalType, event => this.#arrive(event)],
      [timeoutType, event => this.#onTimeout(event.payload as { routingId?: string; attempt?: number })],
      [retryType, event => this.#onRetry(event.payload as { routingId?: string })],
    ];
  }

  #define(input: MessageDestinationInput): void {
    if (!plain(input) || Object.keys(input).some(key => !["id", "kind", "deliveryDelay", "ackTimeout", "retryDelay", "maxAttempts", "capacity"].includes(key)) ||
        !isIdentifier(input.id) || (input.kind !== "queue" && input.kind !== "topic") || this.#definitions.has(input.id)) fail(ErrorCodes.INVALID_RUN_INPUT);
    const deliveryDelay = input.deliveryDelay ?? 0;
    const retryDelay = input.retryDelay ?? 0;
    const ackTimeout = input.ackTimeout ?? 1000;
    const maxAttempts = input.maxAttempts ?? 3;
    const capacity = input.capacity ?? 10000;
    if (![deliveryDelay, retryDelay].every(whole) || !whole(ackTimeout) || ackTimeout === 0 ||
        !whole(maxAttempts) || maxAttempts === 0 || !whole(capacity) || capacity === 0) fail(ErrorCodes.INVALID_RUN_INPUT);
    const definition = Object.freeze({ id: input.id, kind: input.kind, deliveryDelay: duration(deliveryDelay), ackTimeout: duration(ackTimeout),
      retryDelay: duration(retryDelay), maxAttempts, capacity });
    this.#definitions.set(definition.id, definition);
    this.#byDestination.set(definition.id, []);
    if (definition.kind === "queue") this.#cursors.set(definition.id, 0);
  }
  #registerSchemas(): void {
    const state = (value: CanonicalValue | undefined): boolean => value === "PUBLISHED" || value === "QUEUED" || value === "IN_FLIGHT" || value === "ACKED" || value === "NACKED" || value === "RETRY" || value === "DROPPED" || value === "DEAD";
    const id = (data: { [key: string]: CanonicalValue }, key: string): boolean => text(data[key]);
    const schemas: Readonly<Record<string, (data: CanonicalValue | undefined) => boolean>> = {
      [MessageObservationTypes.Published]: data => shape(data, ["messageId", "destination", "message", "recipientCount"]) && id(data, "messageId") && id(data, "destination") && isMessage(data.message) && whole(data.recipientCount),
      [MessageObservationTypes.Queued]: data => shape(data, ["messageId", "routingId", "before", "after"], ["subscriber"]) && id(data, "messageId") && id(data, "routingId") && state(data.before) && state(data.after) && (data.subscriber === undefined || text(data.subscriber)),
      [MessageObservationTypes.Delivered]: data => shape(data, ["messageId", "deliveryId", "routingId", "consumer", "attempt"]) && ["messageId", "deliveryId", "routingId", "consumer"].every(key => id(data, key)) && whole(data.attempt) && data.attempt !== 0,
      [MessageObservationTypes.Dropped]: data => shape(data, ["messageId", "deliveryId", "routingId", "reason"]) && ["messageId", "deliveryId", "routingId", "reason"].every(key => id(data, key)),
      [MessageObservationTypes.Acknowledged]: data => shape(data, ["messageId", "deliveryId", "routingId", "consumer", "before", "after"]) && ["messageId", "deliveryId", "routingId", "consumer"].every(key => id(data, key)) && state(data.before) && state(data.after),
      [MessageObservationTypes.Nacked]: data => shape(data, ["messageId", "deliveryId", "routingId", "consumer", "reason", "before", "after"]) && ["messageId", "deliveryId", "routingId", "consumer", "reason"].every(key => id(data, key)) && state(data.before) && state(data.after),
      [MessageObservationTypes.RetryScheduled]: data => shape(data, ["routingId", "messageId", "previousAttempt", "dueTime", "before", "after"]) && id(data, "routingId") && id(data, "messageId") && whole(data.previousAttempt) && whole(data.dueTime) && state(data.before) && state(data.after),
      [MessageObservationTypes.Dead]: data => shape(data, ["routingId", "messageId", "attempts", "reason", "before", "after"]) && id(data, "routingId") && id(data, "messageId") && text(data.reason) && whole(data.attempts) && data.attempts !== 0 && state(data.before) && state(data.after),
      [MessageObservationTypes.AckStale]: data => shape(data, ["deliveryId", "outcome"]) && id(data, "deliveryId") && (data.outcome === "ack" || data.outcome === "nack"),
      [MessageObservationTypes.PublishRejected]: data => shape(data, ["destination", "code"]) && id(data, "destination") && text(data.code),
    };
    for (const [type, validate] of Object.entries(schemas)) this.#options.observations.registerSchema(type, validate);
  }
  #need(allocator: DeterministicIdAllocator, count: number): void {
    if (count === 0) return;
    const end = allocator.nextSequence + count;
    if (!whole(count) || !Number.isSafeInteger(end) || end > Number.MAX_SAFE_INTEGER) fail(ErrorCodes.IDENTITY_OVERFLOW);
  }
  #subscription(destination: string, consumer: string): Sub | undefined { return this.#subscriptions.get(`${destination}\u0000${consumer}`); }
  #activeCount(destination: string): number {
    let count = 0;
    for (const record of this.#records.values()) if (record.destination === destination && record.state !== "ACKED" && record.state !== "DEAD") count += 1;
    return count;
  }
  #copyMessage(input: BusMessage): BusMessage {
    let copy: BusMessage;
    try { copy = canonicalCopy(input) as unknown as BusMessage; } catch { return fail(ErrorCodes.INVALID_MESSAGE_OPERATION); }
    if (!isMessage(copy as unknown as CanonicalValue)) fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    return copy;
  }
  #observe(type: string, source: ComponentId, data: CanonicalValue, link: Link = {}, entities: readonly { kind: string; id: string }[] = []): Observation {
    return this.#options.observations.record({ type, source, data, ...(entities.length ? { entityRefs: entities } : {}),
      ...(link.traceId ? { traceId: link.traceId } : {}), ...(link.spanId ? { spanId: link.spanId } : {}),
      ...(link.parentSpanId ? { parentSpanId: link.parentSpanId } : {}), ...(link.causationId ? { causationId: link.causationId } : {}),
      ...(link.eventId ? { eventId: link.eventId } : {}) });
  }
  #entities(record: Routing, deliveryId?: string): { kind: string; id: string }[] {
    return [{ kind: "message", id: record.messageId }, { kind: "destination", id: record.destination }, { kind: "routing", id: record.routingId },
      ...(deliveryId ? [{ kind: "delivery", id: deliveryId }] : [])];
  }
  #schedule(time: SimulationTime, type: string, payload: CanonicalValue, link: Link = {}): ScheduledHandle {
    return this.#options.scheduler.schedule({ time, type, payload, source: "simulation", target: "simulation",
      ...(link.traceId ? { traceId: link.traceId } : {}), ...(link.spanId ? { spanId: link.spanId } : {}),
      ...(link.parentSpanId ? { parentSpanId: link.parentSpanId } : {}), ...(link.causationId ? { causationId: link.causationId } : {}) });
  }
  #publicationLink(record: Routing, eventId?: string): Link {
    return { traceId: record.traceId, spanId: record.publicationSpanId, ...(record.publicationParentSpanId ? { parentSpanId: record.publicationParentSpanId } : {}),
      causationId: record.deliveryCausationId, ...(eventId ? { eventId } : {}) };
  }
  #copyLink(copy: Copy, eventId?: string): Link {
    return { traceId: copy.traceId, spanId: copy.spanId, parentSpanId: copy.parentSpanId, causationId: copy.causationId, ...(eventId ? { eventId } : {}) };
  }
  #subscribe(destination: string, consumer: ComponentId, receiver: MessageReceiver): void {
    this.#options.check();
    if (this.#sealed || !this.#definitions.has(destination) || !isIdentifier(consumer) || !receiver || typeof receiver.ready !== "function" || typeof receiver.accept !== "function") fail(ErrorCodes.INVALID_REGISTRATION);
    const key = `${destination}\u0000${consumer}`;
    if (this.#subscriptions.has(key)) fail(ErrorCodes.INVALID_REGISTRATION);
    const subscription = { destination, consumer, receiver, reserved: false };
    this.#subscriptions.set(key, subscription);
    this.#byDestination.get(destination)!.push(subscription);
  }
  #publish(owner: ComponentId, destination: string, message: BusMessage): ControlledOperation {
    this.#options.check();
    if (!this.#sealed || this.#options.activeOwner() !== owner || typeof destination !== "string" || !this.#definitions.has(destination)) fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    const body = this.#copyMessage(message);
    const operation = this.#options.operations.create();
    const parent = this.#options.correlation();
    this.#schedule(this.#options.clock.now(), admissionType, { operationId: operation.operationId, destination, publisher: owner, message: body as unknown as CanonicalValue },
      parent.traceId ? { traceId: parent.traceId, ...(parent.spanId ? { spanId: parent.spanId } : {}) } : {});
    return operation;
  }
  #admit(event: Parameters<EventHandler>[0]): void {
    this.#options.check();
    const payload = event.payload as { operationId?: string; destination?: string; publisher?: string; message?: BusMessage };
    const operationId = requireId(payload?.operationId);
    const destinationId = requireId(payload?.destination);
    const publisher = requireId(payload?.publisher);
    const message = present(payload?.message);
    const destination = this.#definitions.get(destinationId) ?? fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    const subs = this.#byDestination.get(destination.id) ?? [];
    const recipients = destination.kind === "topic" ? subs.length : 1;
    const parentTrace = event.traceId;
    const parentSpan = event.spanId;
    if (this.#activeCount(destination.id) + recipients > destination.capacity) {
      this.#observe(MessageObservationTypes.PublishRejected, publisher, { destination: destination.id, code: ErrorCodes.BUS_CAPACITY_EXCEEDED },
        { ...(parentTrace ? { traceId: parentTrace } : {}), ...(parentSpan && parentTrace ? { spanId: parentSpan } : {}), eventId: event.id },
        [{ kind: "destination", id: destination.id }]);
      this.#options.operations.complete(operationId, { kind: "failure", error: { code: ErrorCodes.BUS_CAPACITY_EXCEEDED, context: { destination: destination.id } } });
      return;
    }
    this.#need(this.#traces, parentTrace ? 0 : 1);
    this.#need(this.#spans, 1);
    this.#need(this.#messages, 1);
    this.#need(this.#routingIds, recipients);
    const end = this.#nextOrder + recipients;
    if (recipients > 0 && (!Number.isSafeInteger(end) || end > Number.MAX_SAFE_INTEGER)) fail(ErrorCodes.IDENTITY_OVERFLOW);
    const traceId = parentTrace ?? this.#traces.allocate();
    const publicationSpanId = this.#spans.allocate();
    const messageId = this.#messages.allocate();
    const published = this.#observe(MessageObservationTypes.Published, publisher, { messageId, destination: destination.id, message: message as unknown as CanonicalValue, recipientCount: recipients },
      { traceId, spanId: publicationSpanId, ...(parentSpan ? { parentSpanId: parentSpan } : {}), eventId: event.id },
      [{ kind: "message", id: messageId }, { kind: "destination", id: destination.id }]);
    const created: Routing[] = [];
    const queue = (subscriber?: ComponentId): void => {
      const routingId = this.#routingIds.allocate();
      const record: Routing = { routingId, messageId, destination: destination.id, order: this.#nextOrder++, message, publisher, traceId, publicationSpanId,
        ...(parentSpan ? { publicationParentSpanId: parentSpan } : {}), publishedObservationId: published.id,
        ...(subscriber ? { subscriber } : {}), state: "QUEUED", attempt: 0, settled: false, deliveryCausationId: published.id };
      this.#observe(MessageObservationTypes.Queued, publisher, { messageId, routingId, before: "PUBLISHED", after: "QUEUED", ...(subscriber ? { subscriber } : {}) },
        { traceId, spanId: publicationSpanId, ...(parentSpan ? { parentSpanId: parentSpan } : {}), causationId: published.id, eventId: event.id }, this.#entities(record));
      created.push(record);
    };
    if (destination.kind === "topic") for (const subscription of subs) queue(subscription.consumer);
    else queue();
    for (const record of created) this.#records.set(record.routingId, record);
    this.#options.operations.complete(operationId, { kind: "success", value: { messageId } });
    this.#scheduleDispatch();
  }
  #selectTopic(record: Routing): Sub | undefined {
    if (!record.subscriber) return undefined;
    const subscription = this.#subscription(record.destination, record.subscriber);
    if (!subscription || subscription.reserved || !subscription.receiver.ready()) return undefined;
    return subscription;
  }
  #selectQueue(destination: string): { readonly sub: Sub; readonly cursor: number } | undefined {
    const subs = this.#byDestination.get(destination);
    if (!subs?.length) return undefined;
    const start = this.#cursors.get(destination) ?? 0;
    for (let offset = 0; offset < subs.length; offset += 1) {
      const index = (start + offset) % subs.length;
      const subscription = subs[index];
      if (!subscription || subscription.reserved || !subscription.receiver.ready()) continue;
      return { sub: subscription, cursor: (index + 1) % subs.length };
    }
    return undefined;
  }
  #canReserve(record: Routing): boolean {
    return record.state === "QUEUED" && (record.subscriber ? this.#selectTopic(record) !== undefined : this.#selectQueue(record.destination) !== undefined);
  }
  #scheduleDispatch(): void {
    if (this.#dispatchPending || ![...this.#records.values()].some(record => this.#canReserve(record))) return;
    this.#dispatchPending = true;
    this.#schedule(this.#options.clock.now(), dispatchType, null);
  }
  #onDispatch(): void {
    this.#options.check();
    this.#dispatchPending = false;
    while (this.#reserveNext()) { /* Each pass reserves the oldest eligible record. */ }
  }
  #reserveNext(): boolean {
    const queued = [...this.#records.values()].filter(record => record.state === "QUEUED").sort((left, right) => left.order - right.order);
    for (const record of queued) {
      if (record.subscriber) {
        const subscription = this.#selectTopic(record);
        if (!subscription) continue;
        this.#reserve(record, subscription);
        return true;
      }
      const selected = this.#selectQueue(record.destination);
      if (!selected) continue;
      this.#reserve(record, selected.sub, selected.cursor);
      return true;
    }
    return false;
  }
  #fault(record: Routing, subscription: Sub, attempt: number): { extraDelay: number; drop: boolean; copies: number; spacing: number } {
    const decision = this.#options.faults.evaluate({ point: "message.delivery", subjectId: `${record.routingId}#${attempt}`, source: record.publisher, target: subscription.consumer, name: record.destination });
    if (!plain(decision) || Object.keys(decision).some(key => !["ruleIds", "extraDelay", "drop", "additionalCopies", "copySpacing", "fail"].includes(key)) ||
        !Array.isArray(decision.ruleIds) || decision.ruleIds.some(id => typeof id !== "string") || !whole(decision.extraDelay) || typeof decision.drop !== "boolean" ||
        typeof decision.fail !== "boolean" || !whole(decision.additionalCopies) || decision.additionalCopies > 16 || !whole(decision.copySpacing)) fail(ErrorCodes.INVALID_FAULT);
    if (decision.fail) fail(ErrorCodes.INVALID_FAULT);
    return { extraDelay: decision.extraDelay, drop: decision.drop, copies: decision.drop ? 1 : 1 + decision.additionalCopies, spacing: decision.copySpacing };
  }
  #reserve(record: Routing, subscription: Sub, cursor?: number): void {
    const destination = this.#definitions.get(record.destination) ?? fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    const attempt = record.attempt + 1;
    const decision = this.#fault(record, subscription, attempt);
    this.#need(this.#spans, decision.copies);
    this.#need(this.#deliveries, decision.copies);
    const arrival = addDuration(addDuration(this.#options.clock.now(), destination.deliveryDelay), duration(decision.extraDelay));
    const deadline = addDuration(arrival, destination.ackTimeout);
    const times: SimulationTime[] = [];
    for (let index = 0; index < decision.copies; index += 1) {
      const spacing = index * decision.spacing;
      if (!Number.isSafeInteger(spacing)) fail(ErrorCodes.TIME_OVERFLOW);
      times.push(addDuration(arrival, duration(spacing)));
    }
    const copies: Copy[] = [];
    for (let index = 0; index < decision.copies; index += 1) copies.push({ deliveryId: this.#deliveries.allocate(), routingId: record.routingId, attempt, consumer: subscription.consumer,
      spanId: this.#spans.allocate(), parentSpanId: record.publicationSpanId, traceId: record.traceId, causationId: record.deliveryCausationId, dropped: decision.drop, delivered: false });
    record.attempt = attempt;
    record.settled = false;
    record.state = "IN_FLIGHT";
    record.consumer = subscription.consumer;
    subscription.reserved = true;
    if (cursor !== undefined) this.#cursors.set(record.destination, cursor);
    // The deadline is inserted before arrivals so an acknowledgement at that exact time loses.
    record.deadline = this.#schedule(deadline, timeoutType, { routingId: record.routingId, attempt }, this.#publicationLink(record));
    for (let index = 0; index < copies.length; index += 1) {
      const copy = copies[index]!;
      this.#copies.set(copy.deliveryId, copy);
      this.#schedule(times[index]!, arrivalType, { routingId: record.routingId, deliveryId: copy.deliveryId }, this.#copyLink(copy));
    }
  }
  #unreserve(record: Routing): void {
    if (!record.consumer) return;
    const subscription = this.#subscription(record.destination, record.consumer);
    if (subscription) subscription.reserved = false;
  }
  #arrive(event: Parameters<EventHandler>[0]): void {
    this.#options.check();
    const payload = event.payload as { routingId?: string; deliveryId?: string };
    const record = present(payload?.routingId ? this.#records.get(payload.routingId) : undefined);
    const copy = present(payload?.deliveryId ? this.#copies.get(payload.deliveryId) : undefined);
    if (copy.routingId !== record.routingId) fail(ErrorCodes.INVALID_EVENT_PAYLOAD);
    const link = this.#copyLink(copy, event.id);
    if (copy.dropped) {
      this.#observe(MessageObservationTypes.Dropped, copy.consumer, { messageId: record.messageId, deliveryId: copy.deliveryId, routingId: record.routingId, reason: "fault" }, link, this.#entities(record, copy.deliveryId));
      return;
    }
    const subscription = this.#subscription(record.destination, copy.consumer) ?? fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    const open = record.state === "IN_FLIGHT" && record.attempt === copy.attempt && !record.settled;
    if (!subscription.receiver.ready()) {
      if (open) this.#fail(record, "unavailable", false, copy);
      else this.#observe(MessageObservationTypes.Dropped, copy.consumer, { messageId: record.messageId, deliveryId: copy.deliveryId, routingId: record.routingId, reason: "unavailable" }, link, this.#entities(record, copy.deliveryId));
      return;
    }
    copy.delivered = true;
    this.#observe(MessageObservationTypes.Delivered, copy.consumer, { messageId: record.messageId, deliveryId: copy.deliveryId, routingId: record.routingId, consumer: copy.consumer, attempt: copy.attempt }, link, this.#entities(record, copy.deliveryId));
    subscription.receiver.accept(Object.freeze({ messageId: record.messageId, deliveryId: copy.deliveryId, destination: record.destination, attempt: copy.attempt, message: record.message }));
  }
  #acknowledge(deliveryId: string, outcome: "ack" | "nack"): void {
    this.#options.check();
    if (!this.#options.dispatching() || (outcome !== "ack" && outcome !== "nack")) fail(ErrorCodes.INVALID_DELIVERY);
    const copy = typeof deliveryId === "string" ? this.#copies.get(deliveryId) : undefined;
    if (!copy) fail(ErrorCodes.INVALID_DELIVERY);
    const record = this.#records.get(copy.routingId) ?? fail(ErrorCodes.INVALID_DELIVERY);
    const eventId = this.#options.correlation().eventId;
    const live = copy.delivered && !copy.dropped && record.state === "IN_FLIGHT" && record.attempt === copy.attempt && !record.settled;
    if (!live) {
      this.#observe(MessageObservationTypes.AckStale, copy.consumer, { deliveryId, outcome }, this.#copyLink(copy, eventId), this.#entities(record, deliveryId));
      return;
    }
    if (outcome === "ack") this.#ack(record, copy, eventId);
    else this.#fail(record, "nack", false, copy);
  }
  #ack(record: Routing, copy: Copy, eventId?: string): void {
    record.settled = true;
    this.#observe(MessageObservationTypes.Acknowledged, copy.consumer, { messageId: record.messageId, deliveryId: copy.deliveryId, routingId: record.routingId, consumer: copy.consumer, before: "IN_FLIGHT", after: "ACKED" },
      this.#copyLink(copy, eventId), this.#entities(record, copy.deliveryId));
    record.deadline?.cancel();
    delete record.deadline;
    this.#unreserve(record);
    record.state = "ACKED";
    this.#scheduleDispatch();
  }
  #fail(record: Routing, reason: FailureReason, fromTimeout: boolean, copy?: Copy): void {
    if (record.state !== "IN_FLIGHT" || record.settled) return;
    const destination = this.#definitions.get(record.destination) ?? fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    const exhausted = record.attempt >= destination.maxAttempts;
    const due = exhausted ? undefined : addDuration(this.#options.clock.now(), destination.retryDelay);
    const source = copy?.consumer ?? record.consumer ?? record.subscriber ?? record.publisher;
    const eventId = this.#options.correlation().eventId;
    const link = copy ? this.#copyLink(copy, eventId) : this.#publicationLink(record, eventId);
    record.settled = true;
    if (reason !== "timeout" && copy) this.#observe(MessageObservationTypes.Nacked, source, { messageId: record.messageId, deliveryId: copy.deliveryId, routingId: record.routingId, consumer: copy.consumer, reason, before: "IN_FLIGHT", after: "NACKED" }, link, this.#entities(record, copy.deliveryId));
    const before = reason === "timeout" ? "IN_FLIGHT" : "NACKED";
    let retryId: string | undefined;
    if (exhausted) this.#observe(MessageObservationTypes.Dead, source, { routingId: record.routingId, messageId: record.messageId, attempts: record.attempt, reason, before, after: "DEAD" }, link, this.#entities(record));
    else {
      const scheduled = this.#observe(MessageObservationTypes.RetryScheduled, source, { routingId: record.routingId, messageId: record.messageId, previousAttempt: record.attempt, dueTime: due!, before, after: "RETRY" }, link, this.#entities(record));
      retryId = scheduled.id;
    }
    if (!fromTimeout) record.deadline?.cancel();
    delete record.deadline;
    const consumer = record.consumer;
    this.#unreserve(record);
    if (exhausted || due === undefined || retryId === undefined) {
      record.state = "DEAD";
      this.#dead.push({ routingId: record.routingId, messageId: record.messageId, destination: record.destination, message: record.message, attempts: record.attempt, reason,
        ...(record.subscriber ? { subscriber: record.subscriber } : {}), ...(consumer ? { consumer } : {}) });
    } else {
      record.state = "RETRY";
      record.deliveryCausationId = retryId;
      this.#schedule(due, retryType, { routingId: record.routingId }, { traceId: record.traceId, spanId: record.publicationSpanId,
        ...(record.publicationParentSpanId ? { parentSpanId: record.publicationParentSpanId } : {}), causationId: retryId });
    }
    this.#scheduleDispatch();
  }
  #onTimeout(payload: { routingId?: string; attempt?: number }): void {
    this.#options.check();
    const record = payload.routingId ? this.#records.get(payload.routingId) : undefined;
    if (!record || record.attempt !== payload.attempt || record.state !== "IN_FLIGHT" || record.settled) return;
    this.#fail(record, "timeout", true);
  }
  #onRetry(payload: { routingId?: string }): void {
    this.#options.check();
    const record = payload.routingId ? this.#records.get(payload.routingId) : undefined;
    if (!record || record.state !== "RETRY") return;
    record.state = "QUEUED";
    delete record.consumer;
    record.settled = false;
    this.#observe(MessageObservationTypes.Queued, record.publisher, { messageId: record.messageId, routingId: record.routingId, before: "RETRY", after: "QUEUED", ...(record.subscriber ? { subscriber: record.subscriber } : {}) },
      this.#publicationLink(record), this.#entities(record));
    this.#scheduleDispatch();
  }
  #consumerChanged(consumer: ComponentId): void {
    this.#options.check();
    if (!this.#options.dispatching() || !isIdentifier(consumer)) fail(ErrorCodes.INVALID_MESSAGE_OPERATION);
    if (![...this.#subscriptions.values()].some(subscription => subscription.consumer === consumer)) return;
    this.#scheduleDispatch();
  }
}
