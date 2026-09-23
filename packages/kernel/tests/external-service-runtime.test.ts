import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DeterministicExternalServiceRuntime, DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulation, HeadlessSimulationFactory, canonicalCopy, canonicalEncode } from "@distlab/kernel";
import type { HeadlessFactoryOptions, NetworkLinks } from "@distlab/kernel";
import { ErrorCodes, duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { CanonicalValue, ControlledTask, Observation, ObservationInput, RunInputs } from "@distlab/contracts/kernel";
import { ExternalObservationTypes } from "@distlab/contracts";
import type { ExternalAvailability, ExternalBehavior, ExternalController, ExternalOperation, FaultDecisionPort, MessageBus, NetworkReply, ProviderDecision, ServiceDefinition } from "@distlab/contracts";
import { createGolden06, golden06Result, golden06Secret } from "../examples/golden-06.ts";
import { createResponseSuppression, suppressionResult, suppressionSecret } from "../examples/response-suppression.ts";

const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };
const admitted = ExternalObservationTypes.OperationAdmitted;
const rejected = ExternalObservationTypes.OperationRejected;
const committed = ExternalObservationTypes.EffectCommitted;
const suppressed = ExternalObservationTypes.ResponseSuppressed;
const callbackScheduled = ExternalObservationTypes.CallbackScheduled;
const callbackCompleted = ExternalObservationTypes.CallbackCompleted;

function codeOf(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
}
function inputs(seed: string, visibility: RunInputs["configuration"]["visibility"] = { defaultMode: "visible", byType: {}, summaryFields: {} }): RunInputs {
  return { contractVersion: 1, modelVersions: { external: "1", service: "1" }, architecture: {}, scenario: {},
    configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility, models: {} }, seed };
}
function behavior(overrides: Partial<ExternalBehavior> = {}): ExternalBehavior {
  return { latency: duration(0), degradedExtraLatency: duration(0), dropResponse: false, parameters: null, ...overrides };
}
function echoDecision(state: CanonicalValue, parameters: CanonicalValue, callbacks: ProviderDecision["callbacks"] = []): ProviderDecision {
  return { nextState: state, reply: { status: "ok", body: { parameters } }, visibleChanges: { parameters }, callbacks };
}
function payload<T>(observation: Observation | undefined): T { return observation?.data as T; }
function like(actual: unknown, expected: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}
function requestId(observation: Observation | undefined): string { return payload<{ requestId: string }>(observation).requestId; }
type Setup = Parameters<Parameters<HeadlessSimulationFactory["createSimulation"]>[1]>[0];

function boot(seed: string, options: {
  operation: ExternalOperation;
  initialState?: CanonicalValue;
  operationName?: string;
  configure?: (controller: ExternalController) => void;
  initialAvailability?: ExternalAvailability;
  targets?: readonly string[];
  links?: NetworkLinks;
  faults?: FaultDecisionPort;
  visibility?: RunInputs["configuration"]["visibility"];
  createHistory?: HeadlessFactoryOptions["createHistory"];
  build: (setup: Setup, provider: DeterministicExternalServiceRuntime, simulation: () => HeadlessSimulation) => void;
}) {
  let provider!: DeterministicExternalServiceRuntime;
  let sim!: HeadlessSimulation;
  const network = {
    targets: [...(options.targets ?? ["billing", "provider"])],
    links: options.links ?? [{ source: "billing", target: "provider" }, { source: "provider", target: "billing" }],
    ...(options.faults ? { faults: options.faults } : {}),
  };
  sim = new HeadlessSimulationFactory({ network, ...(options.createHistory ? { createHistory: options.createHistory } : {}) }).createSimulation(
    inputs(seed, options.visibility), setup => {
      provider = new DeterministicExternalServiceRuntime({
        definition: { id: "provider", version: "1", initialState: options.initialState ?? { n: 0 }, operations: { [options.operationName ?? "authorize"]: options.operation } },
        setup, scenarioEventType: "scenario.provider", activeOwner: () => sim.activeTaskOwner, activeEvent: () => sim.activeEvent,
        ...(options.initialAvailability ? { initialAvailability: options.initialAvailability } : {}),
        ...(options.configure ? { configure: options.configure } : {}),
      });
      options.build(setup, provider, () => sim);
    });
  return { sim, provider };
}

