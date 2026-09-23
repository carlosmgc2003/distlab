import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulationFactory, canonicalCopy, canonicalEncode } from "@distlab/kernel";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { FaultDecision, FaultDecisionPort, MessageBus, MessageBusController, MessageReceiver } from "@distlab/contracts";
import type { MessageBusInspection, MessageCounterStart, MessageDestinationInput } from "@distlab/kernel";
import { createGolden04, golden04Result } from "../examples/golden-04.ts";

const inputs = (seed = "bus"): RunInputs => ({ contractVersion: 1, modelVersions: { "kernel.message-bus": "1" }, architecture: {}, scenario: {},
  configuration: { startTime: simulationTime(0), historyLimit: 2000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed });
const queue = (id: string, extra: Partial<MessageDestinationInput> = {}): MessageDestinationInput => ({ id, kind: "queue", ...extra });
const topic = (id: string, extra: Partial<MessageDestinationInput> = {}): MessageDestinationInput => ({ id, kind: "topic", ...extra });
const decision = (extra: Partial<FaultDecision> = {}): FaultDecision => ({ ruleIds: extra.ruleIds ?? [], extraDelay: extra.extraDelay ?? duration(0),
  drop: extra.drop ?? false, additionalCopies: extra.additionalCopies ?? 0, copySpacing: extra.copySpacing ?? duration(0), fail: extra.fail ?? false });
const codeOf = (error: unknown): string => (error as { code?: string }).code ?? "";
const data = <T>(value: { data?: unknown }): T => value.data as T;

interface Tools { bus: MessageBus; controller: MessageBusController; inspect: () => MessageBusInspection; setup: Parameters<Parameters<HeadlessSimulationFactory["createSimulation"]>[1]>[0] }
function create(options: { destinations: readonly MessageDestinationInput[]; faults?: FaultDecisionPort; initialCounters?: MessageCounterStart; network?: readonly string[]; history?: ConstructorParameters<typeof HeadlessSimulationFactory>[0] extends infer T ? T extends { createHistory?: infer H } ? H : never : never }, init: (tools: Tools) => void) {
  let tools!: Tools;
  const factory = new HeadlessSimulationFactory({
    ...(options.history ? { createHistory: options.history } : {}),
    ...(options.network ? { network: { targets: options.network, links: [] } } : {}),
    messageBus: { destinations: options.destinations, ...(options.faults ? { faults: options.faults } : {}), ...(options.initialCounters ? { initialCounters: options.initialCounters } : {}) },
  });
  const sim = factory.createSimulation(inputs(), setup => {
    tools = { bus: setup.messageBusFor("publisher"), controller: setup.messageBusController(), inspect: () => setup.inspectMessageBus(), setup };
    init(tools);
  });
  return { sim, tools: () => tools };
}
const receiver = (name: string, got: string[], controller: () => MessageBusController, ready: () => boolean = () => true, outcome: "ack" | "nack" = "ack"): MessageReceiver => ({
  ready, accept: delivery => { got.push(`${name}:${String(delivery.message.body)}:${delivery.attempt}`); controller().acknowledge(delivery.deliveryId, outcome); },
});

test("defaults, empty topics, and queue competition", async () => {
  const got: string[] = [];
  let simTime = () => 0;
  const { sim, tools } = create({ destinations: [topic("events"), queue("jobs")] }, ({ controller, bus, setup }) => {
    const jobs = () => controller;
    controller.subscribe("jobs", "a", receiver("a", got, jobs, () => simTime() >= 10));
    controller.subscribe("jobs", "b", receiver("b", got, jobs));
    setup.registerHandler("empty", "publisher", function* (): ControlledTask { yield bus.publish("events", { type: "Ping", body: null }); });
    setup.registerHandler("one", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: "m1" }); });
    setup.registerHandler("two", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: "m2" }); });
    setup.schedule({ time: simulationTime(0), type: "empty", payload: null });
    setup.schedule({ time: simulationTime(0), type: "one", payload: null });
    setup.schedule({ time: simulationTime(10), type: "two", payload: null });
  });
  simTime = () => sim.time;
  await sim.run();
  const published = sim.history.query({ type: "message.published" });
  assert.equal(data<{ recipientCount: number }>(published[0]!).recipientCount, 0);
  assert.deepEqual(got, ["b:m1:1", "a:m2:1"]);
  const view = tools().inspect();
  assert.equal(view.destinations[1]!.ackTimeout, 1000);
  assert.equal(view.destinations[1]!.capacity, 10000);
  assert.equal(view.cursors.find(cursor => cursor.destination === "jobs")!.index, 1);
  assert.equal(view.records.filter(record => record.destination === "events").length, 0);
});

