import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicServiceRuntime, HeadlessSimulationFactory } from "@distlab/kernel";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { Database, Delivery, KeyValueStore, MessageBus, MessageBusController, MessageReceiver, ServiceDefinition, Transaction, VirtualNetwork } from "@distlab/contracts";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { service: "1" }, architecture: {}, scenario: {},
  configuration: { startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "service-test" };
const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };
const definition = (id: string, endpoints: ServiceDefinition["endpoints"] = {}, background: ServiceDefinition["background"] = {}): ServiceDefinition =>
  ({ id, version: "1", endpoints, consumers: {}, background });

test("lifecycle edges, duplicate transitions, pause admission, and detached inspection", async () => {
  let runtime!: DeterministicServiceRuntime;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "client"], links: [{ source: "client", target: "service" }] } })
    .createSimulation(inputs, setup => {
      runtime = new DeterministicServiceRuntime({ id: "service", version: "1", resolve: () => definition("service", { ping: () => ({ status: "ok", body: 1 }) }),
        setup, taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
      for (const [time, next] of [[0, "RUNNING"], [1, "RUNNING"], [2, "PAUSED"], [3, "RUNNING"], [4, "CRASHED"], [5, "STARTING"], [6, "STOPPED"], [7, "STARTING"], [8, "RUNNING"]] as const)
        setup.schedule({ time: simulationTime(time), type: runtime.lifecycleEventType, payload: { next } });
    });
  assert.equal(runtime.state, "STARTING");
  await sim.run();
  assert.equal(runtime.state, "RUNNING");
  assert.equal(sim.history.query({ type: "service.lifecycle.changed" }).length, 8);
  const view = runtime.inspect();
  assert.deepEqual(view.tasks, []);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.tasks), true);
  assert.equal(runtime.processGeneration, 2);
});

test("invalid lifecycle transition seals the simulation", async () => {
  let runtime!: DeterministicServiceRuntime;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", resolve: () => definition("service"), setup,
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "PAUSED" } });
  });
  await assert.rejects(sim.run(), { code: "INVALID_SERVICE_TRANSITION" });
});

test("real network carries service-to-service request and a paused service refuses new work", async () => {
  let front!: DeterministicServiceRuntime, back!: DeterministicServiceRuntime, client!: VirtualNetwork;
  const replies: unknown[] = [];
  const factory = new HeadlessSimulationFactory({ network: { targets: ["client", "front", "back"], links: [
    { source: "client", target: "front" }, { source: "front", target: "back" }, { source: "client", target: "back" },
  ] } });
  const sim = factory.createSimulation(inputs, setup => {
    client = setup.networkFor("client");
    const common = { setup, taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events };
    front = new DeterministicServiceRuntime({ ...common, id: "front", version: "1", resolve: () => definition("front", {
      call: function* (_, ctx) { const reply = yield ctx.http.request({ target: "back", endpoint: "answer", body: null }); return reply as never; },
    }) });
    back = new DeterministicServiceRuntime({ ...common, id: "back", version: "1", resolve: () => definition("back", {
      answer: () => ({ status: "ok", body: 42 }),
    }) });
    setup.registerHandler("client.call", "client", function* (): ControlledTask { replies.push(yield client.request({ target: "front", endpoint: "call", body: null })); });
    setup.registerHandler("client.paused", "client", function* (): ControlledTask { replies.push(yield client.request({ target: "back", endpoint: "answer", body: null })); });
    setup.schedule({ time: simulationTime(0), type: front.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(0), type: back.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "client.call", payload: null });
    setup.schedule({ time: simulationTime(2), type: back.lifecycleEventType, payload: { next: "PAUSED" } });
    setup.schedule({ time: simulationTime(3), type: "client.paused", payload: null });
  });
  await sim.run();
  assert.equal(JSON.stringify(replies), JSON.stringify([{ status: "ok", body: 42 }, { status: "error", body: { code: "TARGET_UNAVAILABLE" } }]));
  assert.equal(sim.history.query({ type: "service.handler.completed" }).length, 2);
});