function service(simulation: () => HeadlessSimulation, setup: Setup, id: string, handlers: Pick<ServiceDefinition, "endpoints" | "background">): DeterministicServiceRuntime {
  return new DeterministicServiceRuntime({
    id, version: "1", setup, events, taskLifecycle: () => simulation().taskLifecycle, activeOwner: () => simulation().activeTaskOwner,
    resolve: () => ({ id, version: "1", endpoints: handlers.endpoints, consumers: {}, background: handlers.background }),
  });
}
function start(setup: Setup, runtime: DeterministicServiceRuntime, at = 0): void {
  setup.schedule({ time: simulationTime(at), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
}
function call(setup: Setup, runtime: DeterministicServiceRuntime, at: number, name = "call"): void {
  setup.schedule({ time: simulationTime(at), type: runtime.backgroundEventType, payload: { name, data: null } });
}

test("configuration is versioned, identical values are no-ops, and completion uses captured inputs", async () => {
  const seen: CanonicalValue[] = [];
  let controller!: ExternalController;
  const { sim, provider } = boot("configure", {
    configure: control => {
      controller = control;
      const value = behavior({ latency: duration(10), parameters: { tier: "gold" } });
      control.configure("authorize", value);
      control.configure("authorize", behavior({ latency: duration(10), parameters: { tier: "gold" } }));
      control.setAvailability("AVAILABLE");
    },
    operation: { apply: (_body, state, parameters) => { seen.push(canonicalCopy(parameters)); return echoDecision({ n: ((state as { n: number }).n) + 1 }, parameters); } },
    build: (setup, runtime, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { order: "o1" } });
      } } });
      setup.registerHandler(runtime.scenarioEventType, "provider", event => runtime.dispatch(event, control => {
        control.configure("authorize", behavior({ parameters: { tier: "silver" } }));
      }));
      start(setup, billing);
      call(setup, billing, 1);
      setup.schedule({ time: simulationTime(50), type: runtime.scenarioEventType, payload: null });
    },
  });
  await sim.run();
  assert.equal(sim.history.query({ type: ExternalObservationTypes.BehaviorChanged }).length, 2);
  assert.equal(sim.history.query({ type: ExternalObservationTypes.AvailabilityChanged }).length, 0);
  const admission = payload<{ operation: string; completionTime: number }>(sim.history.query({ type: admitted })[0]);
  assert.equal(admission.operation, "authorize");
  assert.equal(admission.completionTime, 11);
  like(seen, [{ tier: "gold" }]);
  like((provider.inspect().visible as { parameters: CanonicalValue }).parameters, { tier: "gold" });
  assert.equal(sim.status, "COMPLETED");
  assert.equal(sim.history.query({ entity: { kind: "external", id: "provider" } }).some(item => item.type === committed), true);
  assert.throws(() => controller.configure("authorize", behavior()), (error: unknown) => codeOf(error) === ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  assert.equal(sim.status, "FAILED");
});

test("unconfigured operations default to zero latency, false drop, and null parameters", async () => {
  let parameters: CanonicalValue = "missing";
  const replies: NetworkReply[] = [];
  const { sim, provider } = boot("defaults", {
    operation: { apply: (_body, state, behaviorParameters) => { parameters = canonicalCopy(behaviorParameters); return echoDecision(state, behaviorParameters); } },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        replies.push((yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null })) as unknown as NetworkReply);
        replies.push((yield ctx.http.request({ target: "provider", endpoint: "missing", body: null })) as unknown as NetworkReply);
      } } });
      start(setup, billing);
      call(setup, billing, 1);
    },
  });
  await sim.run();
  assert.equal(parameters, null);
  assert.equal(sim.history.query({ type: ExternalObservationTypes.BehaviorChanged }).length, 0);
  like(replies[1], { status: "error", body: { code: ErrorCodes.ENDPOINT_NOT_FOUND } });
  assert.equal(provider.boundary().effectCount, 1);
  assert.equal(provider.boundary().rejectedCount, 1);
  assert.equal(provider.availability, "AVAILABLE");
});

