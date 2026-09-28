import assert from "node:assert/strict";
import test from "node:test";
import { HeadlessSimulationFactory } from "@distlab/kernel";
import { simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {}, seed: "counters", configuration: { startTime: simulationTime(0), historyLimit: 1000, models: {}, visibility: { defaultMode: "omitted", byType: {}, summaryFields: {} } } };
test("boundary counters count dispatch, cancellation and random draws independently of history; reset restores them", async () => {
  const sim = new HeadlessSimulationFactory().createSimulation(inputs, setup => {
    setup.registerHandler("draw", "owner", () => { sim.random.draw("one"); });
    setup.schedule({ type: "draw", time: simulationTime(0), payload: null });
    setup.schedule({ type: "draw", time: simulationTime(1), payload: null });
    setup.schedule({ type: "draw", time: simulationTime(2), payload: null }).cancel();
  });
  const counts = () => [sim.pendingEvents, sim.processedEvents, sim.randomDrawCount];
  assert.deepEqual(counts(), [2, 0, 0]);
  const before = sim.history.export();
  counts(); counts();
  assert.deepEqual(sim.history.export(), before);
  await sim.step();
  assert.deepEqual(counts(), [1, 1, 1]);
  await sim.run();
  assert.deepEqual(counts(), [0, 2, 2]);
  assert.ok(sim.history.query({ type: "scheduler.event.dispatched" }).every(event => event.data === undefined));
  await sim.reset();
  assert.deepEqual(counts(), [2, 0, 0]);
});
test("a failing dispatched handler is counted without changing run-result semantics", async () => {
  const sim = new HeadlessSimulationFactory().createSimulation(inputs, setup => {
    setup.registerHandler("fail", "owner", () => { throw new Error("fixture"); });
    setup.schedule({ type: "fail", time: simulationTime(0), payload: null });
  });
  await assert.rejects(sim.run());
  assert.equal(sim.processedEvents, 1);
  assert.equal(sim.pendingEvents, 0);
});
