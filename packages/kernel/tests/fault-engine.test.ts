import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicDatabase, DeterministicExternalServiceRuntime, DeterministicFaultEngine, DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulationFactory } from "@distlab/kernel";
import { duration, ErrorCodes, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { FaultProbe, FaultRule, ScheduledFault } from "@distlab/contracts";
import type { CanonicalValue, ControlledTask, ObservationInput, RandomDraw, RunInputs } from "@distlab/contracts/kernel";
import type { MessageBus } from "@distlab/contracts";

const probe = (subjectId: string, point: FaultProbe["point"] = "message.delivery"): FaultProbe => ({ point, subjectId, source: "a", target: "b", name: "jobs" });
const rule = (id: string, extra: Partial<FaultRule> = {}): FaultRule => ({ id, point: "message.delivery", from: simulationTime(0), probability: 1,
  maxApplications: 1, effect: { kind: "drop" }, ...extra });
const code = (error: unknown): string => (error as { code: string }).code;

function fixture(rules: readonly FaultRule[], units: number[] = []) {
  const records: ObservationInput[] = [];
  const schemas = new Map<string, (data: CanonicalValue | undefined) => boolean>();
  let time = simulationTime(0), draws = 0;
  const effects: string[] = [];
  const engine = new DeterministicFaultEngine({ rules, components: ["a", "b", "provider"], clock: { now: () => time },
    random: { draw: () => ({ index: draws, unit: units[draws++] ?? 0, uint32: 0, algorithm: "xoshiro128ss-splitmix32-v1" }) as RandomDraw },
    observations: { registerSchema: (type, validate) => { schemas.set(type, validate); }, record: input => {
      if (!schemas.get(input.type)?.(input.data)) throw new Error("schema");
      records.push(input); return input as never;
    } }, crash: { a: () => { effects.push("crash"); } }, externalAvailability: { provider: state => { effects.push(state); } } });
  return { engine, records, effects, draws: () => draws, time: (next: number) => { time = simulationTime(next); } };
}

test("selectors, windows, occurrence and budget are exact", () => {
  const f = fixture([rule("one", { source: "a", target: "b", name: "jobs", from: simulationTime(2), until: simulationTime(5), occurrence: 2, maxApplications: 2 })]);
  assert.deepEqual(f.engine.evaluate(probe("before")).ruleIds, []);
  f.time(2);
  assert.deepEqual(f.engine.evaluate({ ...probe("wrong"), name: "other" }).ruleIds, []);
  assert.deepEqual(f.engine.evaluate(probe("first")).ruleIds, []);
  assert.deepEqual(f.engine.evaluate(probe("second")).ruleIds, ["one"]);
  assert.deepEqual(f.engine.evaluate(probe("third")).ruleIds, []);
  f.time(5);
  assert.deepEqual(f.engine.evaluate(probe("after")).ruleIds, []);
  assert.deepEqual(f.engine.inspect().rules, [{ id: "one", candidates: 3, applications: 1 }]);
  assert.equal(f.draws(), 0);
});

test("construction rejects invalid IDs, windows, probability, budgets and point effects", () => {
  const invalid: readonly FaultRule[][] = [
    [rule("same"), rule("same")],
    [rule("time", { from: simulationTime(2), until: simulationTime(2) })],
    [rule("probability", { probability: 1.1 })],
    [rule("budget", { maxApplications: 0 })],
    [rule("occurrence", { occurrence: 0 })],
    [rule("foreign", { target: "missing" })],
    [rule("fail", { effect: { kind: "fail" } })],
    [rule("copy", { effect: { kind: "duplicate", additionalCopies: 17, spacing: duration(0) } })],
    [rule("db", { point: "database.commit", effect: { kind: "drop" } })],
  ];
  for (const rules of invalid) assert.throws(() => fixture(rules), error => code(error) === "INVALID_FAULT");
  const empty = fixture([]).engine.evaluate(probe("empty"));
  assert.deepEqual(empty, { ruleIds: [], extraDelay: 0, drop: false, additionalCopies: 0, copySpacing: 0, fail: false });
  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(empty.ruleIds), true);
});