test("same-time completions follow scheduler order against then-current state", async () => {
  const seen: number[] = [];
  const { sim } = boot("order", {
    operation: { apply: (_body, state) => {
      const current = state as { n: number };
      seen.push(current.n);
      const n = current.n + 1;
      return { nextState: { n }, reply: { status: "ok", body: { n: current.n } }, visibleChanges: { n }, callbacks: [] };
    } },
    targets: ["a", "b", "provider"],
    links: [{ source: "a", target: "provider" }, { source: "b", target: "provider" }],
    build: (setup, _provider, simulation) => {
      const handlers: Pick<ServiceDefinition, "endpoints" | "background"> = { endpoints: {}, background: { call: function* (_data, ctx) {
        yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null });
      } } };
      const a = service(simulation, setup, "a", handlers);
      const b = service(simulation, setup, "b", handlers);
      start(setup, a); start(setup, b); call(setup, a, 1); call(setup, b, 1);
    },
  });
  await sim.run();
  assert.deepEqual(seen, [0, 1]);
  assert.deepEqual(sim.history.query({ type: committed }).map(item => payload<{ visibleChanges: { n: number } }>(item).visibleChanges.n), [1, 2]);
});

test("in-flight work keeps captured availability while new arrivals follow every later state", async () => {
  const replies = new Map<string, NetworkReply>();
  const { sim, provider } = boot("availability", {
    configure: control => control.configure("authorize", behavior({ latency: duration(100), degradedExtraLatency: duration(15) })),
    operation: { apply: (_body, state) => {
      const n = (state as { n: number }).n + 1;
      return { nextState: { n }, reply: { status: "ok", body: { n } }, visibleChanges: { n }, callbacks: [] };
    } },
    targets: ["a", "b", "c", "d", "provider"],
    links: ["a", "b", "c", "d"].map(source => ({ source, target: "provider" })),
    build: (setup, runtime, simulation) => {
      const make = (id: string) => service(simulation, setup, id, { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        replies.set(id, (yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null })) as unknown as NetworkReply);
      } } });
      const a = make("a"); const b = make("b"); const c = make("c"); const d = make("d");
      setup.registerHandler(runtime.scenarioEventType, "provider", event => {
        const state = (event.payload as { state: ExternalAvailability }).state;
        runtime.dispatch(event, control => control.setAvailability(state));
      });
      for (const worker of [a, b, c, d]) start(setup, worker);
      call(setup, a, 1);
      setup.schedule({ time: simulationTime(10), type: runtime.scenarioEventType, payload: { state: "DEGRADED" } });
      call(setup, b, 20);
      setup.schedule({ time: simulationTime(30), type: runtime.scenarioEventType, payload: { state: "UNAVAILABLE" } });
      call(setup, c, 40);
      setup.schedule({ time: simulationTime(80), type: runtime.scenarioEventType, payload: { state: "RATE_LIMITED" } });
      call(setup, d, 90);
    },
  });
  await sim.run();
  const times = sim.history.query({ type: admitted }).map(item => payload<{ completionTime: number }>(item).completionTime);
  assert.deepEqual(times, [101, 135]);
  assert.equal(replies.get("a")?.status, "ok");
  assert.equal(replies.get("b")?.status, "ok");
  like(replies.get("c"), { status: "error", body: { code: ErrorCodes.EXTERNAL_UNAVAILABLE } });
  like(replies.get("d"), { status: "error", body: { code: ErrorCodes.EXTERNAL_RATE_LIMITED } });
  assert.equal(provider.boundary().effectCount, 2);
  assert.equal(provider.boundary().rejectedCount, 2);
  assert.deepEqual(sim.history.query({ type: ExternalObservationTypes.AvailabilityChanged }).map(item => payload<{ after: string }>(item).after), ["DEGRADED", "UNAVAILABLE", "RATE_LIMITED"]);
  assert.equal(provider.availability, "RATE_LIMITED");
});

