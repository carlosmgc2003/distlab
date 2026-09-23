import { test } from "node:test";
import assert from "node:assert/strict";
import { HeadlessSimulationFactory } from "@distlab/kernel";
import { simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs, SimulationSetup } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1" }, architecture: {}, scenario: {}, configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "distlab" };
const factory = new HeadlessSimulationFactory();
test("construction validates normalized canonical inputs before returning a run", () => {
  for (const bad of [
    { ...inputs, seed: "  " },
    { ...inputs, modelVersions: { invalid: "  " } },
    { ...inputs, configuration: { ...inputs.configuration, historyLimit: 0 } },
    { ...inputs, scenario: { invalid: Number.NaN } },
  ]) assert.throws(() => factory.createSimulation(bad as RunInputs, () => {}), { code: "INVALID_RUN_INPUT" });
  const a = factory.createSimulation(inputs, () => {});
  const b = factory.createSimulation({ ...inputs, seed: "  distlab  " }, () => {});
  assert.equal(a.history.export().runId, b.history.export().runId);
});

test("lifecycle: ready, empty, completed, reset, and failed controls", async () => {
  const empty = factory.createSimulation(inputs, () => {});
  empty.pause(); assert.equal(empty.status, "READY");
  assert.equal(await empty.step(), undefined);
  assert.equal(empty.status, "COMPLETED");
  assert.deepEqual(await empty.run(), { status: "COMPLETED", reason: "EMPTY", time: simulationTime(0), processedEvents: 0, totalEvents: 0 });
  empty.pause(); assert.equal(empty.status, "COMPLETED");
  await empty.reset(); assert.equal(empty.status, "READY");

  let throwOnce = true;
  const failed = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => { if (throwOnce) { throwOnce = false; throw new Error("diagnostic"); } });
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  await assert.rejects(failed.step(), { code: "HANDLER_FAILED" });
  assert.equal(failed.history.query({ type: "simulation.event.failed" }).length, 1);
  assert.equal(failed.history.query({ type: "simulation.failed" }).length, 1);
  assert.equal(failed.history.export().terminalFailure?.historyComplete, true);
  failed.pause(); assert.equal(failed.status, "FAILED");
  await assert.rejects(failed.step(), { code: "HANDLER_FAILED" });
  await assert.rejects(failed.run({ maxEvents: -1 }), { code: "HANDLER_FAILED" });
  await failed.reset(); assert.equal(failed.status, "READY");
  assert.equal((await failed.run()).status, "COMPLETED");
});
test("malformed thrown error becomes a sealed deterministic handler failure", async () => {
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => { throw { code: "BAD", context: { invalid: undefined } }; });
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  await assert.rejects(sim.run(), { code: "HANDLER_FAILED" });
  assert.equal(sim.history.export().terminalFailure?.code, "HANDLER_FAILED");
});

test("limits, options, counters, pause precedence, and control lock", async () => {
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => {});
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
    setup.schedule({ time: simulationTime(1), type: "x", payload: null });
  });
  for (const options of [{ maxEvents: -1 }, { maxEvents: Number.MAX_SAFE_INTEGER + 1 }, { maxEventsPerYield: 0 }, { maxEventsPerYield: 1.5 }, { maxEvents: null }, { unknown: 1 }]) {
    await assert.rejects(sim.run(options as never), { code: "INVALID_RUN_OPTIONS" });
    assert.equal(sim.status, "READY");
  }
  assert.deepEqual(await sim.run({ maxEvents: 0 }), { status: "PAUSED", reason: "EVENT_LIMIT", time: simulationTime(0), processedEvents: 0, totalEvents: 0 });
  const promise = sim.run({ maxEventsPerYield: 1 });
  const conflict = sim.reset();
  sim.pause();
  await assert.rejects(conflict, { code: "CONTROL_BUSY" });
  assert.deepEqual(await promise, { status: "PAUSED", reason: "PAUSE_REQUESTED", time: simulationTime(0), processedEvents: 1, totalEvents: 1 });
  assert.equal((await sim.run({ maxEvents: 1 })).status, "COMPLETED");
  assert.equal((await sim.run()).totalEvents, 2);
});
test("pause requested inside a handler takes effect after that boundary", async () => {
  const order: string[] = [];
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("first", "a", () => { order.push("first"); sim.pause(); });
    setup.registerHandler("second", "a", () => { order.push("second"); });
    setup.schedule({ time: simulationTime(0), type: "first", payload: null });
    setup.schedule({ time: simulationTime(0), type: "second", payload: null });
  });
  assert.deepEqual(await sim.run(), { status: "PAUSED", reason: "PAUSE_REQUESTED", time: simulationTime(0), processedEvents: 1, totalEvents: 1 });
  assert.deepEqual(order, ["first"]);
  await sim.run();
  assert.deepEqual(order, ["first", "second"]);
});

test("registration seals at first schedule; reset failure is latched", async () => {
  assert.throws(() => factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => {});
    setup.registerHandler("x", "a", () => {});
  }), { code: "INVALID_REGISTRATION" });
  assert.throws(() => factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", () => {});
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
    setup.registerHandler("y", "a", () => {});
  }), { code: "INVALID_REGISTRATION" });
  let setup!: SimulationSetup;
  let resetFails = false;
  const sim = factory.createSimulation(inputs, s => {
    setup = s;
    s.registerHandler("x", "a", () => {});
    s.schedule({ time: simulationTime(0), type: "x", payload: null });
    if (resetFails) throw new Error("setup failure");
  });
  assert.throws(() => setup.registerHandler("y", "a", () => {}), { code: "STALE_CAPABILITY" });
  resetFails = true;
  await assert.rejects(sim.reset(), { code: "INITIALIZATION_FAILED" });
  assert.equal(sim.status, "FAILED");
  assert.equal(sim.history.export().terminalFailure?.code, "INITIALIZATION_FAILED");
  await assert.rejects(sim.run(), { code: "INITIALIZATION_FAILED" });
});