test("topics settle independently and capacity rejects the whole fan-out", async () => {
  const got: string[] = [];
  const { sim, tools } = create({ destinations: [topic("orders", { maxAttempts: 1 }), topic("limited", { capacity: 1 })] }, ({ controller, bus, setup }) => {
    controller.subscribe("orders", "a", receiver("a", got, () => controller));
    controller.subscribe("orders", "b", receiver("b", got, () => controller, () => true, "nack"));
    controller.subscribe("limited", "a", receiver("a", got, () => controller));
    controller.subscribe("limited", "b", receiver("b", got, () => controller));
    setup.registerHandler("fan", "publisher", function* (): ControlledTask { yield bus.publish("orders", { type: "Order", body: "o" }); });
    setup.registerHandler("full", "publisher", function* (): ControlledTask {
      try { yield bus.publish("limited", { type: "Order", body: "x" }); got.push("accepted"); }
      catch (error) { got.push(codeOf(error)); }
    });
    setup.schedule({ time: simulationTime(0), type: "fan", payload: null });
    setup.schedule({ time: simulationTime(1), type: "full", payload: null });
  });
  await sim.run();
  assert.deepEqual(got, ["a:o:1", "b:o:1", "BUS_CAPACITY_EXCEEDED"]);
  const orders = tools().inspect().records.filter(record => record.destination === "orders");
  assert.equal(orders.length, 2);
  assert.equal(orders[0]!.messageId, orders[1]!.messageId);
  assert.deepEqual(orders.map(record => record.state).sort(), ["ACKED", "DEAD"]);
  assert.equal(tools().inspect().records.filter(record => record.destination === "limited").length, 0);
  assert.equal(sim.history.query({ type: "message.publish.rejected" }).length, 1);
  assert.equal(sim.status, "COMPLETED");
});