test("initial rate limiting rejects before apply, including unknown operations", async () => {
  let applied = 0;
  const replies: NetworkReply[] = [];
  const { sim, provider } = boot("rate", {
    initialAvailability: "RATE_LIMITED",
    operation: { apply: () => { applied += 1; return echoDecision(null, null); } },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        replies.push((yield ctx.http.request({ target: "provider", endpoint: "missing", body: null })) as unknown as NetworkReply);
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await sim.run();
  assert.equal(applied, 0);
  like(replies, [{ status: "error", body: { code: ErrorCodes.EXTERNAL_RATE_LIMITED } }]);
  assert.equal(provider.boundary().effectCount, 0);
  assert.equal(payload<{ before: string; after: string }>(sim.history.query({ type: ExternalObservationTypes.AvailabilityChanged })[0]).before, "AVAILABLE");
});

test("later dropResponse does not suppress an admission that captured a reply", async () => {
  const replies: string[] = [];
  const { sim, provider } = boot("capture-drop", {
    configure: control => control.configure("authorize", behavior({ latency: duration(30) })),
    operation: { apply: (body, state) => ({ nextState: state, reply: { status: "ok" as const, body }, visibleChanges: { ok: true }, callbacks: [] }) },
    targets: ["billing", "other", "provider"],
    links: [{ source: "billing", target: "provider" }, { source: "other", target: "provider" }],
    build: (setup, runtime, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        try { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { from: "billing" } }); replies.push("reply"); }
        catch (error) { replies.push(codeOf(error)); }
      } } });
      const other = service(simulation, setup, "other", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        try { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { from: "other" } }); replies.push("reply"); }
        catch (error) { replies.push(codeOf(error)); }
      } } });
      setup.registerHandler(runtime.scenarioEventType, "provider", event => runtime.dispatch(event, control => {
        control.configure("authorize", behavior({ dropResponse: true }));
      }));
      start(setup, billing); start(setup, other);
      call(setup, billing, 1);
      setup.schedule({ time: simulationTime(10), type: runtime.scenarioEventType, payload: null });
      call(setup, other, 40);
    },
  });
  await sim.run();
  assert.deepEqual(replies, ["reply", ErrorCodes.NETWORK_TIMEOUT]);
  assert.equal(provider.boundary().effectCount, 2);
  assert.equal(provider.boundary().suppressedCount, 1);
  const authorize = sim.history.query({ type: "network.request.sent" });
  const first = requestId(authorize[0]);
  const second = requestId(authorize[1]);
  assert.equal(sim.history.query({ type: "network.response.sent" }).some(item => requestId(item) === first), true);
  assert.equal(sim.history.query({ type: suppressed }).some(item => requestId(item) === first), false);
  assert.equal(sim.history.query({ type: suppressed }).some(item => requestId(item) === second), true);
});

test("duplicate callbacks keep one effect, distinct request ids, and one stable business id", async () => {
  const callbacks: CanonicalValue[] = [];
  const { sim, provider } = boot("callbacks", {
    operation: { apply: (_body, _state) => ({
      nextState: { authorized: true }, reply: { status: "ok" as const, body: { ok: true } }, visibleChanges: { authorizationCount: 1 },
      callbacks: [
        { after: duration(100), request: { target: "billing", endpoint: "POST /callback", body: { eventId: "e1", n: 1 } } },
        { after: duration(200), request: { target: "billing", endpoint: "POST /callback", body: { eventId: "e1", n: 2 } } },
      ],
    }) },
    build: (setup, runtime, simulation) => {
      const billing = service(simulation, setup, "billing", {
        endpoints: { "POST /callback": body => { callbacks.push(canonicalCopy(body)); return { status: "ok", body: { received: true } }; } },
        background: { call: function* (_data, ctx): ControlledTask { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { orderId: "o1" } }); } },
      });
      setup.registerHandler(runtime.scenarioEventType, "provider", event => runtime.dispatch(event, control => control.setAvailability("UNAVAILABLE")));
      start(setup, billing); call(setup, billing, 1);
      setup.schedule({ time: simulationTime(10), type: runtime.scenarioEventType, payload: null });
    },
  });
  await sim.run();
  like(callbacks, [{ eventId: "e1", n: 1 }, { eventId: "e1", n: 2 }]);
  assert.equal(provider.boundary().effectCount, 1);
  assert.equal(provider.boundary().scheduledCallbackCount, 2);
  assert.equal(provider.availability, "UNAVAILABLE");
  const sent = sim.history.query({ type: "network.request.sent" });
  const origin = sent[0]!;
  const children = sent.slice(1);
  assert.equal(children.length, 2);
  assert.equal(payload<{ endpoint: string }>(children[0]).endpoint, "POST /callback");
  assert.notEqual(requestId(children[0]), requestId(children[1]));
  assert.equal(children[0]?.traceId, origin.traceId);
  assert.equal(children[0]?.parentSpanId, origin.spanId);
  assert.equal(children[1]?.parentSpanId, origin.spanId);
  assert.deepEqual(sim.history.query({ type: callbackScheduled }).map(item => payload<{ ordinal: number; target: string }>(item).ordinal), [0, 1]);
  assert.deepEqual(sim.history.query({ type: callbackCompleted }).map(item => payload<{ outcome: string }>(item).outcome), ["reply", "reply"]);
});

