import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicDatabase, DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulationFactory } from "@distlab/kernel";
import type { DatabaseDefinition, FaultDecisionPort, MessageBus, ServiceDefinition } from "@distlab/contracts";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { service: "1" }, architecture: {}, scenario: {},
  configuration: { startTime: simulationTime(0), historyLimit: 5000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "database-test" };
const definition: DatabaseDefinition = { owner: "service", tables: [
  { name: "stock", unique: [["sku"]], checks: ["nonnegative"] },
  { name: "outbox", unique: [], checks: [] },
], initial: { stock: { a: { sku: "a", available: 2 }, b: { sku: "b", available: 3 } }, outbox: {} } };
const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };
type Background = ServiceDefinition["background"];
function fixture(background: Background, schedule: (runtime: DeterministicServiceRuntime, setup: Parameters<HeadlessSimulationFactory["createSimulation"]>[1] extends (setup: infer S) => void ? S : never) => void,
  options: { fault?: FaultDecisionPort; history?: (options: ConstructorParameters<typeof ExecutionHistory>[0]) => ExecutionHistory } = {}) {
  let db!: DeterministicDatabase;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] }, ...(options.history ? { createHistory: options.history } : {}) })
    .createSimulation(inputs, setup => {
      db = new DeterministicDatabase({ definition, checks: { nonnegative: row => typeof row.available === "number" && row.available >= 0 },
        setup, clock: { now: () => sim.time }, schedule: (type, payload) => sim.scheduleStorage(type, payload),
        operations: { create: () => sim.operations.create(), complete: (id, outcome) => sim.operations.complete(id, outcome) },
        observations: { record: input => sim.storageObservations.record(input) }, task: () => sim.activeTaskIdentity, event: () => sim.activeTaskEvent,
        ...(options.fault ? { faults: options.fault } : {}) });
      const runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db,
        resolve: () => ({ id: "service", version: "1", endpoints: {}, consumers: {}, background }),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
      schedule(runtime, setup);
      setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    });
  return { sim, get db() { return db; } };
}
const work = (runtime: DeterministicServiceRuntime, setup: { schedule: (draft: { time: ReturnType<typeof simulationTime>; type: string; payload: { name: string; data: null } }) => unknown }, name: string, time: number) =>
  setup.schedule({ time: simulationTime(time), type: runtime.backgroundEventType, payload: { name, data: null } });

test("read-your-writes, sorted scans, detached projections and atomic outbox commit", async () => {
  const seen: unknown[] = [];
  const run = fixture({ save: function* (_, ctx): ControlledTask {
    const tx = ctx.db!.begin();
    tx.insert("stock", "z", { sku: "z", available: 1 });
    tx.update("stock", "a", { sku: "a", available: 1 });
    tx.delete("stock", "b");
    tx.insert("outbox", "m", { kind: "reserved" });
    seen.push(tx.scan("stock").map(item => item.key));
    seen.push(tx.get("stock", "b"));
    yield tx.commit();
  } }, (runtime, setup) => work(runtime, setup, "save", 1));
  await run.sim.run();
  assert.deepEqual(seen, [["a", "z"], undefined]);
  assert.deepEqual(Object.keys(run.db.inspect().tables.stock!), ["a", "z"]);
  assert.equal(JSON.stringify(run.db.inspect().tables.outbox!.m), JSON.stringify({ kind: "reserved" }));
  assert.equal(run.db.revision, 1);
  assert.equal(run.sim.history.query({ type: "database.transaction.committed" }).length, 1);
  assert.equal(run.sim.history.query({ type: "database.write.staged" }).length, 4);
  assert.equal(run.sim.history.query({ type: "database.row.read" }).length, 2);
});

test("competing snapshots conflict across unrelated rows and read-only commits", async () => {
  const failures: string[] = [];
  const run = fixture({
    slow: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 8 });
      yield ctx.clock.sleep(duration(3)); try { yield tx.commit(); } catch (error) { failures.push((error as { code: string }).code); } },
    fast: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "b", { sku: "b", available: 9 }); yield tx.commit(); },
  }, (runtime, setup) => { work(runtime, setup, "slow", 1); work(runtime, setup, "fast", 2); });
  await run.sim.run();
  assert.deepEqual(failures, ["TRANSACTION_CONFLICT"]);
  assert.equal(run.db.inspect().tables.stock!.a!.available, 2);
  assert.equal(run.db.inspect().tables.stock!.b!.available, 9);
  assert.equal(run.db.revision, 1);
});