test("draws occur only for eligible intermediate probabilities and compose in order", () => {
  const f = fixture([
    rule("zero", { probability: 0 }),
    rule("fail-once", { probability: 0.5, occurrence: 1 }),
    rule("delay", { probability: 1, maxApplications: 2, effect: { kind: "delay", duration: duration(3) } }),
    rule("drop", { probability: 0.5, maxApplications: 1 }),
  ], [0.9, 0.1]);
  assert.deepEqual(f.engine.evaluate(probe("p1")), { ruleIds: ["delay", "drop"], extraDelay: 3, drop: true, additionalCopies: 0, copySpacing: 0, fail: false });
  assert.deepEqual(f.engine.evaluate(probe("p2")).ruleIds, ["delay"]);
  assert.deepEqual(f.engine.evaluate(probe("p3")).ruleIds, []);
  assert.equal(f.draws(), 2);
  assert.deepEqual(f.engine.inspect().rules.map(r => r.applications), [0, 0, 2, 1]);
  assert.equal(f.records.filter(r => r.type === "fault.rule.matched").length, 7);
  assert.equal(f.records.filter(r => r.type === "fault.effect.selected").length, 3);
});

test("disconnect is request-only, drop suppresses copies, and overlapping duplicates fail", () => {
  assert.throws(() => fixture([rule("bad", { effect: { kind: "disconnect" } })]), error => code(error) === "INVALID_FAULT");
  assert.throws(() => fixture([rule("a", { effect: { kind: "duplicate", additionalCopies: 1, spacing: duration(1) } }),
    rule("b", { effect: { kind: "duplicate", additionalCopies: 1, spacing: duration(0) } })]), error => code(error) === "INVALID_FAULT");
  const f = fixture([rule("copy", { effect: { kind: "duplicate", additionalCopies: 2, spacing: duration(4) } }), rule("drop")]);
  assert.deepEqual(f.engine.evaluate(probe("x")), { ruleIds: ["copy", "drop"], extraDelay: 0, drop: true, additionalCopies: 0, copySpacing: 0, fail: false });
  const network = fixture([rule("disconnect", { point: "network.request", effect: { kind: "disconnect" } })]);
  assert.equal(network.engine.evaluate(probe("request", "network.request")).drop, true);
  assert.equal(network.engine.evaluate(probe("response", "network.response")).drop, false);
});

test("invalid and reused probes, overflow, immutable input and stale ports", () => {
  const input = rule("delay", { effect: { kind: "delay", duration: duration(1) }, maxApplications: 2 });
  const f = fixture([input]);
  (input.effect as { duration: number }).duration = 99;
  const port = f.engine.decisionPort();
  assert.equal(port.evaluate(probe("x")).extraDelay, 1);
  assert.throws(() => port.evaluate(probe("x")), error => code(error) === "FAULT_PROBE_REUSED");
  assert.throws(() => f.engine.evaluate({ ...probe("bad"), source: "foreign" }), error => code(error) === "INVALID_FAULT");
  f.engine.reset();
  assert.throws(() => port.evaluate(probe("y")), error => code(error) === "STALE_CAPABILITY");
  assert.equal(f.engine.evaluate(probe("x")).extraDelay, 1);
  const overflow = fixture([rule("a", { effect: { kind: "delay", duration: duration(Number.MAX_SAFE_INTEGER) } }), rule("b", { effect: { kind: "delay", duration: duration(1) } })]);
  assert.throws(() => overflow.engine.evaluate(probe("x")), error => code(error) === "TIME_OVERFLOW");
});

test("scheduled transitions are idempotent and recorded only after success", () => {
  const f = fixture([]), controller = f.engine.controller();
  const crash: ScheduledFault = { id: "c", kind: "crash", target: "a" };
  controller.apply(crash); controller.apply(crash);
  controller.apply({ id: "p", kind: "external-availability", target: "provider", state: "UNAVAILABLE" });
  assert.deepEqual(f.effects, ["crash", "UNAVAILABLE"]);
  assert.equal(f.records.filter(r => r.type === "fault.applied").length, 2);
  assert.throws(() => controller.apply({ id: "bad", kind: "crash", target: "provider" }), error => code(error) === "INVALID_FAULT");
  f.engine.reset();
  assert.throws(() => controller.apply(crash), error => code(error) === "STALE_CAPABILITY");
  f.engine.apply(crash);
  assert.deepEqual(f.effects, ["crash", "UNAVAILABLE", "crash"]);
});