test("a callback timeout records local failure and does not roll back or retry the effect", async () => {
  const { sim, provider } = boot("callback-timeout", {
    links: [{ source: "billing", target: "provider" }, { source: "provider", target: "billing", policy: { timeout: duration(15) } }],
    operation: { apply: (_body, state) => ({
      nextState: { n: (state as { n: number }).n + 1 }, reply: { status: "ok" as const, body: { ok: true } }, visibleChanges: { authorizationCount: 1 },
      callbacks: [{ after: duration(0), request: { target: "billing", endpoint: "POST /callback", body: { eventId: "e1" } } }],
    }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", {
        endpoints: { "POST /callback": function* (_body, ctx) { yield ctx.clock.sleep(duration(100)); return { status: "ok" as const, body: null }; } },
        background: { call: function* (_data, ctx): ControlledTask { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null }); } },
      });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await sim.run();
  assert.equal(provider.boundary().effectCount, 1);
  assert.equal(provider.boundary().callbackTimeoutCount, 1);
  like(provider.inspect().visible, { authorizationCount: 1 });
  assert.equal(sim.history.query({ type: "network.request.sent" }).filter(item => item.source === "provider").length, 1);
  assert.equal(payload<{ outcome: string }>(sim.history.query({ type: callbackCompleted })[0]).outcome, "timeout");
  assert.equal(sim.history.query({ type: "network.response.received" }).some(item => payload<{ late: boolean }>(item).late), true);
});