test("constraints, injected failure, and rollback leave committed state intact", async () => {
  const failures: string[] = [];
  const fault: FaultDecisionPort = { evaluate: () => ({ ruleIds: [], extraDelay: duration(0), drop: false, additionalCopies: 0, copySpacing: duration(0), fail: true }) };
  const run = fixture({
    fail: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 1 });
      try { yield tx.commit(); } catch (error) { failures.push((error as { code: string }).code); } },
    rollback: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.delete("stock", "a"); tx.rollback(); tx.rollback(); },
  }, (runtime, setup) => { work(runtime, setup, "fail", 1); work(runtime, setup, "rollback", 2); }, { fault });
  await run.sim.run();
  assert.deepEqual(failures, ["COMMIT_FAILED"]);
  assert.equal(run.db.inspect().tables.stock!.a!.available, 2);
  assert.equal(run.db.revision, 0);
});

test("task exit and crash discard open work while a dispatched commit survives", async () => {
  const run = fixture({
    open: function* (_, ctx): ControlledTask { ctx.db!.begin().update("stock", "a", { sku: "a", available: 9 }); },
    save: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "b", { sku: "b", available: 8 }); yield tx.commit(); },
    sleeping: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 7 }); yield ctx.clock.sleep(duration(10)); },
  }, (runtime, setup) => {
    work(runtime, setup, "open", 1); work(runtime, setup, "save", 2); work(runtime, setup, "sleeping", 3);
    setup.schedule({ time: simulationTime(4), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
  });
  await run.sim.run();
  assert.equal(run.db.inspect().tables.stock!.a!.available, 2);
  assert.equal(run.db.inspect().tables.stock!.b!.available, 8);
  assert.equal(run.db.revision, 1);
});

test("reset restores state, counters, and history on replay", async () => {
  let latest!: DeterministicDatabase;
  const factory = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } });
  const sim = factory.createSimulation(inputs, setup => {
    latest = new DeterministicDatabase({ definition, checks: { nonnegative: row => (row.available as number) >= 0 }, setup,
      clock: { now: () => sim.time }, schedule: (type, payload) => sim.scheduleStorage(type, payload),
      operations: { create: () => sim.operations.create(), complete: (id, outcome) => sim.operations.complete(id, outcome) },
        observations: { record: input => sim.storageObservations.record(input) }, task: () => sim.activeTaskIdentity, event: () => sim.activeTaskEvent });
    const runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db: latest, events,
      resolve: () => ({ id: "service", version: "1", endpoints: {}, consumers: {}, background: { save: function* (_, ctx): ControlledTask {
        const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 1 }); yield tx.commit();
      } } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    work(runtime, setup, "save", 1);
  });
  await sim.run(); const history = sim.history.export(); const previous = latest;
  await sim.reset(); await sim.run();
  assert.notEqual(latest, previous);
  assert.deepEqual(sim.history.export(), history);
  assert.deepEqual(latest.inspect(), previous.inspect());
});

test("unique and check failures reject the entire candidate without partial writes", async () => {
  const errors: string[] = [];
  const run = fixture({
    duplicate: function* (_, ctx): ControlledTask {
      const tx = ctx.db!.begin(); tx.insert("outbox", "m1", { kind: "created" }); tx.insert("stock", "c", { sku: "a", available: 1 });
      try { yield tx.commit(); } catch (error) { errors.push((error as { code: string }).code); }
    },
    negative: function* (_, ctx): ControlledTask {
      const tx = ctx.db!.begin(); tx.insert("outbox", "m2", { kind: "created" }); tx.update("stock", "a", { sku: "a", available: -1 });
      try { yield tx.commit(); } catch (error) { errors.push((error as { code: string }).code); }
    },
  }, (runtime, setup) => { work(runtime, setup, "duplicate", 1); work(runtime, setup, "negative", 2); });
  await run.sim.run();
  assert.deepEqual(errors, ["CONSTRAINT_VIOLATION", "CONSTRAINT_VIOLATION"]);
  assert.deepEqual(Object.keys(run.db.inspect().tables.outbox!), []);
  assert.equal(run.db.revision, 0);
  assert.equal(run.sim.history.query({ type: "database.transaction.rejected" }).length, 2);
});