test("scheduled fault ports crash a service and change provider availability in owner events", async () => {
  const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {},
    configuration: { startTime: simulationTime(0), historyLimit: 500, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "fault-lifecycle" };
  let service!: DeterministicServiceRuntime, provider!: DeterministicExternalServiceRuntime, engine!: DeterministicFaultEngine;
  const events: MessageBus = { publish: () => { throw new Error("unused"); } };
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "provider"], links: [] } }).createSimulation(inputs, setup => {
    service = new DeterministicServiceRuntime({ id: "service", version: "1", setup, events, activeEvent: () => sim.activeEvent,
      activeOwner: () => sim.activeTaskOwner, taskLifecycle: () => sim.taskLifecycle,
      resolve: () => ({ id: "service", version: "1", endpoints: {}, consumers: {}, background: {} }) });
    provider = new DeterministicExternalServiceRuntime({ definition: { id: "provider", version: "1", initialState: {}, operations: {} },
      setup, scenarioEventType: "scenario.provider-fault", activeOwner: () => sim.activeTaskOwner, activeEvent: () => sim.activeEvent });
    engine = new DeterministicFaultEngine({ rules: [], components: ["service", "provider"], clock: { now: () => sim.time },
      random: { draw: label => sim.random.draw(label) },
      observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
      activeEvent: () => sim.activeEvent,
      crash: { service: () => service.crash(sim.activeEvent!) },
      externalAvailability: { provider: state => provider.dispatch(sim.activeEvent!, controller => controller.setAvailability(state)) } });
    setup.registerHandler("scenario.service-fault", "service", () => engine.apply({ id: "crash-service", kind: "crash", target: "service" }));
    setup.registerHandler("scenario.provider-fault", "provider", () => engine.apply({ id: "disable-provider", kind: "external-availability", target: "provider", state: "UNAVAILABLE" }));
    setup.schedule({ time: simulationTime(0), type: service.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "scenario.service-fault", payload: null });
    setup.schedule({ time: simulationTime(2), type: "scenario.provider-fault", payload: null });
  });
  await sim.run();
  assert.equal(sim.status, "COMPLETED");
  assert.equal(service.state, "CRASHED");
  assert.equal(provider.availability, "UNAVAILABLE");
  const types = sim.history.all().map(x => x.type);
  assert.ok(types.indexOf("service.lifecycle.changed", types.indexOf("service.lifecycle.changed") + 1) < types.indexOf("fault.applied"));
  assert.ok(types.indexOf("external.availability.changed") < types.lastIndexOf("fault.applied"));
});

test("database commit failure selected by a real rule closes without changing committed state", async () => {
  const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {},
    configuration: { startTime: simulationTime(0), historyLimit: 500, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "fault-database" };
  let db!: DeterministicDatabase, engine!: DeterministicFaultEngine, outcome = "";
  const events: MessageBus = { publish: () => { throw new Error("unused"); } };
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    engine = new DeterministicFaultEngine({ rules: [rule("fail-first-commit", { point: "database.commit", source: "service", target: "service", name: "service", effect: { kind: "fail" } })],
      components: ["service"], clock: { now: () => sim.time }, random: { draw: label => sim.random.draw(label) },
      observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
      activeEvent: () => sim.activeEvent });
    db = new DeterministicDatabase({ definition: { owner: "service", tables: [{ name: "items", unique: [], checks: [] }], initial: { items: {} } }, checks: {},
      setup, clock: { now: () => sim.time }, schedule: (type, payload) => sim.scheduleStorage(type, payload),
      operations: { create: () => sim.operations.create(), complete: (id, result) => sim.operations.complete(id, result) },
      observations: { record: input => sim.storageObservations.record(input) }, task: () => sim.activeTaskIdentity,
      event: () => sim.activeTaskEvent, faults: engine.decisionPort() });
    const service = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db, events,
      activeOwner: () => sim.activeTaskOwner, taskLifecycle: () => sim.taskLifecycle,
      resolve: () => ({ id: "service", version: "1", endpoints: {}, consumers: {}, background: { write: function* (_, ctx): ControlledTask {
        const tx = ctx.db!.begin(); tx.insert("items", "a", { value: 1 });
        try { yield tx.commit(); outcome = "ok"; } catch (error) { outcome = code(error); }
      } } }) });
    setup.schedule({ time: simulationTime(0), type: service.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: service.backgroundEventType, payload: { name: "write", data: null } });
  });
  await sim.run();
  assert.equal(sim.status, "COMPLETED");
  assert.equal(outcome, "COMMIT_FAILED");
  assert.equal(db.revision, 0);
  assert.deepEqual(Object.keys(db.inspect().tables.items!), []);
  assert.equal(sim.history.query({ type: "fault.effect.selected" }).length, 1);
  assert.equal(sim.history.query({ type: "database.transaction.rejected" }).length, 1);
});