test("network response loss and a late reply both time out the caller without erasing the effect", async () => {
  const loss = boot("loss", {
    faults: { evaluate: probe => ({ ruleIds: [], extraDelay: duration(0), drop: probe.point === "network.response", additionalCopies: 0, copySpacing: duration(0), fail: false }) },
    operation: { apply: (_body, state) => ({ nextState: { n: 1 }, reply: { status: "ok" as const, body: { approved: true } }, visibleChanges: { authorizationCount: (state as { n: number }).n + 1 }, callbacks: [] }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        try { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null }); }
        catch (error) { assert.equal(codeOf(error), ErrorCodes.NETWORK_TIMEOUT); }
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await loss.sim.run();
  assert.equal(loss.provider.boundary().effectCount, 1);
  assert.equal(loss.provider.boundary().suppressedCount, 0);
  assert.equal(loss.sim.history.query({ type: "network.response.sent" }).length, 1);
  assert.equal(loss.sim.history.query({ type: "network.response.dropped" }).length, 1);
  assert.equal(loss.sim.history.query({ type: suppressed }).length, 0);

  let caller = "";
  const late = boot("late", {
    links: [{ source: "billing", target: "provider", policy: { timeout: duration(5) } }],
    configure: control => control.configure("authorize", behavior({ latency: duration(40) })),
    operation: { apply: (body, state) => ({ nextState: state, reply: { status: "ok" as const, body }, visibleChanges: { ok: true }, callbacks: [] }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        try { yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { wait: true } }); caller = "reply"; }
        catch (error) { caller = codeOf(error); }
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await late.sim.run();
  assert.equal(caller, ErrorCodes.NETWORK_TIMEOUT);
  assert.equal(late.provider.boundary().effectCount, 1);
  assert.equal(late.sim.history.query({ type: committed })[0]?.time, 41);
  assert.equal(late.sim.history.query({ type: "network.response.received" }).some(item => payload<{ late: boolean }>(item).late), true);
});

test("callers cannot see private state, and a sink failure keeps the committed effect", async () => {
  const secret = "provider-private-ledger";
  const hidden = boot("redacted", {
    initialState: { secret, n: 0 },
    visibility: { defaultMode: "visible", byType: { [committed]: "redacted" }, summaryFields: {} },
    operation: { apply: (_body, state) => ({
      nextState: { secret: (state as { secret: string }).secret, n: 1 },
      reply: { status: "ok" as const, body: { approved: true } }, visibleChanges: { authorizationCount: 1 }, callbacks: [],
    }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        const reply = (yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null })) as unknown as NetworkReply;
        assert.equal(JSON.stringify(reply).includes(secret), false);
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await hidden.sim.run();
  like(hidden.provider.inspect(), { availability: "AVAILABLE", visible: { authorizationCount: 1 } });
  assert.equal(JSON.stringify(hidden.provider.boundary()).includes(secret), false);
  assert.equal(JSON.stringify(hidden.sim.history.export()).includes(secret), false);
  assert.deepEqual(payload<CanonicalValue>(hidden.sim.history.query({ type: committed })[0]), { redacted: true });

  class FlakyHistory extends ExecutionHistory {
    override record<T extends CanonicalValue>(input: ObservationInput<T>): Readonly<Observation> {
      if (input.type === committed) throw Object.assign(new Error(ErrorCodes.HISTORY_LIMIT_EXCEEDED), { code: ErrorCodes.HISTORY_LIMIT_EXCEEDED, context: { type: input.type } });
      return super.record(input);
    }
  }
  const failed = boot("sink", {
    initialState: { secret, n: 0 },
    createHistory: options => new FlakyHistory(options),
    operation: { apply: () => ({ nextState: { secret, n: 1 }, reply: { status: "ok" as const, body: { approved: true } }, visibleChanges: { authorizationCount: 1 }, callbacks: [] }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null });
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await assert.rejects(failed.sim.run(), (error: unknown) => codeOf(error) === ErrorCodes.HISTORY_LIMIT_EXCEEDED);
  assert.equal(failed.provider.boundary().effectCount, 1);
  like(failed.provider.inspect().visible, { authorizationCount: 1 });
  assert.equal(JSON.stringify(failed.sim.history.export()).includes(secret), false);
  assert.equal(failed.sim.history.export().terminalFailure?.historyComplete, false);
});

test("invalid configuration and invalid decisions terminate before provider state changes", async () => {
  assert.throws(() => new HeadlessSimulationFactory({ network: { targets: ["provider"], links: [] } }).createSimulation(inputs("bad-definition"), setup => {
    new DeterministicExternalServiceRuntime({
      definition: { id: "provider", version: " ", operations: {}, initialState: null },
      setup, scenarioEventType: "scenario.provider", activeOwner: () => undefined, activeEvent: () => undefined,
    });
  }), (error: unknown) => codeOf(error) === ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);

  const { sim, provider } = boot("bad-decision", {
    initialState: { n: 0 },
    operation: { apply: () => ({ nextState: { secret: "decision-secret", n: 9 }, reply: { status: "ok" as const, body: null }, visibleChanges: { n: 9 } }) as unknown as ProviderDecision },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null });
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await assert.rejects(sim.run(), (error: unknown) => codeOf(error) === ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  assert.equal(provider.boundary().effectCount, 0);
  assert.equal(provider.inspect().visible, null);
  assert.equal(JSON.stringify(sim.history.export()).includes("decision-secret"), false);

  const invalid = boot("bad-configure", {
    configure: control => control.configure("authorize", behavior({ latency: duration(5) })),
    operation: { apply: (_body, state) => echoDecision(state, null) },
    build: (setup, runtime, simulation) => {
      setup.registerHandler(runtime.scenarioEventType, "provider", event => runtime.dispatch(event, control => {
        control.configure("missing", behavior());
      }));
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: {} });
      start(setup, billing);
      setup.schedule({ time: simulationTime(1), type: runtime.scenarioEventType, payload: null });
    },
  });
  await assert.rejects(invalid.sim.run(), (error: unknown) => codeOf(error) === ErrorCodes.INVALID_EXTERNAL_CONFIGURATION);
  const changes = invalid.sim.history.query({ type: ExternalObservationTypes.BehaviorChanged });
  assert.equal(changes.length, 1);
  assert.equal(payload<{ after: { latency: number } }>(changes[0]).after.latency, 5);
});

test("a business error reply commits the effect and still answers the caller", async () => {
  const replies: NetworkReply[] = [];
  const { sim, provider } = boot("business-error", {
    operation: { apply: (_body, state) => ({
      nextState: { n: (state as { n: number }).n + 1 },
      reply: { status: "error" as const, body: { code: "DECLINED" } },
      visibleChanges: { authorizationCount: 1 },
      callbacks: [],
    }) },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        replies.push((yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null })) as unknown as NetworkReply);
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await sim.run();
  like(replies, [{ status: "error", body: { code: "DECLINED" } }]);
  assert.equal(provider.boundary().effectCount, 1);
  like(provider.inspect().visible, { authorizationCount: 1 });
  assert.equal(sim.history.query({ type: "network.request.timedout" }).length, 0);
});

test("idempotent catalog behavior is operation state, not a runtime guarantee", async () => {
  const remember = boot("idempotent", {
    initialState: { entries: {} },
    operationName: "remember",
    operation: { apply: (body, state) => {
      const key = (body as { key: string }).key;
      const entries = (state as { entries: { readonly [key: string]: CanonicalValue } }).entries;
      if (Object.hasOwn(entries, key)) {
        return { nextState: { entries }, reply: { status: "ok" as const, body: entries[key] ?? null }, visibleChanges: { hits: Object.keys(entries).length, duplicate: true }, callbacks: [] };
      }
      const result = { authorizationId: `auth-${key}` };
      return { nextState: { entries: { ...entries, [key]: result } }, reply: { status: "ok", body: result }, visibleChanges: { hits: Object.keys(entries).length + 1, duplicate: false }, callbacks: [] };
    } },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        yield ctx.http.request({ target: "provider", endpoint: "remember", body: { key: "k1" } });
        yield ctx.http.request({ target: "provider", endpoint: "remember", body: { key: "k1" } });
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await remember.sim.run();
  like(remember.provider.inspect().visible, { hits: 1, duplicate: true });
  const charge = boot("charge", {
    operationName: "charge",
    operation: { apply: (_body, state) => {
      const charges = (state as { n: number }).n + 1;
      return { nextState: { n: charges }, reply: { status: "ok" as const, body: { charges } }, visibleChanges: { charges }, callbacks: [] };
    } },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        yield ctx.http.request({ target: "provider", endpoint: "charge", body: null });
        yield ctx.http.request({ target: "provider", endpoint: "charge", body: null });
      } } });
      start(setup, billing); call(setup, billing, 1);
    },
  });
  await charge.sim.run();
  like(charge.provider.inspect().visible, { charges: 2 });
});

test("service restart keeps provider effects and reset revokes the old controller", async () => {
  const replies: NetworkReply[] = [];
  let stale: ExternalController | undefined;
  const { sim, provider } = boot("restart", {
    configure: control => { stale ??= control; },
    operation: { apply: (_body, state) => {
      const n = (state as { n: number }).n + 1;
      return { nextState: { n }, reply: { status: "ok" as const, body: { n } }, visibleChanges: { n }, callbacks: [] };
    } },
    build: (setup, _provider, simulation) => {
      const billing = service(simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
        replies.push((yield ctx.http.request({ target: "provider", endpoint: "authorize", body: null })) as unknown as NetworkReply);
      } } });
      start(setup, billing);
      call(setup, billing, 1);
      setup.schedule({ time: simulationTime(5), type: billing.lifecycleEventType, payload: { next: "CRASHED" } });
      setup.schedule({ time: simulationTime(6), type: billing.lifecycleEventType, payload: { next: "STARTING" } });
      setup.schedule({ time: simulationTime(7), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
      call(setup, billing, 8);
    },
  });
  await sim.run();
  like(replies.map(reply => reply.body), [{ n: 1 }, { n: 2 }]);
  assert.equal(provider.boundary().effectCount, 2);
  await sim.reset();
  assert.throws(() => stale?.configure("authorize", behavior()), (error: unknown) => codeOf(error) === ErrorCodes.STALE_CAPABILITY);
  replies.length = 0;
  await sim.run();
  assert.equal(sim.status, "COMPLETED");
  like(replies.map(reply => reply.body), [{ n: 1 }, { n: 2 }]);
});

test("two providers register external schemas once", async () => {
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["billing", "alpha", "beta"], links: [
    { source: "billing", target: "alpha" }, { source: "billing", target: "beta" },
  ] } }).createSimulation(inputs("two-providers"), setup => {
    for (const id of ["alpha", "beta"]) {
      new DeterministicExternalServiceRuntime({
        definition: { id, version: "1", initialState: null, operations: { ping: { apply: (_body, state) => echoDecision(state, id) } } },
        setup, scenarioEventType: `scenario.${id}`, activeOwner: () => simulation.activeTaskOwner, activeEvent: () => simulation.activeEvent,
      });
    }
    const billing = service(() => simulation, setup, "billing", { endpoints: {}, background: { call: function* (_data, ctx): ControlledTask {
      yield ctx.http.request({ target: "alpha", endpoint: "ping", body: null });
      yield ctx.http.request({ target: "beta", endpoint: "ping", body: null });
    } } });
    start(setup, billing); call(setup, billing, 1);
  });
  await simulation.run();
  assert.equal(simulation.status, "COMPLETED");
  assert.equal(simulation.history.query({ type: committed }).length, 2);
});