test("nack, timeout, and exhaustion release reservations into bounded dead letters", async () => {
  const got: string[] = [];
  const { sim, tools } = create({ destinations: [queue("nack", { maxAttempts: 2, retryDelay: duration(0), ackTimeout: duration(50) }), queue("timeout", { maxAttempts: 2, retryDelay: duration(1), ackTimeout: duration(5) })] }, ({ controller, bus, setup }) => {
    controller.subscribe("nack", "worker", receiver("n", got, () => controller, () => true, "nack"));
    controller.subscribe("timeout", "worker", { ready: () => true, accept: delivery => { got.push(`t#${delivery.attempt}#${delivery.deliveryId}`); } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask {
      yield bus.publish("nack", { type: "Work", body: "n" });
      yield bus.publish("timeout", { type: "Work", body: "t" });
    });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await sim.run();
  assert.deepEqual(got.filter(item => item.startsWith("n")).map(item => item.split(":")[2]), ["1", "2"]);
  assert.deepEqual(got.filter(item => item.startsWith("t#")).map(item => item.split("#")[1]), ["1", "2"]);
  const dead = tools().inspect().deadLetters;
  assert.equal(dead.length, 2);
  assert.deepEqual(dead.map(letter => letter.reason).sort(), ["nack", "timeout"]);
  assert.equal(dead.every(letter => letter.attempts === 2), true);
  assert.equal(sim.history.query({ type: "message.nacked" }).length, 2);
  assert.equal(sim.history.query({ type: "message.dead" }).length, 2);
  assert.equal(sim.history.query({ type: "message.retry.scheduled" }).length, 2);
});

test("missing acknowledgement at the deadline is stale and cannot settle the next attempt", async () => {
  const seen: string[] = [];
  const { sim, tools } = create({ destinations: [queue("jobs", { maxAttempts: 2, ackTimeout: duration(5), retryDelay: duration(0) })] }, ({ controller, bus, setup }) => {
    let first = "";
    controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => {
      if (delivery.attempt === 1) first = delivery.deliveryId;
      if (delivery.attempt === 2) { controller.acknowledge(first, "ack"); controller.acknowledge(delivery.deliveryId, "ack"); }
      seen.push(delivery.deliveryId);
    } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await sim.run();
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
  assert.equal(tools().inspect().records[0]!.state, "ACKED");
  assert.equal(tools().inspect().deadLetters.length, 0);
  assert.equal(sim.history.query({ type: "message.ack.stale" }).length, 1);
  assert.equal(data<{ outcome: string }>(sim.history.query({ type: "message.ack.stale" })[0]!).outcome, "ack");
});

test("delay reorders arrivals, drop retries the same message, and duplicates repeat effects", async () => {
  const order: string[] = [];
  let calls = 0;
  const faults: FaultDecisionPort = { evaluate: () => { calls += 1; return calls === 1 ? decision({ extraDelay: duration(10) }) : decision(); } };
  const delayed = create({ destinations: [queue("jobs", { deliveryDelay: duration(0) })], faults }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "a", { ready: () => true, accept: delivery => { order.push(`a:${String(delivery.message.body)}`); controller.acknowledge(delivery.deliveryId, "ack"); } });
    controller.subscribe("jobs", "b", { ready: () => true, accept: delivery => { order.push(`b:${String(delivery.message.body)}`); controller.acknowledge(delivery.deliveryId, "ack"); } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask {
      yield bus.publish("jobs", { type: "Work", body: "m1" });
      yield bus.publish("jobs", { type: "Work", body: "m2" });
    });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await delayed.sim.run();
  assert.deepEqual(order, ["b:m2", "a:m1"]);

  const dropped: string[] = [];
  let drops = 0;
  const dropFault: FaultDecisionPort = { evaluate: () => decision(drops++ === 0 ? { drop: true } : {}) };
  const loss = create({ destinations: [queue("jobs", { maxAttempts: 2, ackTimeout: duration(5), retryDelay: duration(0) })], faults: dropFault }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => { dropped.push(`${delivery.messageId}:${delivery.deliveryId}`); controller.acknowledge(delivery.deliveryId, "ack"); } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: "once" }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await loss.sim.run();
  assert.equal(dropped.length, 1);
  assert.equal(loss.sim.history.query({ type: "message.dropped" }).length, 1);
  const lost = data<{ messageId: string; deliveryId: string }>(loss.sim.history.query({ type: "message.dropped" })[0]!);
  const delivered = data<{ messageId: string; deliveryId: string }>(loss.sim.history.query({ type: "message.delivered" })[0]!);
  assert.equal(lost.messageId, delivered.messageId);
  assert.notEqual(lost.deliveryId, delivered.deliveryId);

  let copies = 0;
  const ids: { messageId: string; deliveryId: string }[] = [];
  const duplicate: FaultDecisionPort = { evaluate: () => decision({ ruleIds: ["once"], additionalCopies: 1, copySpacing: duration(0) }) };
  const repeated = create({ destinations: [queue("jobs")], faults: duplicate }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => {
      copies += 1;
      ids.push({ messageId: delivery.messageId, deliveryId: delivery.deliveryId });
      if (ids.length === 2) {
        controller.acknowledge(ids[0]!.deliveryId, "ack");
        controller.acknowledge(ids[1]!.deliveryId, "ack");
      }
    } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: "effect" }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await repeated.sim.run();
  assert.equal(copies, 2);
  assert.equal(ids[0]!.messageId, ids[1]!.messageId);
  assert.notEqual(ids[0]!.deliveryId, ids[1]!.deliveryId);
  const spans = repeated.sim.history.query({ type: "message.delivered" });
  assert.equal(spans.length, 2);
  assert.notEqual(spans[0]!.spanId, spans[1]!.spanId);
  assert.equal(spans[0]!.parentSpanId, spans[1]!.parentSpanId);
  assert.equal(repeated.sim.history.query({ type: "message.ack.stale" }).length, 1);
});

test("a duplicate scheduled after settlement does not start a new handler", async () => {
  const seen: string[] = [];
  const faults: FaultDecisionPort = { evaluate: () => decision({ additionalCopies: 1, copySpacing: duration(10) }) };
  const { sim } = create({ destinations: [queue("jobs", { ackTimeout: duration(5), maxAttempts: 1 })], faults }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => {
      seen.push(delivery.deliveryId);
      controller.acknowledge(delivery.deliveryId, "ack");
    } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await sim.run();
  assert.equal(seen.length, 1);
  assert.equal(sim.history.query({ type: "message.delivered" }).length, 1);
  assert.equal(data<{ reason: string }>(sim.history.query({ type: "message.dropped" })[0]!).reason, "settled");

  const expired = create({ destinations: [queue("jobs", { ackTimeout: duration(5), maxAttempts: 1 })], faults }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: () => {} });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await expired.sim.run();
  assert.equal(expired.sim.history.query({ type: "message.delivered" }).length, 1);
  assert.equal(expired.sim.history.query({ type: "message.dead" }).length, 1);
  assert.equal(data<{ reason: string }>(expired.sim.history.query({ type: "message.dropped" })[0]!).reason, "settled");
});

test("alias mutation, invalid input, overflow, and observation failure leave no partial routing success", async () => {
  const seen: number[] = [];
  const { sim } = create({ destinations: [queue("jobs")] }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => { seen.push((delivery.message.body as { n: number }).n); controller.acknowledge(delivery.deliveryId, "ack"); } });
    setup.registerHandler("go", "publisher", function* (): ControlledTask {
      const body = { n: 1 };
      const message = { type: "Work", body };
      const operation = bus.publish("jobs", message);
      body.n = 9;
      yield operation;
    });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await sim.run();
  assert.deepEqual(seen, [1]);
  const view = create({ destinations: [queue("jobs")] }, ({ controller, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: () => {} });
    setup.registerHandler("go", "publisher", () => {});
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  }).tools().inspect();
  assert.equal(Object.isFrozen(view), true);
  assert.throws(() => { (view.records as unknown as { state: string }[]).push({ state: "QUEUED" }); });

  const malformed = create({ destinations: [queue("jobs")] }, ({ bus, setup }) => {
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await assert.rejects(malformed.sim.run(), { code: "INVALID_MESSAGE_OPERATION" });
  assert.throws(() => new HeadlessSimulationFactory({ messageBus: { destinations: [queue("jobs", { ackTimeout: duration(0) })] } }).createSimulation(inputs(), () => {}), { code: "INVALID_RUN_INPUT" });
  assert.throws(() => new HeadlessSimulationFactory({ messageBus: { destinations: [queue("jobs"), queue("jobs")] } }).createSimulation(inputs(), () => {}), { code: "INVALID_RUN_INPUT" });

  const overflow = create({ destinations: [queue("jobs")], initialCounters: { message: Number.MAX_SAFE_INTEGER } }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: () => {} });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await assert.rejects(overflow.sim.run(), { code: "IDENTITY_OVERFLOW" });
  assert.equal(overflow.sim.history.query({ type: "message.published" }).length, 0);
  assert.equal(overflow.sim.history.query({ type: "message.queued" }).length, 0);

  const sink = create({ destinations: [queue("jobs")], history: options => {
    const history = new ExecutionHistory(options);
    const record = history.record.bind(history);
    history.record = input => {
      if (input.type === "message.published") throw Object.assign(new Error("HISTORY_LIMIT_EXCEEDED"), { code: "HISTORY_LIMIT_EXCEEDED", context: null });
      return record(input);
    };
    return history;
  } }, ({ controller, bus, setup }) => {
    controller.subscribe("jobs", "worker", { ready: () => true, accept: () => {} });
    setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "go", payload: null });
  });
  await assert.rejects(sink.sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  const failure = sink.sim.history.export().terminalFailure;
  assert.equal(failure?.historyComplete, false);
  assert.equal((failure?.context as { rejectedObservationType?: string }).rejectedObservationType, "message.published");
  assert.equal(sink.sim.history.query({ type: "message.published" }).length, 0);
  assert.equal(sink.sim.history.query({ type: "message.queued" }).length, 0);
  assert.equal(sink.sim.history.query({ type: "simulation.completed" }).length, 0);
});

test("fresh and reset runs match, and old ports are revoked", async () => {
  const build = () => {
    const got: string[] = [];
    return create({ destinations: [queue("jobs", { maxAttempts: 1, ackTimeout: duration(5) })] }, ({ controller, bus, setup }) => {
      got.length = 0;
      controller.subscribe("jobs", "b", receiver("b", got, () => controller, () => true, "nack"));
      controller.subscribe("jobs", "a", receiver("a", got, () => controller, () => false));
      setup.registerHandler("go", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: "m" }); });
      setup.schedule({ time: simulationTime(0), type: "go", payload: null });
    });
  };
  const first = build();
  const second = build();
  await first.sim.run();
  await second.sim.run();
  assert.deepEqual(second.sim.history.export(), first.sim.history.export());
  assert.equal(canonicalEncode(canonicalCopy(second.tools().inspect())), canonicalEncode(canonicalCopy(first.tools().inspect())));
  const old = first.tools().bus;
  const before = first.sim.history.export();
  await first.sim.reset();
  assert.throws(() => old.publish("jobs", { type: "Work", body: null }), { code: "STALE_CAPABILITY" });
  await first.sim.run();
  assert.deepEqual(first.sim.history.export(), before);
  assert.equal(first.tools().inspect().deadLetters.length, 1);
  assert.equal(first.tools().inspect().cursors[0]!.index, 1);
});

test("services ack, nack, retain backlog, and resume without polling", async () => {
  const got: string[] = [];
  let billing!: DeterministicServiceRuntime;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["billing"], links: [] }, messageBus: { destinations: [queue("jobs")] } })
    .createSimulation(inputs(), setup => {
      const bus = setup.messageBusFor("publisher");
      billing = new DeterministicServiceRuntime({ id: "billing", version: "1", setup, events: setup.messageBusFor("billing"), busController: setup.messageBusController(),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "billing", version: "1", endpoints: {}, background: {}, consumers: {
          jobs: delivery => { got.push(`${delivery.message.type}:${delivery.messageId}`); if (delivery.message.type === "bad") throwSimulationError("ROW_EXISTS"); },
        } }) });
      setup.registerHandler("pub", "publisher", function* (): ControlledTask {
        yield bus.publish("jobs", { type: "ok", body: null });
        yield bus.publish("jobs", { type: "bad", body: null });
        yield bus.publish("jobs", { type: "later", body: null });
      });
      setup.schedule({ time: simulationTime(1), type: "pub", payload: null });
      setup.schedule({ time: simulationTime(50), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
    });
  await sim.run();
  assert.deepEqual(got.filter(item => !item.startsWith("bad")).map(item => item.split(":")[0]), ["ok", "later"]);
  assert.equal(got.some(item => item.startsWith("bad")), true);
  assert.equal(sim.history.query({ type: "message.acknowledged" }).length, 2);
  assert.equal(sim.history.query({ type: "message.nacked" }).length, 3);
  const dispatches = sim.history.query({ type: "scheduler.event.scheduled" }).filter(record => data<{ type: string }>(record).type === "kernel.message.dispatch");
  assert.equal(dispatches.length > 0 && dispatches.length < 12, true);
  assert.equal(dispatches.every(record => data<{ dueTime: number }>(record).dueTime >= 50), true);
});