test("invalid operations and a stale transaction cannot modify committed data", async () => {
  let saved: ReturnType<NonNullable<Parameters<Background[string]>[1]["db"]>["begin"]> | undefined;
  const errors: string[] = [];
  const run = fixture({
    save: function* (_, ctx): ControlledTask {
      const tx = ctx.db!.begin(); saved = tx;
      assert.equal(tx.delete("stock", "missing"), false);
      try { tx.insert("stock", "a", { sku: "a", available: 9 }); } catch (error) { errors.push((error as { code: string }).code); }
      try { tx.update("stock", "missing", { sku: "missing", available: 9 }); } catch (error) { errors.push((error as { code: string }).code); }
      tx.rollback();
    },
  }, (runtime, setup) => work(runtime, setup, "save", 1));
  await run.sim.run();
  assert.deepEqual(errors, ["ROW_EXISTS", "ROW_NOT_FOUND"]);
  assert.throws(() => saved!.insert("stock", "c", { sku: "c", available: 1 }), { code: "INVALID_OPERATION" });
  assert.equal(run.db.inspect().tables.stock!.c, undefined);
});

test("post-commit observation failure seals run and preserves the committed row", async () => {
  const run = fixture({ save: function* (_, ctx): ControlledTask {
    const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 1 }); yield tx.commit();
  } }, (runtime, setup) => work(runtime, setup, "save", 1), { history: options => {
    const history = new ExecutionHistory(options);
    const record = history.record.bind(history);
    history.record = input => {
      if (input.type === "database.transaction.committed") throwSimulationError("HISTORY_LIMIT_EXCEEDED");
      return record(input);
    };
    return history;
  } });
  await assert.rejects(run.sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(run.db.inspect().tables.stock!.a!.available, 1);
  assert.equal(run.db.revision, 1);
  assert.equal(run.sim.status, "FAILED");
});

test("read-only snapshot conflicts after a different task commits", async () => {
  const errors: string[] = [];
  const run = fixture({
    reader: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.get("stock", "a"); yield ctx.clock.sleep(duration(3));
      try { yield tx.commit(); } catch (error) { errors.push((error as { code: string }).code); } },
    writer: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "b", { sku: "b", available: 1 }); yield tx.commit(); },
  }, (runtime, setup) => { work(runtime, setup, "reader", 1); work(runtime, setup, "writer", 2); });
  await run.sim.run();
  assert.deepEqual(errors, ["TRANSACTION_CONFLICT"]);
  assert.equal(run.db.revision, 1);
});

test("crash before a pending commit event discards it", async () => {
  const run = fixture({ save: function* (_, ctx): ControlledTask { const tx = ctx.db!.begin(); tx.update("stock", "a", { sku: "a", available: 1 }); yield tx.commit(); } },
    (runtime, setup) => {
      work(runtime, setup, "save", 1);
      setup.schedule({ time: simulationTime(1), type: runtime.lifecycleEventType, payload: { next: "CRASHED" } });
    });
  await run.sim.run();
  assert.equal(run.db.inspect().tables.stock!.a!.available, 2);
  assert.equal(run.db.revision, 0);
});

test("invalid definitions and nonboolean checks fail before an invalid state is published", () => {
  const construct = (dbDefinition: DatabaseDefinition, checks: Record<string, (row: never) => unknown>) => new DeterministicDatabase({
    definition: dbDefinition, checks: checks as never,
    setup: { registerHandler: () => {}, registerObservationSchema: () => {} }, clock: { now: () => simulationTime(0) },
    schedule: () => {}, operations: { create: () => ({ operationId: "unused" }), complete: () => {} },
    observations: { record: () => { throw new Error("unused"); } }, task: () => undefined, event: () => undefined,
  });
  assert.throws(() => construct({ ...definition, tables: [definition.tables[0]!, definition.tables[0]!] }, { nonnegative: () => true }), { code: "INVALID_DATABASE_OPERATION" });
  assert.throws(() => construct({ ...definition, initial: { stock: { a: { sku: "a", available: -1 } } } }, { nonnegative: row => (row as { available: number }).available >= 0 }), { code: "CONSTRAINT_VIOLATION" });
  assert.throws(() => construct(definition, { nonnegative: () => "yes" }), { code: "INVALID_DATABASE_OPERATION" });
});

test("a foreign controlled task cannot begin against the service database", async () => {
  let database!: DeterministicDatabase;
  const run = fixture({}, (_runtime, setup) => {
    setup.registerHandler("client.try-database", "client", function* (): ControlledTask { database.begin(); });
    setup.schedule({ time: simulationTime(1), type: "client.try-database", payload: null });
  });
  database = run.db;
  await assert.rejects(run.sim.run(), { code: "INVALID_DATABASE_OPERATION" });
  assert.equal(run.db.revision, 0);
});

