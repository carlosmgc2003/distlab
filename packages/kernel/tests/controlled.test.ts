import { test } from "node:test";
import assert from "node:assert/strict";
import { HeadlessSimulationFactory } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs, HandlerContext, ScheduledHandle } from "@distlab/contracts/kernel";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1" }, architecture: {}, scenario: {}, configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "distlab" };
const factory = new HeadlessSimulationFactory();
test("operation creation is single-outstanding and dispatch-only completion", async () => {
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", function* () { sim.operations.create(); sim.operations.create(); });
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  await assert.rejects(sim.run(), { code: "INVALID_OPERATION" });
  const outside = factory.createSimulation(inputs, () => {});
  assert.throws(() => outside.operations.complete("unknown", { kind: "success", value: null }), { code: "INVALID_OPERATION" });
  assert.equal(outside.status, "FAILED");
});

test("modeled operation failure is caught; completion happens at a later event", async () => {
  const output: string[] = [];
  let id = "";
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("request", "service", function* () {
      id = sim.operations.create().operationId;
      try { yield { operationId: id } as never; } catch (error) { output.push((error as { code: string }).code); }
    });
    setup.registerHandler("finish", "service", () => sim.operations.complete(id, { kind: "failure", error: { code: "NETWORK_TIMEOUT", context: null } }));
    setup.schedule({ time: simulationTime(0), type: "request", payload: null });
    setup.schedule({ time: simulationTime(1), type: "finish", payload: null });
  });
  // A handle is opaque by identity: yielding a forged handle is invalid.
  await assert.rejects(sim.run(), { code: "INVALID_OPERATION" });
  assert.deepEqual(output, []);
});
test("trusted completion delivers modeled failure and late completion is inert", async () => {
  const output: string[] = [];
  let id = "";
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("request", "service", function* () {
      const operation = sim.operations.create(); id = operation.operationId;
      try { yield operation; } catch (error) { output.push((error as { code: string }).code); }
    });
    setup.registerHandler("finish", "service", () => {
      sim.operations.complete(id, { kind: "failure", error: { code: "NETWORK_TIMEOUT", context: null } });
      sim.operations.complete(id, { kind: "success", value: null });
    });
    setup.schedule({ time: simulationTime(0), type: "request", payload: null });
    setup.schedule({ time: simulationTime(1), type: "finish", payload: null });
  });
  await sim.run();
  assert.deepEqual(output, ["NETWORK_TIMEOUT"]);
});
test("modeled timeout can schedule retry without undoing committed work", async () => {
  const committed: string[] = [];
  let pending = "";
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("start", "payments", function* (_, ctx) {
      committed.push("before-timeout");
      const operation = sim.operations.create(); pending = operation.operationId;
      try { yield operation; }
      catch (error) {
        assert.equal((error as { code: string }).code, "NETWORK_TIMEOUT");
        ctx.schedule({ type: "retry", payload: null });
      }
    });
    setup.registerHandler("timeout", "payments", () => sim.operations.complete(pending, { kind: "failure", error: { code: "NETWORK_TIMEOUT", context: null } }));
    setup.registerHandler("retry", "payments", () => { committed.push("retried"); });
    setup.registerHandler("other-service", "other", () => { committed.push("other-service"); });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
    setup.schedule({ time: simulationTime(1), type: "timeout", payload: null });
    setup.schedule({ time: simulationTime(2), type: "other-service", payload: null });
  });
  await sim.run();
  assert.deepEqual(committed, ["before-timeout", "retried", "other-service"]);
  assert.equal(sim.history.export().terminalFailure, undefined);
});

test("empty queue with waiting tasks deadlocks; unhandled capability failure latches even when caught", async () => {
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("request", "service", function* () { yield sim.operations.create(); });
    setup.schedule({ time: simulationTime(0), type: "request", payload: null });
  });
  await assert.rejects(sim.run(), { code: "SIMULATION_DEADLOCK" });
  const caught = factory.createSimulation(inputs, setup => {
    setup.registerHandler("request", "service", (_, ctx) => { try { ctx.clock.sleep(duration(1)); } catch {} });
    setup.schedule({ time: simulationTime(0), type: "request", payload: null });
  });
  await assert.rejects(caught.run(), { code: "NO_ACTIVE_TASK" });
  assert.equal(caught.history.export().terminalFailure?.historyComplete, true);
});
test("handler capabilities cannot impersonate a different owner or reserve kernel types", async () => {
  const actions: { action: (ctx: HandlerContext) => unknown; code: string }[] = [
    { action: ctx => ctx.schedule({ type: "other", payload: null }), code: "INVALID_EVENT_TYPE" },
    { action: ctx => ctx.observations.record({ type: "model.work", source: "b" }), code: "INVALID_OBSERVATION" },
  ];
  for (const { action, code } of actions) {
    const sim = factory.createSimulation(inputs, setup => {
      setup.registerObservationSchema("model.work", () => true);
      setup.registerHandler("x", "a", (_, ctx) => { try { action(ctx); } catch {} });
      setup.registerHandler("other", "b", () => {});
      setup.schedule({ time: simulationTime(0), type: "x", payload: null });
    });
    await assert.rejects(sim.run(), { code });
  }
  assert.throws(() => factory.createSimulation(inputs, setup => setup.registerHandler("kernel.sleep.wake", "a", () => {})), { code: "INVALID_REGISTRATION" });
});
test("history exhaustion is terminal even when a handler catches the exception", async () => {
  const limited: RunInputs = { ...inputs, configuration: { ...inputs.configuration, historyLimit: 4 } };
  const sim = factory.createSimulation(limited, setup => {
    setup.registerHandler("x", "a", (_, ctx) => { try { ctx.observations.record({ type: "custom.work", source: "a" }); } catch {} });
    setup.registerObservationSchema("custom.work", () => true);
    setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  await assert.rejects(sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(sim.history.export().terminalFailure?.historyComplete, false);
  assert.equal(sim.history.export().terminalFailure?.code, "HISTORY_LIMIT_EXCEEDED");
});
test("reset revokes old handler clock and regenerates the prefix", async () => {
  let old: HandlerContext | undefined;
  let handle: ScheduledHandle | undefined;
  const sim = factory.createSimulation(inputs, setup => {
    setup.registerHandler("x", "a", (_, ctx) => { old = ctx; });
    handle = setup.schedule({ time: simulationTime(0), type: "x", payload: null });
  });
  const prefix = sim.history.export();
  await sim.step();
  const oldHandle = handle!;
  await sim.reset();
  assert.deepEqual(sim.history.export(), prefix);
  assert.throws(() => old!.clock.now(), { code: "STALE_CAPABILITY" });
  assert.throws(() => oldHandle.cancel(), { code: "STALE_CAPABILITY" });
});