test("response suppression commits the provider effect and times out the caller", async () => {
  const fixture = createResponseSuppression();
  const again = createResponseSuppression();
  await fixture.simulation.run();
  await again.simulation.run();
  const result = suppressionResult(fixture);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.state.caller, ErrorCodes.NETWORK_TIMEOUT);
  assert.equal(result.state.effectCount, 1);
  assert.equal(result.state.suppressedCount, 1);
  assert.equal(result.state.authorizationCount, 1);
  assert.equal(result.state.callbackEventId, "e1");
  assert.equal(result.time, 1001);
  assert.equal(JSON.stringify(result.history).includes(suppressionSecret), false);
  const authorize = result.history.observations.filter(item => item.type === "network.request.sent" && payload<{ endpoint: string }>(item).endpoint === "authorize");
  assert.equal(authorize.length, 1);
  const id = requestId(authorize[0]);
  assert.equal(result.history.observations.some(item => item.type === "network.response.sent" && requestId(item) === id), false);
  assert.equal(result.history.observations.some(item => item.type === "network.request.timedout" && requestId(item) === id), true);
  assert.equal(result.history.observations.some(item => item.type === suppressed && requestId(item) === id), true);
  assert.equal(result.history.observations.some(item => item.type === committed), true);
  assert.deepEqual(suppressionResult(again), result);
  await fixture.simulation.reset();
  await fixture.simulation.run();
  assert.deepEqual(suppressionResult(fixture), result);
});