test("crash abandons local sleep without finally, preserves committed fixture work, and restart gets fresh handlers", async () => {
  let runtime!: DeterministicServiceRuntime;
  let committed = 0, pending = 0, constructed = 0;
  const output: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => { constructed++; return definition("service", {}, {
        work: function* (_, ctx): ControlledTask { try { pending++; yield ctx.clock.sleep(duration(10)); committed += pending; pending = 0; output.push("resumed"); }
          finally { output.push("finally"); } },
      }); }, taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events,
      abandonResources: () => { pending = 0; } });
    setup.registerHandler("fixture.commit", "service", () => { committed += pending; pending = 0; });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "work", data: null } });
    setup.schedule({ time: simulationTime(2), type: "fixture.commit", payload: null });
    setup.schedule({ time: simulationTime(3), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
    setup.schedule({ time: simulationTime(4), type: runtime.lifecycleEventType, payload: { next: "STARTING" } });
    setup.schedule({ time: simulationTime(5), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(6), type: runtime.backgroundEventType, payload: { name: "work", data: null } });
    setup.schedule({ time: simulationTime(7), type: runtime.lifecycleEventType, payload: { next: "STOPPED" } });
  });
  await sim.run();
  assert.equal(committed, 1);
  assert.equal(pending, 0);
  assert.equal(constructed, 2);
  assert.deepEqual(output, []);
  assert.equal(sim.history.query({ type: "service.handler.abandoned" }).length, 2);
  assert.equal(sim.history.query({ type: "clock.sleep.resumed" }).length, 0);
});

test("crash abandons an inbound request and caller observes only its deadline", async () => {
  let runtime!: DeterministicServiceRuntime, client!: VirtualNetwork;
  const outcomes: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "client"], links: [
    { source: "client", target: "service", policy: { timeout: duration(5) } },
  ] } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client");
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => definition("service", { slow: function* (_, ctx) { yield ctx.clock.sleep(duration(10)); return { status: "ok", body: 1 }; } }),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.registerHandler("client.call", "client", function* (): ControlledTask {
      try { yield client.request({ target: "service", endpoint: "slow", body: null }); outcomes.push("reply"); }
      catch (error) { outcomes.push((error as { code: string }).code); }
    });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "client.call", payload: null });
    setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
  });
  await sim.run();
  assert.deepEqual(outcomes, ["NETWORK_TIMEOUT"]);
  assert.equal(sim.history.query({ type: "service.handler.abandoned" }).length, 1);
  assert.equal(sim.history.query({ type: "network.response.sent" }).length, 0);
});

test("cross-owner and stale process capabilities are terminal", async () => {
  for (const mode of ["foreign", "stale"] as const) {
    let runtime!: DeterministicServiceRuntime, client!: VirtualNetwork;
    let saved!: Parameters<ServiceDefinition["endpoints"][string]>[1];
    const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "client"], links: [
      { source: "client", target: "service" },
    ] } }).createSimulation(inputs, setup => {
      client = setup.networkFor("client");
      runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
        resolve: () => definition("service", { capture: (_, ctx) => { saved = ctx; return { status: "ok", body: null }; } }),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
      setup.registerHandler("client.call", "client", function* (): ControlledTask { yield client.request({ target: "service", endpoint: "capture", body: null }); });
      setup.registerHandler("client.violate", "client", () => { saved.log.write("info", "bad"); });
      setup.registerHandler("service.violate", "service", () => { saved.log.write("info", "bad"); });
      setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: "client.call", payload: null });
      if (mode === "stale") setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
      setup.schedule({ time: simulationTime(3), type: mode === "foreign" ? "client.violate" : "service.violate", payload: null });
    });
    await assert.rejects(sim.run(), { code: mode === "foreign" ? "INVALID_OPERATION" : "STALE_CAPABILITY" });
  }
});

test("reset reconstructs service resources and reproduces history", async () => {
  let runtime!: DeterministicServiceRuntime, constructed = 0;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => { constructed++; return definition("service", {}, { log: (_, ctx) => ctx.log.write("info", "replay", { count: 1 }) }); },
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "log", data: null } });
  });
  await sim.run();
  const first = sim.history.export();
  await sim.reset();
  await sim.run();
  assert.equal(constructed, 2);
  assert.equal(sim.history.query({ type: "runtime.log" }).length, 1);
  assert.deepEqual(sim.history.export(), first);
});

test("fake Database port keeps only commits dispatched before crash", async () => {
  for (const commitBeforeCrash of [false, true]) {
    let runtime!: DeterministicServiceRuntime;
    let staged = 0, durable = 0, commitOperation = "", finalizers = 0;
    const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
      const db: Database = { begin: (): Transaction => ({ id: "tx", get: () => undefined, scan: () => [],
        insert: () => { staged++; }, update: () => { staged++; }, delete: () => false,
        commit: () => { const operation = sim.operations.create(); commitOperation = operation.operationId; return operation; },
        rollback: () => { staged = 0; } }) };
      runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db,
        resolve: () => definition("service", {}, { write: function* (_, ctx): ControlledTask {
          try { const tx = ctx.db!.begin(); tx.insert("orders", "o1", { value: 1 }); yield tx.commit(); yield ctx.clock.sleep(duration(10)); }
          finally { finalizers++; }
        } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events,
        abandonResources: () => { staged = 0; } });
      setup.registerHandler("fixture.commit", "service", () => {
        if (staged) { durable += staged; staged = 0; }
        sim.operations.complete(commitOperation, { kind: "success", value: null });
      });
      setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "write", data: null } });
      setup.schedule({ time: simulationTime(commitBeforeCrash ? 2 : 3), type: "fixture.commit", payload: null });
      setup.schedule({ time: simulationTime(commitBeforeCrash ? 3 : 2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
    });
    await sim.run();
    assert.equal(durable, commitBeforeCrash ? 1 : 0);
    assert.equal(finalizers, 0);
    assert.equal(sim.history.query({ type: "service.handler.abandoned" }).length, 1);
  }
});

