import type { FaultDecisionPort, NetworkController, NetworkPolicy, NetworkReceiver, NetworkReply, NetworkRequest, VirtualNetwork } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, EventHandler, ObservationSink, OperationController, ScheduledHandle, Scheduler, SeededRandomPort, SimulationTime } from "@distlab/contracts/kernel";
import { duration, ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { addDuration } from "./clock.js";
import { canonicalCopy } from "./canonical.js";
import { DeterministicIdAllocator, isIdentifier } from "./identity.js";

export type NetworkLinks = readonly { readonly source: ComponentId; readonly target: ComponentId; readonly policy?: Partial<NetworkPolicy> }[];
export interface NetworkSetup {
  networkFor(owner: ComponentId): VirtualNetwork;
  networkController(): NetworkController;
  networkInFlight(): readonly NetworkFlight[];
  /** Trusted receiver adapter schedules target-owned controlled work. */
  enqueueNetworkWork(owner: ComponentId, type: string, payload: CanonicalValue): ScheduledHandle;
}
export interface NetworkFlight {
  readonly requestId: string;
  readonly source: ComponentId;
  readonly target: ComponentId;
  readonly endpoint: string;
  readonly deadline: SimulationTime;
  readonly state: "SENT" | "ADMITTED" | "REPLIED" | "TIMED_OUT";
}
export interface NetworkOptions {
  readonly targets: readonly ComponentId[];
  readonly links: NetworkLinks;
  readonly runId: string;
  readonly clock: { now(): SimulationTime };
  readonly scheduler: Pick<Scheduler, "schedule">;
  readonly operations: OperationController;
  readonly observations: ObservationSink;
  readonly random: SeededRandomPort;
  readonly faults?: FaultDecisionPort;
  readonly activeOwner: () => ComponentId | undefined;
  readonly dispatching: () => boolean;
  readonly correlation: () => { readonly traceId?: string; readonly spanId?: string; readonly eventId?: string };
  readonly check: () => void;
}

type Flight = Omit<NetworkFlight, "state"> & {
  state: NetworkFlight["state"];
  request: NetworkRequest;
  policy: NetworkPolicy;
  sentId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  deadlineHandle: ScheduledHandle;
  replied: boolean;
  settled: boolean;
};
const deadlineType = "kernel.network.deadline";
const deliveryType = "kernel.network.delivery";
const responseType = "kernel.network.response";
const fail = (code: string): never => throwSimulationError(code);
const neutral = () => ({ ruleIds: [], extraDelay: 0, drop: false, additionalCopies: 0, copySpacing: 0, fail: false });
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0); }
function policy(input: Partial<NetworkPolicy> | undefined): NetworkPolicy {
  if (input !== undefined && (!plain(input) || Object.keys(input).some(key => !["requestLatency", "responseLatency", "jitter", "timeout", "failureRate"].includes(key)))) fail(ErrorCodes.INVALID_RUN_INPUT);
  const result = { requestLatency: input?.requestLatency ?? 0, responseLatency: input?.responseLatency ?? 0,
    jitter: input?.jitter ?? 0, timeout: input?.timeout ?? 1000, failureRate: input?.failureRate ?? 0 };
  if (![result.requestLatency, result.responseLatency, result.jitter].every(nonnegative) || !nonnegative(result.timeout) || result.timeout === 0 ||
      typeof result.failureRate !== "number" || !Number.isFinite(result.failureRate) || result.failureRate < 0 || result.failureRate > 1) fail(ErrorCodes.INVALID_RUN_INPUT);
  return Object.freeze(result) as NetworkPolicy;
}

/** One run's trusted transport. All receiver work begins in a scheduled delivery event. */
export class DeterministicVirtualNetwork {
  readonly #options: NetworkOptions;
  readonly #targets: Set<string>;
  readonly #links = new Map<string, NetworkPolicy>();
  readonly #receivers = new Map<string, NetworkReceiver>();
  readonly #flights = new Map<string, Flight>();
  readonly #traces: DeterministicIdAllocator;
  readonly #spans: DeterministicIdAllocator;
  #sealed = false;
  readonly controller: NetworkController;