test("crash leaves the ack deadline active and a later restart redelivers the same message", async () => {
  const seen: { messageId: string; deliveryId: string; attempt: number }[] = [];
  let consumer!: DeterministicServiceRuntime;
  const sim = new HeadlessSimulationFactory({
    network: { targets: ["orders", "billing"], links: [] },
    messageBus: { destinations: [queue("jobs", { ackTimeout: duration(15), retryDelay: duration(0), maxAttempts: 3 })] },
  }).createSimulation(inputs(), setup => {
    const orders = new DeterministicServiceRuntime({ id: "orders", version: "1", setup, events: setup.messageBusFor("orders"), busController: setup.messageBusController(),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "orders", version: "1", endpoints: {}, consumers: {}, background: {
        publish: function* (_, ctx): ControlledTask { yield ctx.events.publish("jobs", { type: "Work", body: { n: 1 } }); },
      } }) });
    consumer = new DeterministicServiceRuntime({ id: "billing", version: "1", setup, events: setup.messageBusFor("billing"), busController: setup.messageBusController(),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "billing", version: "1", endpoints: {}, background: {}, consumers: {
        jobs: function* (delivery, ctx): ControlledTask {
          seen.push({ messageId: delivery.messageId, deliveryId: delivery.deliveryId, attempt: delivery.attempt });
          if (delivery.attempt === 1) yield ctx.clock.sleep(duration(100));
        },
      } }) });
    setup.schedule({ time: simulationTime(0), type: orders.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(0), type: consumer.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: orders.backgroundEventType, payload: { name: "publish", data: null } });
    setup.schedule({ time: simulationTime(2), type: consumer.lifecycleEventType, payload: { next: "CRASHED" } });
    setup.schedule({ time: simulationTime(40), type: consumer.lifecycleEventType, payload: { next: "STARTING" } });
    setup.schedule({ time: simulationTime(41), type: consumer.lifecycleEventType, payload: { next: "RUNNING" } });
  });
  await sim.run();
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.messageId, seen[1]!.messageId);
  assert.notEqual(seen[0]!.deliveryId, seen[1]!.deliveryId);
  assert.deepEqual(seen.map(item => item.attempt), [1, 2]);
  assert.equal(sim.history.query({ type: "message.acknowledged" }).length, 1);
  assert.equal(sim.history.query({ type: "service.handler.abandoned" }).length, 1);
  assert.equal(sim.status, "COMPLETED");
});

