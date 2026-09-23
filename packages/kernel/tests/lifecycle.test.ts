import { test } from "node:test";
import assert from "node:assert/strict";
import { HeadlessSimulationFactory, DeterministicVirtualClock, DeterministicScheduler, ExecutionHistory, SeededRandom } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs, BoundaryReadHook } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1" }, architecture: {}, scenario: {}, configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "distlab" };

test("boundary hooks are per-attempt, observe completion before its record, and never run on pause", async () => {
  const calls: string[] = [];
  let constructed = 0;
  const factory = new HeadlessSimulationFactory({ createBoundaryHook: (history): BoundaryReadHook => {
    constructed++;
    return { afterInitialization: () => calls.push(`init:${history.all().length}`), afterEvent: event => calls.push(`event:${event.sequence}`), onCompletion: () => {
      assert.equal(history.all().some(item => item.type === "simulation.completed"), false);
      calls.push("completion");
    }, onFailure: () => calls.push("failure") };
  } });
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => {});
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
    setup.schedule({ time: simulationTime(1), type: "x", payload: null });
  });
  assert.deepEqual(calls, ["init:3"]);
  assert.equal((await sim.run({ maxEvents: 1 })).reason, "EVENT_LIMIT");
  assert.deepEqual(calls, ["init:3", "event:0"]);
  await sim.run();
  assert.deepEqual(calls, ["init:3", "event:0", "event:1", "completion"]);
  await sim.reset();
  assert.equal(constructed, 2);
  assert.equal(calls.at(-1), "init:3");
});

test("factory rebuilds all injected ports on reset", async () => {
  const built: string[] = [];
  const factory = new HeadlessSimulationFactory({
    createClock: options => { built.push("clock"); return new DeterministicVirtualClock(options); },
    createHistory: options => { built.push("history"); return new ExecutionHistory(options); },
    createScheduler: options => { built.push("scheduler"); return new DeterministicScheduler(options); },
    createRandom: seed => { built.push("random"); return new SeededRandom(seed); },
  });
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => {});
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  const prefix = sim.history.export();
  const oldRandom = sim.random;
  await sim.reset();
  assert.deepEqual(built, ["random", "clock", "history", "scheduler", "random", "clock", "history", "scheduler"]);
  assert.deepEqual(sim.history.export(), prefix);
  assert.throws(() => oldRandom.draw("stale"), { code: "STALE_CAPABILITY" });
});

test("hook failure is terminal, notified once, and does not append completed", async () => {
  let failures = 0;
  const sim = new HeadlessSimulationFactory({ createBoundaryHook: () => ({
    afterInitialization() {}, afterEvent() {}, onCompletion() { throw new Error("host diagnostic"); }, onFailure() { failures++; },
  }) }).createSimulation(inputs, () => {});
  await assert.rejects(sim.run(), { code: "HANDLER_FAILED" });
  assert.equal(failures, 1);
  assert.equal(sim.history.query({ type: "simulation.completed" }).length, 0);
  assert.equal(sim.history.export().terminalFailure?.code, "HANDLER_FAILED");
});

test("abandonment cancels local wakes without running finally and leaves unrelated work", async () => {
  const output: string[] = [];
  const sim = new HeadlessSimulationFactory().createSimulation(inputs, setup => {
    setup.registerHandler("sleep", "a", function* (_, ctx) {
      try { yield ctx.clock.sleep(duration(10)); output.push("resumed"); }
      finally { output.push("cleanup"); }
    });
    setup.registerHandler("crash", "a", () => sim.taskLifecycle.abandon("a", 0));
    setup.registerHandler("other", "b", () => { output.push("other"); });
    setup.schedule({ time: simulationTime(0), type: "sleep", payload: null });
    setup.schedule({ time: simulationTime(1), type: "crash", payload: null });
    setup.schedule({ time: simulationTime(2), type: "other", payload: null });
  });
  await sim.run();
  assert.deepEqual(output, ["other"]);
  assert.equal(sim.time, 2);
  assert.equal(sim.history.query({ type: "clock.sleep.resumed" }).length, 0);
  assert.equal(sim.history.query({ type: "scheduler.event.cancelled" }).length, 1);
});

test("abandoned operation completes inertly and next process generation is isolated", async () => {
  let operationId = "";
  let continued = false;
  const sim = new HeadlessSimulationFactory().createSimulation(inputs, setup => {
    setup.registerHandler("first", "a", function* () {
      const operation = sim.operations.create(); operationId = operation.operationId;
      yield operation; continued = true;
    });
    setup.registerHandler("crash", "a", () => sim.taskLifecycle.abandon("a", 0));
    setup.registerHandler("late", "a", () => sim.operations.complete(operationId, { kind: "success", value: null }));
    setup.registerHandler("second", "a", function* (_, ctx) { yield ctx.clock.sleep(duration(1)); continued = true; });
    setup.schedule({ time: simulationTime(0), type: "first", payload: null });
    setup.schedule({ time: simulationTime(1), type: "crash", payload: null });
    setup.schedule({ time: simulationTime(2), type: "late", payload: null });
    setup.schedule({ time: simulationTime(3), type: "second", payload: null });
  });
  await sim.run();
  assert.equal(continued, true);
  assert.equal(sim.time, 4);
  assert.equal(sim.history.query({ type: "simulation.event.completed" }).filter(o => o.data && typeof o.data === "object" && !Array.isArray(o.data) && "type" in o.data && o.data.type === "first").length, 0);
});

test("host yielding permits macrotask pause only at boundaries without changing history", async () => {
  const factory = new HeadlessSimulationFactory();
  function fixture() { return factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", (_, ctx) => { ctx.schedule({ type: "x", payload: null }); });
    setup.registerHandler("stop", "a", () => {});
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  }); }
  const sim = fixture();
  const run = sim.run({ maxEventsPerYield: 1 });
  await new Promise<void>(resolve => setImmediate(resolve));
  sim.pause();
  const result = await run;
  assert.equal(result.reason, "PAUSE_REQUESTED");
  assert.ok(result.processedEvents > 0);
  assert.equal(sim.status, "PAUSED");
});
