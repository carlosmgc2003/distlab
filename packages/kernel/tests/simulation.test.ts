import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGolden01, golden01Result } from "../examples/golden-01.ts";
import { HeadlessSimulationFactory, SeededRandom, canonicalEncode } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs, SimulationSetup } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1" }, architecture: {}, scenario: {}, configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "distlab" };
const factory = new HeadlessSimulationFactory();
test("golden 01: fresh, reset, continuous, stepping, and per-boundary resume match canonical output", async () => {
  const continuous = createGolden01();
  const fresh = createGolden01();
  const stepped = createGolden01();
  const bounded = createGolden01();
  const initial = golden01Result(continuous);
  assert.deepEqual(golden01Result(fresh), initial);
  assert.equal((await continuous.simulation.run()).processedEvents, 4);
  assert.equal((await fresh.simulation.run({ maxEventsPerYield: 1 })).processedEvents, 4);
  const sequences: number[] = [];
  while (stepped.simulation.status !== "COMPLETED") {
    const step = await stepped.simulation.step();
    if (step) sequences.push(step.sequence);
  }
  assert.deepEqual(sequences, [0, 1, 2, 3]);
  while (bounded.simulation.status !== "COMPLETED") {
    const result = await bounded.simulation.run({ maxEvents: 1, maxEventsPerYield: 1 });
    assert.equal(result.processedEvents, 1);
  }
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-01.expected.json", import.meta.url), "utf8")) as {
    digest: string; state: { order: string[]; draws: number[]; committed: number }; observationCount: number;
  };
  const result = golden01Result(continuous);
  assert.equal(result.digest, expected.digest);
  assert.equal(canonicalEncode(result.state), canonicalEncode(expected.state));
  assert.equal(result.history.observations.length, expected.observationCount);
  for (const another of [fresh, stepped, bounded]) assert.deepEqual(golden01Result(another), result);
  await continuous.simulation.reset();
  assert.deepEqual(golden01Result(continuous), initial);
  await continuous.simulation.run();
  assert.deepEqual(golden01Result(continuous), result);
});
test("golden 01 is executable headlessly as a standalone CLI", () => {
  const script = fileURLToPath(new URL("../examples/golden-01.ts", import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8" })) as ReturnType<typeof golden01Result>;
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-01.expected.json", import.meta.url), "utf8")) as { digest: string };
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.digest, expected.digest);
  assert.equal(result.history.terminalFailure, undefined);
});

test("equal-time wakeups resume in scheduler sequence, including zero-delay sleeps", async () => {
  const order: string[] = [];
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("a", "owner", function* (_, ctx) { order.push("a:start"); yield ctx.clock.sleep(duration(0)); order.push("a:wake"); });
    setup.registerHandler("b", "owner", function* (_, ctx) { order.push("b:start"); yield ctx.clock.sleep(duration(0)); order.push("b:wake"); });
    setup.schedule({ time: simulationTime(0), type: "a", payload: null });
    setup.schedule({ time: simulationTime(0), type: "b", payload: null });
  });
  const result = await sim.run();
  assert.equal(result.processedEvents, 4);
  assert.deepEqual(order, ["a:start", "b:start", "a:wake", "b:wake"]);
  assert.deepEqual(sim.history.query({ type: "clock.sleep.resumed" }).map(o => o.time), [simulationTime(0), simulationTime(0)]);
});

test("control options, locks, pause and stale setup", async () => {
  let setup!: SimulationSetup;
  const sim = factory.createSimulation(inputs, s => { setup = s; s.registerHandler("x", "a", () => {}); s.schedule({ time: simulationTime(0), type: "x", payload: {} }); s.schedule({ time: simulationTime(1), type: "x", payload: {} }); });
  assert.throws(() => setup.schedule({ time: simulationTime(0), type: "x", payload: {} }), { code: "STALE_CAPABILITY" });
  await assert.rejects(sim.run({ maxEvents: -1 }), { code: "INVALID_RUN_OPTIONS" });
  const pending = sim.run({ maxEventsPerYield: 1 });
  const competing = sim.step();
  sim.pause();
  await assert.rejects(competing, { code: "CONTROL_BUSY" });
  assert.equal((await pending).reason, "PAUSE_REQUESTED");
  assert.equal(sim.status, "PAUSED");
  assert.equal((await sim.step())?.sequence, 1);
  assert.equal(sim.status, "COMPLETED");
});
test("invalid yields, native promises and unawaited operations are terminal", async () => {
  for (const [handler, code] of [
    [function* () { yield { operationId: "fake" }; }, "INVALID_OPERATION"],
    [async () => { throw new Error("native rejection"); }, "UNCONTROLLED_ASYNC"],
  ] as const) {
    const sim = factory.createSimulation(inputs, s => { s.registerHandler("x", "a", handler as never); s.schedule({ time: simulationTime(0), type: "x", payload: {} }); });
    await assert.rejects(sim.run(), { code });
    assert.equal(sim.history.export().terminalFailure?.code, code);
    await assert.rejects(sim.step(), { code });
  }
  const sim = factory.createSimulation(inputs, s => { s.registerHandler("x", "a", function* () { sim.operations.create(); return; }); s.schedule({ time: simulationTime(0), type: "x", payload: {} }); });
  await assert.rejects(sim.run(), { code: "UNAWAITED_OPERATION" });
});
test("seed vectors and revoked random ports", async () => {
  const random = new SeededRandom("distlab");
  assert.deepEqual(Array.from({ length: 5 }, () => random.draw("test").uint32), [1629508329, 3786623983, 3349857114, 1564400182, 2109307711]);
  const second = new SeededRandom("mvp-response-lost-001");
  assert.deepEqual(Array.from({ length: 5 }, () => second.draw("test").uint32), [1848708011, 276145100, 3342336838, 2133524352, 2602090516]);
  const sim = createGolden01().simulation, port = sim.random;
  await sim.reset();
  assert.throws(() => port.draw("old"), { code: "STALE_CAPABILITY" });
});