test("duplicate delivery repeats a non-idempotent service effect", async () => {
  let effects = 0;
  const ids: { messageId: string; deliveryId: string }[] = [];
  const faults: FaultDecisionPort = { evaluate: probe => probe.point === "message.delivery" ? decision({ additionalCopies: 1 }) : decision() };
  const sim = new HeadlessSimulationFactory({ network: { targets: ["orders", "billing"], links: [] }, messageBus: { destinations: [topic("orders")], faults } })
    .createSimulation(inputs(), setup => {
      const orders = new DeterministicServiceRuntime({ id: "orders", version: "1", setup, events: setup.messageBusFor("orders"), busController: setup.messageBusController(),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "orders", version: "1", endpoints: {}, consumers: {}, background: {
          publish: function* (_, ctx): ControlledTask { yield ctx.events.publish("orders", { type: "OrderCreated", body: { orderId: "o1" } }); },
        } }) });
      const billing = new DeterministicServiceRuntime({ id: "billing", version: "1", setup, events: setup.messageBusFor("billing"), busController: setup.messageBusController(),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "billing", version: "1", endpoints: {}, background: {}, consumers: {
          orders: delivery => { effects += 1; ids.push({ messageId: delivery.messageId, deliveryId: delivery.deliveryId }); },
        } }) });
      setup.schedule({ time: simulationTime(0), type: orders.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(0), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: orders.backgroundEventType, payload: { name: "publish", data: null } });
    });
  await sim.run();
  assert.equal(effects, 2);
  assert.equal(ids[0]!.messageId, ids[1]!.messageId);
  assert.notEqual(ids[0]!.deliveryId, ids[1]!.deliveryId);
  assert.equal(sim.history.query({ type: "message.ack.stale" }).length, 1);
});