test("a synchronous service handler can read and its open writes roll back on exit", async () => {
  const seen: unknown[] = [];
  const run = fixture({ inspect: (_, ctx) => {
    const tx = ctx.db!.begin(); seen.push(tx.get("stock", "a")?.available);
    tx.update("stock", "a", { sku: "a", available: 0 });
  } }, (runtime, setup) => work(runtime, setup, "inspect", 1));
  await run.sim.run();
  assert.deepEqual(seen, [2]);
  assert.equal(run.db.inspect().tables.stock!.a!.available, 2);
  assert.equal(run.sim.history.query({ type: "database.transaction.rolledback" }).length, 1);
});

test("commit keeps every staged row when names contain U+0000", async () => {
  const delimited: DatabaseDefinition = { owner: "service", tables: [
    { name: "a", unique: [], checks: [] },
    { name: "a\u0000b", unique: [], checks: [] },
  ], initial: { a: {}, "a\u0000b": {} } };
  let db!: DeterministicDatabase;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service"], links: [] } }).createSimulation(inputs, setup => {
    db = new DeterministicDatabase({ definition: delimited, checks: {}, setup, clock: { now: () => sim.time },
      schedule: (type, payload) => sim.scheduleStorage(type, payload),
      operations: { create: () => sim.operations.create(), complete: (id, outcome) => sim.operations.complete(id, outcome) },
      observations: { record: input => sim.storageObservations.record(input) }, task: () => sim.activeTaskIdentity, event: () => sim.activeTaskEvent });
    const runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db, events,
      resolve: () => ({ id: "service", version: "1", endpoints: {}, consumers: {}, background: { save: function* (_, ctx): ControlledTask {
        const tx = ctx.db!.begin();
        tx.insert("a", "b\u0000c", { v: 1 });
        tx.insert("a\u0000b", "c", { v: 2 });
        yield tx.commit();
      } } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner });
    setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
    work(runtime, setup, "save", 1);
  });
  await sim.run();
  assert.equal(db.inspect().tables.a!["b\u0000c"]!.v, 1);
  assert.equal(db.inspect().tables["a\u0000b"]!.c!.v, 2);
  assert.equal(db.revision, 1);
});

test("a transaction started after sleep keeps the task correlation", async () => {
  const sim = new HeadlessSimulationFactory({ network: { targets: ["service", "client"], links: [{ source: "client", target: "service" }] } })
    .createSimulation(inputs, setup => {
      const db = new DeterministicDatabase({ definition, checks: { nonnegative: row => typeof row.available === "number" && row.available >= 0 },
        setup, clock: { now: () => sim.time }, schedule: (type, payload) => sim.scheduleStorage(type, payload),
        operations: { create: () => sim.operations.create(), complete: (id, outcome) => sim.operations.complete(id, outcome) },
        observations: { record: input => sim.storageObservations.record(input) }, task: () => sim.activeTaskIdentity, event: () => sim.activeTaskEvent });
      const client = setup.networkFor("client");
      const runtime = new DeterministicServiceRuntime({ id: "service", version: "1", setup, db, events,
        resolve: () => ({ id: "service", version: "1", consumers: {}, background: {}, endpoints: {
          save: function* (_body, ctx) {
            yield ctx.clock.sleep(duration(1));
            const tx = ctx.db!.begin();
            tx.update("stock", "a", { sku: "a", available: 1 });
            tx.get("stock", "a");
            yield tx.commit();
            return { status: "ok", body: null };
          },
        } }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner });
      setup.registerHandler("client.call", "client", function* (): ControlledTask { yield client.request({ target: "service", endpoint: "save", body: null }); });
      setup.schedule({ time: simulationTime(0), type: runtime.lifecycleEventType, payload: { next: "RUNNING" } });
      setup.schedule({ time: simulationTime(1), type: "client.call", payload: null });
    });
  await sim.run();
  const started = sim.history.query({ type: "service.handler.started" })[0];
  const begun = sim.history.query({ type: "database.transaction.begun" })[0];
  const read = sim.history.query({ type: "database.row.read" }).at(-1);
  const committed = sim.history.query({ type: "database.transaction.committed" })[0];
  for (const record of [begun, read, committed]) {
    assert.equal(record?.traceId, started?.traceId);
    assert.equal(record?.spanId, started?.spanId);
    assert.equal(record?.causationId, started?.causationId);
  }
  assert.equal(begun?.eventId, started?.eventId);
  assert.notEqual(committed?.eventId, started?.eventId);
});