  constructor(options: NetworkOptions) {
    this.#options = options;
    if (!isIdentifier(options.runId) || !Array.isArray(options.targets) || !Array.isArray(options.links)) fail(ErrorCodes.INVALID_RUN_INPUT);
    this.#targets = new Set(options.targets);
    if (this.#targets.size !== options.targets.length || [...this.#targets].some(target => !isIdentifier(target))) fail(ErrorCodes.INVALID_RUN_INPUT);
    for (const link of options.links) {
      if (!plain(link) || !isIdentifier(link.source) || !isIdentifier(link.target) || !this.#targets.has(link.source) || !this.#targets.has(link.target)) fail(ErrorCodes.INVALID_RUN_INPUT);
      const key = this.#key(link.source, link.target);
      if (this.#links.has(key)) fail(ErrorCodes.INVALID_RUN_INPUT);
      this.#links.set(key, policy(link.policy));
    }
    this.#traces = new DeterministicIdAllocator("trace", options.runId);
    this.#spans = new DeterministicIdAllocator("span", options.runId);
    for (const type of ["network.request.sent", "network.request.delivered", "network.request.dropped", "network.response.sent", "network.response.dropped", "network.response.received", "network.request.timedout"])
      (options.observations as ObservationSink & { registerSchema(type: string, validate: (data: CanonicalValue | undefined) => boolean): void }).registerSchema(type, data => plain(data) && typeof data.requestId === "string");
    this.controller = Object.freeze({
      register: (target: ComponentId, receiver: NetworkReceiver) => {
        options.check();
        if (this.#sealed || !this.#targets.has(target) || this.#receivers.has(target) || !receiver || typeof receiver.accept !== "function") fail(ErrorCodes.INVALID_REGISTRATION);
        this.#receivers.set(target, receiver);
      },
      reply: (requestId: string, reply: NetworkReply) => this.reply(requestId, reply),
    });
  }
  #key(source: string, target: string): string { return `${source}\u0000${target}`; }
  seal(): void { this.#sealed = true; }
  forOwner(owner: ComponentId): VirtualNetwork {
    this.#options.check();
    if (!this.#targets.has(owner)) fail(ErrorCodes.INVALID_REGISTRATION);
    return Object.freeze({ request: (request: NetworkRequest) => { this.#options.check(); return this.request(owner, request); } });
  }
  inFlight(): readonly NetworkFlight[] {
    this.#options.check();
    return Object.freeze([...this.#flights.values()].filter(flight => !flight.settled).map(({ requestId, source, target, endpoint, deadline, state }) =>
      Object.freeze({ requestId, source, target, endpoint, deadline, state })));
  }
  handlers(): readonly (readonly [string, EventHandler])[] {
    return [
      [deadlineType, event => this.#deadline((event.payload as { requestId: string }).requestId, event.id)],
      [deliveryType, event => this.#deliver((event.payload as { requestId: string }).requestId, event.id)],
      [responseType, event => { const payload = event.payload as unknown as { requestId: string; reply: NetworkReply }; this.#receive(payload.requestId, payload.reply, event.id); }],
    ];
  }
  request(source: ComponentId, input: NetworkRequest): ControlledOperation {
    const { clock, activeOwner, operations, scheduler, observations } = this.#options;
    if (activeOwner() !== source) fail(ErrorCodes.INVALID_NETWORK_REQUEST);
    let request: NetworkRequest;
    try { request = canonicalCopy(input) as unknown as NetworkRequest; } catch { return fail(ErrorCodes.INVALID_NETWORK_REQUEST); }
    if (!plain(request) || !isIdentifier(request.target) || !this.#targets.has(request.target) ||
        typeof request.endpoint !== "string" || !request.endpoint.trim() || !Object.hasOwn(request, "body") ||
        Object.keys(request).some(key => !["target", "endpoint", "body"].includes(key))) fail(ErrorCodes.INVALID_NETWORK_REQUEST);
    const selected = this.#links.get(this.#key(source, request.target));
    if (!selected) return fail(ErrorCodes.INVALID_NETWORK_REQUEST);
    let deadline: SimulationTime;
    try { deadline = addDuration(clock.now(), selected.timeout); addDuration(clock.now(), duration(selected.requestLatency + selected.jitter)); }
    catch { return fail(ErrorCodes.INVALID_NETWORK_REQUEST); }
    const operation = operations.create();
    const parent = this.#options.correlation();
    const traceId = parent?.traceId ?? this.#traces.allocate();
    const spanId = this.#spans.allocate();
    const sent = observations.record({ type: "network.request.sent", source, target: request.target, traceId, spanId,
      ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}), ...(parent?.eventId ? { eventId: parent.eventId } : {}),
      data: { requestId: operation.operationId, endpoint: request.endpoint, body: request.body, deadline } });
    const deadlineHandle = scheduler.schedule({ time: deadline, type: deadlineType, payload: { requestId: operation.operationId }, source: "simulation", target: "simulation", traceId, spanId, causationId: sent.id });
    const flight: Flight = { requestId: operation.operationId, source, target: request.target, endpoint: request.endpoint, deadline, state: "SENT",
      request, policy: selected, sentId: sent.id, traceId, spanId, ...(parent?.spanId ? { parentSpanId: parent.spanId } : {}), deadlineHandle, replied: false, settled: false };
    this.#flights.set(flight.requestId, flight);
    this.#sendLeg(flight, "request");
    return operation;
  }
  #decision(flight: Flight, leg: "request" | "response") {
    const { random, faults } = this.#options;
    const jitter = flight.policy.jitter ? Math.floor(random.draw(`network.${leg}.jitter`).unit * (flight.policy.jitter + 1)) : 0;
    const rate = flight.policy.failureRate;
    const lost = rate === 1 || (rate > 0 && random.draw(`network.${leg}.loss`).unit < rate);
    const effect = faults?.evaluate({ point: `network.${leg}`, subjectId: flight.requestId, source: flight.source, target: flight.target, name: flight.endpoint }) ?? neutral();
    if (!nonnegative(effect.extraDelay) || typeof effect.drop !== "boolean" || effect.fail || effect.additionalCopies || effect.copySpacing) fail(ErrorCodes.INVALID_FAULT);
    return { delay: jitter + effect.extraDelay, dropped: lost || effect.drop, reason: effect.drop ? "fault" : "loss" };
  }
  #observe(type: string, flight: Flight, data: CanonicalValue, eventId?: string) {
    const response = type.startsWith("network.response.");
    return this.#options.observations.record({ type, source: response ? flight.target : flight.source, target: response ? flight.source : flight.target, traceId: flight.traceId, spanId: flight.spanId,
      ...(flight.parentSpanId ? { parentSpanId: flight.parentSpanId } : {}), causationId: flight.sentId,
      ...(eventId ? { eventId } : {}), data });
  }
  #sendLeg(flight: Flight, leg: "request" | "response", reply?: NetworkReply): void {
    const result = this.#decision(flight, leg);
    if (result.dropped) { this.#observe(`network.${leg}.dropped`, flight, { requestId: flight.requestId, reason: result.reason }); return; }
    const base = leg === "request" ? flight.policy.requestLatency : flight.policy.responseLatency;
    const due = addDuration(this.#options.clock.now(), duration(base + result.delay));
    this.#options.scheduler.schedule({ time: due, type: leg === "request" ? deliveryType : responseType,
      payload: canonicalCopy(leg === "request" ? { requestId: flight.requestId } : { requestId: flight.requestId, reply: reply! }),
      source: "simulation", target: "simulation", traceId: flight.traceId, spanId: flight.spanId, causationId: flight.sentId });
  }
  #deliver(id: string, eventId: string): void {
    const flight = this.#flights.get(id)!;
    this.#observe("network.request.delivered", flight, { requestId: id, target: flight.target }, eventId);
    const receiver = this.#receivers.get(flight.target);
    flight.state = "ADMITTED";
    if (!receiver) { this.#errorReply(flight, ErrorCodes.TARGET_UNAVAILABLE); return; }
    const admission = (receiver as NetworkReceiver & { admit?: (request: Readonly<NetworkRequest>) => string | undefined }).admit?.(flight.request);
    if (admission) {
      if (admission !== ErrorCodes.TARGET_UNAVAILABLE && admission !== ErrorCodes.ENDPOINT_NOT_FOUND) fail(ErrorCodes.INVALID_NETWORK_REPLY);
      this.#errorReply(flight, admission); return;
    }
    receiver.accept(id, flight.request);
  }
  #errorReply(flight: Flight, code: string): void { this.reply(flight.requestId, { status: "error", body: { code } }); }
  reply(requestId: string, input: NetworkReply): void {
    this.#options.check();
    if (!this.#options.dispatching()) fail(ErrorCodes.INVALID_NETWORK_REPLY);
    const flight = this.#flights.get(requestId);
    if (!flight || (flight.state !== "ADMITTED" && flight.state !== "TIMED_OUT" && flight.state !== "REPLIED")) return fail(ErrorCodes.INVALID_NETWORK_REPLY);
    let reply: NetworkReply;
    try { reply = canonicalCopy(input) as unknown as NetworkReply; } catch { return fail(ErrorCodes.INVALID_NETWORK_REPLY); }
    if (!plain(reply) || (reply.status !== "ok" && reply.status !== "error") || !Object.hasOwn(reply, "body") || Object.keys(reply).some(key => !["status", "body"].includes(key))) fail(ErrorCodes.INVALID_NETWORK_REPLY);
    if (flight.replied) return;
    flight.replied = true;
    if (!flight.settled) flight.state = "REPLIED";
    this.#observe("network.response.sent", flight, { requestId, status: reply.status, body: reply.body });
    this.#sendLeg(flight, "response", reply);
  }
  #receive(id: string, reply: NetworkReply, eventId: string): void {
    const flight = this.#flights.get(id)!;
    const late = flight.settled;
    if (!late) { flight.settled = true; flight.deadlineHandle.cancel(); }
    this.#observe("network.response.received", flight, { requestId: id, status: reply.status, body: reply.body, late }, eventId);
    if (!late) this.#options.operations.complete(id, { kind: "success", value: reply as unknown as CanonicalValue });
  }
  #deadline(id: string, eventId: string): void {
    const flight = this.#flights.get(id)!;
    if (flight.settled) return;
    flight.settled = true; flight.state = "TIMED_OUT";
    this.#observe("network.request.timedout", flight, { requestId: id, deadline: flight.deadline }, eventId);
    this.#options.operations.complete(id, { kind: "failure", error: { code: ErrorCodes.NETWORK_TIMEOUT, context: { requestId: id } } });
  }
}
