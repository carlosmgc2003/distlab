import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulationFactory } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs } from "@distlab/contracts/kernel";
import type { KeyValueDefinition, KeyValueStore, MessageBus, ServiceDefinition } from "@distlab/contracts";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { service: "1" }, architecture: {}, scenario: {},
  configuration: { startTime: simulationTime(0), historyLimit: 2000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "kv-test" };
const events: MessageBus = { publish: () => { throw Error("unused"); } };
const owner = "service";
type Action = (kv: KeyValueStore) => void;
type Setup = Parameters<HeadlessSimulationFactory["createSimulation"]>[1] extends (setup: infer S) => void ? S : never;
function fixture(initial: KeyValueDefinition["initial"], actions: Record<string, Action>, schedule: (setup: Setup, runtime: DeterministicServiceRuntime) => void,
  register?: (setup: Setup) => void) {
  let runtime!: DeterministicServiceRuntime;
  let kv!: KeyValueStore;
  const factory = new HeadlessSimulationFactory({ network: { targets: [owner], links: [] }, keyValues: [{ owner, initial }] });
  const sim = factory.createSimulation(inputs, setup => {
    const definition: ServiceDefinition = { id: owner, version: "1", endpoints: {}, consumers: {}, background: Object.fromEntries(
      Object.entries(actions).map(([name, action]) => [name, (_: unknown, ctx: { kv?: KeyValueStore }) => { action(ctx.kv!); }])) as ServiceDefinition["background"] };
    runtime = new DeterministicServiceRuntime({ id: owner, version: "1", resolve: () => definition,
      setup, taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    kv = setup.keyValueStoreFor(owner)!;
    register?.(setup);
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    schedule(setup, runtime);
  });
  return { sim, runtime, kv };
}
const at = (time: number, name: string, runtime: DeterministicServiceRuntime) =>
  ({ time: simulationTime(time), type: runtime.backgroundEventType, payload: { name, data: null } });

test("initial values, null, detached copies, mutation, and counter TTL", async () => {
  const seen: unknown[] = [];
  const { sim } = fixture([{ key: "null", value: null }, { key: "counter", value: 4, ttl: duration(5) }], {
    work: kv => {
      seen.push(kv.get("missing"), kv.get("null"));
      const input = { nested: [1] };
      assert.equal(kv.set("object", input), true);
      input.nested.push(2);
      seen.push(kv.get("object"));
      seen.push(kv.increment("counter"), kv.increment("fresh"), kv.delete("null"), kv.get("null"));
    },
    after: kv => { seen.push(kv.get("counter"), kv.get("fresh")); },
  }, (setup, runtime) => { setup.schedule(at(1, "work", runtime)); setup.schedule(at(5, "after", runtime)); });
  await sim.run();
  assert.equal(JSON.stringify(seen), JSON.stringify([undefined, null, { nested: [1] }, 5, 1, true, undefined, undefined, 1]));
  assert.equal(sim.history.query({ type: "kv.expired" }).length, 1);
});

test("expiry ties see absence in both event orders and stale expiry cannot remove replacement", async () => {
  for (const initial of [true, false]) {
    const results: unknown[] = [];
    const { sim } = fixture(initial ? [{ key: "lease", value: "old", ttl: duration(5) }] : [], {
      seed: kv => { kv.set("lease", "old", { ttl: duration(5) }); },
      replace: kv => { results.push(kv.get("lease")); kv.set("lease", "new", { ttl: duration(10), ifAbsent: true }); },
      inspect: kv => results.push(kv.get("lease")),
    }, (setup, runtime) => {
      if (!initial) setup.schedule(at(0, "seed", runtime));
      setup.schedule(at(5, "replace", runtime));
      setup.schedule(at(6, "inspect", runtime));
    });
    await sim.run();
    assert.deepEqual(results, [undefined, "new"]);
    assert.equal(sim.history.query({ type: "kv.expired" }).length, 2);
  }
});

test("conditional contenders have one winner, structural CAS and failed conditions preserve TTL", async () => {
  const results: boolean[] = [];
  const { sim } = fixture([], {
    first: kv => results.push(kv.set("lock", { a: 1, b: [2] }, { ifAbsent: true, ttl: duration(5) })),
    second: kv => results.push(kv.set("lock", "loser", { ifAbsent: true, ttl: duration(20) })),
    cas1: kv => results.push(kv.compareAndSet("lock", { present: true, value: { b: [2], a: 1 } }, "winner", { ttl: duration(3) })),
    cas2: kv => results.push(kv.compareAndSet("lock", { present: true, value: { a: 1, b: [2] } }, "loser")),
    expired: kv => results.push(kv.compareAndSet("lock", { present: true, value: "winner" }, "late")),
  }, (setup, runtime) => {
    setup.schedule(at(1, "first", runtime)); setup.schedule(at(1, "second", runtime));
    setup.schedule(at(2, "cas1", runtime)); setup.schedule(at(2, "cas2", runtime));
    setup.schedule(at(5, "expired", runtime));
  });
  await sim.run();
  assert.deepEqual(results, [true, false, true, false, false]);
  assert.equal(sim.history.query({ type: "kv.condition.failed" }).length, 3);
  assert.equal(sim.history.query({ type: "kv.expired" }).length, 1);
});

test("crash retains data while TTL continues and reset reproduces history", async () => {
  const values: unknown[] = [];
  const { sim } = fixture([{ key: "short", value: 1, ttl: duration(4) }], {
    write: kv => { kv.set("durable", "saved"); kv.set("timed", "gone", { ttl: duration(4) }); },
    read: kv => values.push(kv.get("short"), kv.get("timed"), kv.get("durable")),
  }, (setup, runtime) => {
    setup.schedule(at(1, "write", runtime));
    setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
    setup.schedule({ time: simulationTime(6), type: runtime.lifecycleEventType, payload: { next: "STARTING" } });
    setup.schedule({ time: simulationTime(7), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule(at(8, "read", runtime));
  });
  await sim.run();
  const first = sim.history.export();
  assert.deepEqual(values, [undefined, undefined, "saved"]);
  assert.equal(sim.history.query({ type: "kv.expired" }).length, 2);
  await sim.reset(); await sim.run();
  assert.deepEqual(sim.history.export(), first);
});

test("invalid input, counter errors, foreign and stale capabilities fail without writes", async () => {
  for (const mode of ["key", "ttl", "data", "integer", "overflow", "foreign", "stale"] as const) {
    let saved!: KeyValueStore;
    const { sim } = fixture([{ key: "text", value: "x" }, { key: "max", value: Number.MAX_SAFE_INTEGER }], {
      capture: kv => { saved = kv; },
      fail: kv => {
        if (mode === "key") kv.set("", 1);
        if (mode === "ttl") kv.set("safe", 1, { ttl: duration(0) });
        if (mode === "data") kv.set("safe", undefined as never);
        if (mode === "integer") kv.increment("text");
        if (mode === "overflow") kv.increment("max");
        if (mode === "stale") saved.get("text");
      },
    }, (setup, runtime) => {
      setup.schedule(at(1, "capture", runtime));
      if (mode === "stale") {
        setup.schedule({ time: simulationTime(2), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
        setup.schedule({ time: simulationTime(3), type: runtime.lifecycleEventType, payload: { next: "STARTING" } });
        setup.schedule({ time: simulationTime(4), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
      }
      if (mode === "foreign") setup.schedule({ time: simulationTime(2), type: "foreign.read", payload: null });
      else setup.schedule(at(mode === "stale" ? 5 : 2, "fail", runtime));
    }, mode === "foreign" ? setup => setup.registerHandler("foreign.read", "foreign", () => { saved.get("text"); }) : undefined);
    const code = mode === "integer" ? "KV_NOT_INTEGER" : mode === "overflow" ? "KV_COUNTER_OVERFLOW" :
      mode === "stale" ? "STALE_CAPABILITY" : "INVALID_KV_OPERATION";
    if (mode === "integer" || mode === "overflow") {
      await sim.run();
      assert.equal(sim.history.query({ type: "service.handler.failed" })[0]?.data &&
        (sim.history.query({ type: "service.handler.failed" })[0]!.data as { code: string }).code, code);
    } else await assert.rejects(sim.run(), { code });
    assert.equal(sim.history.query({ type: "kv.changed" }).length, 0);
  }
});

test("expiry keeps the correlation of the write that set the TTL", async () => {
  const { sim } = fixture([], {
    write: kv => { kv.set("lease", "a", { ttl: duration(5) }); },
    bump: kv => { kv.increment("lease"); },
    read: kv => { kv.get("lease"); },
  }, (setup, runtime) => {
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "write", data: null }, traceId: "writer", spanId: "write-span" });
    setup.schedule({ time: simulationTime(2), type: runtime.backgroundEventType, payload: { name: "bump", data: null }, traceId: "incrementer", spanId: "bump-span" });
    setup.schedule({ time: simulationTime(6), type: runtime.backgroundEventType, payload: { name: "read", data: null }, traceId: "reader", spanId: "read-span" });
  });
  await sim.run();
  const expired = sim.history.query({ type: "kv.expired" });
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.traceId, "writer");
  assert.equal(expired[0]?.spanId, "write-span");
  assert.notEqual(expired[0]?.eventId, sim.history.query({ type: "kv.read" }).at(-1)?.eventId);
});

test("kv sink failure seals the run", async () => {
  let caught = false;
  const sim = new HeadlessSimulationFactory({
    createHistory: options => {
      const history = new ExecutionHistory(options);
      const record = history.record.bind(history);
      history.record = input => {
        if (input.type === "kv.changed") throw Object.assign(new Error("HISTORY_LIMIT_EXCEEDED"), { code: "HISTORY_LIMIT_EXCEEDED", context: null });
        return record(input);
      };
      return history;
    },
    network: { targets: [owner], links: [] }, keyValues: [{ owner, initial: [] }],
  }).createSimulation(inputs, setup => {
    const runtime = new DeterministicServiceRuntime({ id: owner, version: "1", setup, events,
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner,
      resolve: () => ({ id: owner, version: "1", endpoints: {}, consumers: {}, background: {
        fail: (_data, ctx) => { try { ctx.kv!.set("k", 1); } catch { caught = true; } },
      } }) });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: runtime.backgroundEventType, payload: { name: "fail", data: null } });
  });
  await assert.rejects(sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(caught, true);
  assert.equal(sim.history.export().terminalFailure?.code, "HISTORY_LIMIT_EXCEEDED");
  assert.equal(sim.history.query({ type: "simulation.completed" }).length, 0);
  assert.equal(sim.history.query({ type: "service.handler.completed" }).length, 0);
});