test("request delay survives a later scoped disconnection", async () => {
  const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {},
    configuration: { startTime: simulationTime(0), historyLimit: 500, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "fault-network" };
  let engine!: DeterministicFaultEngine, delivered = 0;
  const outcomes: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["a", "b"], links: [{ source: "a", target: "b", policy: { timeout: duration(6) } }],
    faults: { evaluate: probe => engine.evaluate(probe) } } }).createSimulation(inputs, setup => {
    engine = new DeterministicFaultEngine({ rules: [
      rule("delay-first", { point: "network.request", occurrence: 1, effect: { kind: "delay", duration: duration(3) } }),
      rule("disconnect-second", { point: "network.request", occurrence: 2, effect: { kind: "disconnect" } }),
    ], components: ["a", "b"], clock: { now: () => sim.time }, random: { draw: label => sim.random.draw(label) },
    observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
    activeEvent: () => sim.activeEvent });
    const client = setup.networkFor("a"), controller = setup.networkController();
    controller.register("b", { accept: requestId => { delivered++; controller.reply(requestId, { status: "ok", body: "done" }); } });
    setup.registerHandler("scenario.request", "a", function* (): ControlledTask {
      try { yield client.request({ target: "b", endpoint: "jobs", body: null }); outcomes.push("ok"); }
      catch (error) { outcomes.push(code(error)); }
    });
    setup.schedule({ time: simulationTime(0), type: "scenario.request", payload: null });
    setup.schedule({ time: simulationTime(1), type: "scenario.request", payload: null });
  });
  await sim.run();
  assert.equal(sim.status, "COMPLETED");
  assert.equal(delivered, 1);
  assert.deepEqual(outcomes, ["ok", "NETWORK_TIMEOUT"]);
  assert.equal(sim.history.query({ type: "network.request.delivered" })[0]!.time, 3);
  assert.equal(sim.history.query({ type: "network.request.dropped" })[0]!.time, 1);
});

test("fault observation sink failure seals execution before network delivery", async () => {
  const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {},
    configuration: { startTime: simulationTime(0), historyLimit: 500, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "fault-sink" };
  let engine!: DeterministicFaultEngine, delivered = 0;
  class FaultSink extends ExecutionHistory {
    override record<T extends CanonicalValue>(input: ObservationInput<T>) {
      if (input.type === "fault.effect.selected") throwSimulationError(ErrorCodes.HISTORY_LIMIT_EXCEEDED);
      return super.record(input);
    }
  }
  const sim = new HeadlessSimulationFactory({ createHistory: options => new FaultSink(options), network: {
    targets: ["a", "b"], links: [{ source: "a", target: "b" }], faults: { evaluate: probe => engine.evaluate(probe) },
  } }).createSimulation(inputs, setup => {
    engine = new DeterministicFaultEngine({ rules: [rule("drop", { point: "network.request" })], components: ["a", "b"],
      clock: { now: () => sim.time }, random: { draw: label => sim.random.draw(label) },
      observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
      activeEvent: () => sim.activeEvent });
    setup.networkController().register("b", { accept: () => { delivered++; } });
    const client = setup.networkFor("a");
    setup.registerHandler("scenario.request", "a", function* (): ControlledTask { yield client.request({ target: "b", endpoint: "jobs", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "scenario.request", payload: null });
  });
  await assert.rejects(sim.run(), error => code(error) === ErrorCodes.HISTORY_LIMIT_EXCEEDED);
  assert.equal(sim.status, "FAILED");
  assert.equal(delivered, 0);
  assert.equal(sim.history.export().terminalFailure?.code, ErrorCodes.HISTORY_LIMIT_EXCEEDED);
  assert.equal(sim.history.query({ type: "fault.effect.selected" }).length, 0);
});