test("an outbox row survives publish rejection and a later retry can publish twice", async () => {
  const outbox: { id: string; rejected: boolean; publishes: string[] }[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["orders"], links: [] }, messageBus: { destinations: [queue("jobs", { capacity: 1 })] } })
    .createSimulation(inputs(), setup => {
      const controller = setup.messageBusController();
      controller.subscribe("jobs", "worker", { ready: () => true, accept: delivery => controller.acknowledge(delivery.deliveryId, "ack") });
      const orders = new DeterministicServiceRuntime({ id: "orders", version: "1", setup, events: setup.messageBusFor("orders"),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "orders", version: "1", endpoints: {}, consumers: {}, background: {
          fill: function* (_, ctx): ControlledTask {
            yield ctx.events.publish("jobs", { type: "Fill", body: null });
            outbox.push({ id: "row-1", rejected: false, publishes: [] });
            try { yield ctx.events.publish("jobs", { type: "Order", body: { n: 1 } }); }
            catch (error) { if (codeOf(error) !== "BUS_CAPACITY_EXCEEDED") throw error; outbox[0]!.rejected = true; }
          },
          retry: function* (_, ctx): ControlledTask {
            const accepted = (yield ctx.events.publish("jobs", { type: "Order", body: { n: 1 } })) as { messageId: string };
            outbox[0]!.publishes.push(accepted.messageId);
          },
        } }) });
      setup.schedule({ time: simulationTime(0), type: orders.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: orders.backgroundEventType, payload: { name: "fill", data: null } });
      setup.schedule({ time: simulationTime(2), type: orders.backgroundEventType, payload: { name: "retry", data: null } });
      setup.schedule({ time: simulationTime(3), type: orders.backgroundEventType, payload: { name: "retry", data: null } });
    });
  await sim.run();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]!.rejected, true);
  assert.equal(outbox[0]!.publishes.length, 2);
  assert.notEqual(outbox[0]!.publishes[0], outbox[0]!.publishes[1]);
  assert.equal(sim.status, "COMPLETED");
});