test("fake bus delivers to owner and receives ACK or NACK for modeled failure", async () => {
  let runtime!: DeterministicServiceRuntime, receiver!: MessageReceiver;
  const results: string[] = [];
  const controller: MessageBusController = { subscribe: (_destination, _consumer, value) => { receiver = value; },
    acknowledge: (_id, outcome) => results.push(outcome), consumerChanged: () => {} };
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, busController: controller,
      resolve: () => ({ id: "service", version: "1", endpoints: {}, background: {}, consumers: { queue: delivery => {
        if (delivery.message.type === "bad") throwSimulationError("ROW_EXISTS");
      } } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.registerHandler("fixture.deliver", "service", event => {
      assert.equal(receiver.ready(), true);
      receiver.accept(event.payload as unknown as Delivery);
    });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    for (const [time, type] of [[1, "ok"], [2, "bad"]] as const)
      setup.schedule({ time: simulationTime(time), type: "fixture.deliver", payload: { messageId: type, deliveryId: type,
        destination: "queue", attempt: 1, message: { type, body: null } } });
  });
  await sim.run();
  assert.deepEqual(results, ["ack", "nack"]);
});

test("pause blocks new local work while an admitted task finishes", async () => {
  let runtime!: DeterministicServiceRuntime;
  const output: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => definition("service", {}, { work: function* (_, ctx): ControlledTask {
        yield ctx.clock.sleep(duration(4)); output.push("finished");
      } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "work", data: null } });
    setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "PAUSED" } });
    setup.schedule({ time: simulationTime(3), type: runtime.backgroundEventType, payload: { name: "work", data: null } });
  });
  await sim.run();
  assert.deepEqual(output, ["finished"]);
  assert.equal(sim.history.query({ type: "service.work.skipped" }).length, 1);
  assert.equal(sim.history.query({ type: "service.handler.completed" }).length, 1);
});

test("unexpected service returns and invalid replies seal the run", async () => {
  for (const mode of ["promise", "throw", "yield", "reply"] as const) {
    let runtime!: DeterministicServiceRuntime, client!: VirtualNetwork;
    const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "client"], links: [
      { source: "client", target: "service" },
    ] } }).createSimulation(inputs, setup => {
      client = setup.networkFor("client");
      runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
        resolve: () => definition("service", { fail: mode === "promise" ? () => Promise.resolve({ status: "ok", body: null }) as never :
          mode === "throw" ? () => { throw new Error("unexpected"); } :
          mode === "yield" ? function* () { yield { operationId: "forged" }; return { status: "ok", body: null }; } :
          () => ({ status: "wrong", body: null }) as never }),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
      setup.registerHandler("client.call", "client", function* (): ControlledTask { yield client.request({ target: "service", endpoint: "fail", body: null }); });
      setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: "client.call", payload: null });
    });
    await assert.rejects(sim.run(), { code: mode === "promise" ? "UNCONTROLLED_ASYNC" : mode === "throw" ? "HANDLER_FAILED" :
      mode === "yield" ? "INVALID_OPERATION" : "INVALID_NETWORK_REPLY" });
  }
});

test("fake KV and bus ports remain owner scoped; crash cancels local background triggers", async () => {
  let runtime!: DeterministicServiceRuntime;
  const values = new Map<string, number>();
  const kv: KeyValueStore = { get: key => values.get(key), set: (key, value) => { values.set(key, value as number); return true; },
    delete: key => values.delete(key), increment: key => { const next = (values.get(key) ?? 0) + 1; values.set(key, next); return next; },
    compareAndSet: (key, expected, next) => { if (expected.present && values.get(key) !== expected.value) return false;
      values.set(key, next as number); return true; } };
  const seen: number[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, kv,
      resolve: () => definition("service", {}, { work: (_, ctx) => {
        seen.push(ctx.kv!.increment("counter"));
        ctx.clock.schedule(duration(10), runtime.backgroundEventType, { name: "work", data: null });
      } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "work", data: null } });
    setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
  });
  await sim.run();
  assert.deepEqual(seen, [1]);
  assert.equal(values.get("counter"), 1);
  assert.equal(sim.history.query({ type: "scheduler.event.cancelled" }).length, 1);
});