test("golden 06 correlates a service call, provider effect, and callback across reset", async () => {
  const fixture = createGolden06();
  const fresh = createGolden06();
  await fixture.simulation.run();
  await fresh.simulation.run();
  const result = golden06Result(fixture);
  assert.equal(result.status, "COMPLETED");
  like(result.state, { authorizationId: "auth-o1", status: "approved", callbackEventId: "e1", authorizationCount: 1, availability: "AVAILABLE" });
  assert.equal(JSON.stringify(result.history).includes(golden06Secret), false);
  const sent = result.history.observations.filter(item => item.type === "network.request.sent");
  const authorize = sent.find(item => payload<{ endpoint: string }>(item).endpoint === "authorize");
  const callback = sent.find(item => payload<{ endpoint: string }>(item).endpoint === "POST /provider-callback");
  assert.equal(callback?.traceId, authorize?.traceId);
  assert.equal(callback?.parentSpanId, authorize?.spanId);
  assert.notEqual(requestId(authorize), requestId(callback));
  assert.equal(payload<{ body: { eventId: string } }>(callback).body.eventId, "e1");
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-06.expected.json", import.meta.url), "utf8")) as { digest: string; state: typeof result.state; observationCount: number };
  assert.equal(result.digest, expected.digest);
  assert.equal(canonicalEncode(canonicalCopy(result.state)), canonicalEncode(canonicalCopy(expected.state)));
  assert.equal(result.history.observations.length, expected.observationCount);
  assert.deepEqual(golden06Result(fresh), result);
  await fixture.simulation.reset();
  await fixture.simulation.run();
  assert.deepEqual(golden06Result(fixture), result);
});

test("golden 06 and response suppression are executable headlessly", () => {
  for (const name of ["golden-06.ts", "response-suppression.ts"]) {
    const script = fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8" })) as { status: string; state: { authorizationCount: number }; history: { terminalFailure?: unknown } };
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.state.authorizationCount, 1);
    assert.equal(result.history.terminalFailure, undefined);
  }
});