test("equal-time acknowledgement loses to the previously inserted deadline", async () => {
  let consumer!: DeterministicServiceRuntime;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["billing"], links: [] }, messageBus: { destinations: [queue("jobs", { ackTimeout: duration(5), maxAttempts: 1 })] } })
    .createSimulation(inputs(), setup => {
      const bus = setup.messageBusFor("publisher");
      consumer = new DeterministicServiceRuntime({ id: "billing", version: "1", setup, events: setup.messageBusFor("billing"), busController: setup.messageBusController(),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, resolve: () => ({ id: "billing", version: "1", endpoints: {}, background: {}, consumers: {
          jobs: function* (_, ctx): ControlledTask { yield ctx.clock.sleep(duration(5)); },
        } }) });
      setup.registerHandler("pub", "publisher", function* (): ControlledTask { yield bus.publish("jobs", { type: "Work", body: null }); });
      setup.schedule({ time: simulationTime(0), type: consumer.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: "pub", payload: null });
    });
  await sim.run();
  assert.equal(sim.history.query({ type: "message.dead" }).length, 1);
  assert.equal(sim.history.query({ type: "message.acknowledged" }).length, 0);
  assert.equal(sim.history.query({ type: "message.ack.stale" }).length, 1);
  assert.equal(data<{ outcome: string }>(sim.history.query({ type: "message.ack.stale" })[0]!).outcome, "ack");
  const dead = sim.history.query({ type: "message.dead" })[0]!;
  const stale = sim.history.query({ type: "message.ack.stale" })[0]!;
  assert.equal(dead.time, stale.time);
  assert.ok(dead.sequence < stale.sequence);
});

test("golden 04 correlates publish, delivery, and acknowledgement across reset", async () => {
  const fixture = createGolden04();
  const fresh = createGolden04();
  await fixture.simulation.run();
  await fresh.simulation.run();
  const result = golden04Result(fixture);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.state.orderId, "o1");
  assert.equal(result.state.messageId.length > 0, true);
  assert.notEqual(result.state.messageId, result.state.deliveryId);
  const published = result.history.observations.find(record => record.type === "message.published");
  const delivered = result.history.observations.find(record => record.type === "message.delivered");
  const acknowledged = result.history.observations.find(record => record.type === "message.acknowledged");
  assert.equal(published?.traceId, delivered?.traceId);
  assert.equal(delivered?.traceId, acknowledged?.traceId);
  assert.equal(delivered?.parentSpanId, published?.spanId);
  assert.equal(acknowledged?.spanId, delivered?.spanId);
  assert.equal(data<{ messageId: string }>(published!).messageId, result.state.messageId);
  assert.equal(data<{ deliveryId: string }>(delivered!).deliveryId, result.state.deliveryId);
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-04.expected.json", import.meta.url), "utf8")) as { digest: string; state: GoldenState; observationCount: number };
  assert.equal(result.digest, expected.digest);
  assert.equal(canonicalEncode(canonicalCopy(result.state)), canonicalEncode(canonicalCopy(expected.state)));
  assert.equal(result.history.observations.length, expected.observationCount);
  assert.deepEqual(golden04Result(fresh), result);
  await fixture.simulation.reset();
  await fixture.simulation.run();
  assert.deepEqual(golden04Result(fixture), result);
});

test("golden 04 is executable headlessly as a standalone CLI", () => {
  const script = fileURLToPath(new URL("../examples/golden-04.ts", import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8" })) as ReturnType<typeof golden04Result>;
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-04.expected.json", import.meta.url), "utf8")) as { digest: string };
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.digest, expected.digest);
  assert.equal(result.history.terminalFailure, undefined);
});

interface GoldenState { messageId: string; deliveryId: string; orderId: string }
