import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { isWorkerEvent } from "../src/protocol.ts";

test("real worker loads ScenarioEngine, steps, resets and reproduces the headless checkout fixture", async t => {
  const worker = new Worker(new URL("./worker-thread.ts", import.meta.url));
  t.after(() => worker.terminate());
  const events: WorkerEvent[] = [];
  worker.on("message", event => { assert.ok(isWorkerEvent(event)); events.push(event); });
  let sequence = 0;
  const send = (body: { type: "load"; scenario: CanonicalValue } | { type: "run"; maxEvents?: number } | { type: "step" | "reset" | "pause" }) => {
    const requestId = `test:${++sequence}`;
    return new Promise<WorkerEvent>((resolve, reject) => {
      const listener = (event: WorkerEvent) => {
        if (event.requestId !== requestId || event.type === "accepted") return;
        if (event.type === "projection.updated" && body.type === "run") return;
        worker.off("message", listener); worker.off("error", failure);
        if (event.type === "error") reject(event.error); else resolve(event);
      };
      const failure = (error: Error) => { worker.off("message", listener); reject(error); };
      worker.on("message", listener); worker.once("error", failure);
      worker.postMessage({ version: 1, requestId, ...body });
    });
  };
  const latest = (): RuntimeProjectionSet => {
    const event = events.filter(event => event.type === "loaded" || event.type === "projection.updated").at(-1);
    assert.ok(event && "projection" in event); return event.projection;
  };
  for (const scenario of [normalCheckout, responseLostCheckout]) {
    await send({ type: "load", scenario });
    const initial = latest();
    assert.equal(initial.simulation.status, "READY");
    assert.equal(initial.architecture.components.length, 5);
    assert.equal(initial.architecture.links.length, 3);
    assert.ok(initial.simulation.pendingEvents > 0);
    assert.equal(initial.simulation.processedEvents, 0);
    await send({ type: "step" });
    assert.equal(latest().simulation.processedEvents, 1);
    await send({ type: "reset" });
    assert.deepEqual(latest(), initial);
    await send({ type: "run", maxEvents: 2 });
    assert.equal(latest().simulation.status, "PAUSED");
    assert.equal(latest().simulation.processedEvents, 2);
    await send({ type: "pause" });
    assert.equal(latest().simulation.status, "PAUSED");
    await send({ type: "run" });
    const finished = latest();
    assert.equal(finished.simulation.status, "COMPLETED");
    assert.equal(finished.simulation.pendingEvents, 0);
    const headless = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }).create(scenario);
    const result = await headless.simulation.run();
    assert.equal(finished.simulation.processedEvents, result.totalEvents);
    assert.deepEqual(finished.history.observations, structuredClone(headless.simulation.history.all()));
    assert.deepEqual(Object.fromEntries(finished.components.filter(item => item.visibility === "host").map(item => [item.componentId, item.state])), structuredClone(headless.projection().components));
    assert.ok(headless.results().every(result => result.status === "PASS"));
    await send({ type: "reset" }); await send({ type: "run" });
    assert.deepEqual(latest(), finished);
    await send({ type: "reset" });
    assert.deepEqual(latest(), initial);
    while (latest().simulation.status !== "COMPLETED") {
      const previous = latest().simulation.processedEvents;
      await send({ type: "step" });
      assert.equal(latest().simulation.processedEvents, previous + 1);
    }
    assert.deepEqual(latest(), finished, "Run and repeated Step have identical canonical worker projections");
    assert.equal(initial.simulation.processedEvents, 0);
  }
});

test("worker rejects malformed commands and unsupported scenarios without a runnable partial session", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  await adapter.receive({ version: 2, requestId: "bad", type: "step" });
  assert.deepEqual(events.at(-1), { version: 1, requestId: "bad", type: "error", error: { code: "INVALID_WORKER_COMMAND", message: "Expected a version 1 worker command.", context: null } });
  await adapter.receive({ version: 1, requestId: "ok", type: "load", scenario: normalCheckout });
  for (const scenario of [{ version: 9 }, { ...(normalCheckout as object), seed: "changed" }]) {
    await adapter.receive({ version: 1, requestId: "load", type: "load", scenario });
    const failure = events.at(-1)!;
    assert.ok(failure.type === "error"); assert.equal(failure.error.code, "INVALID_SCENARIO");
    await adapter.receive({ version: 1, requestId: "step", type: "step" });
    const step = events.at(-1)!;
    assert.ok(step.type === "error"); assert.equal(step.error.code, "INVALID_WORKER_COMMAND");
  }
});

test("boundary pause is correlated and conflicting controls do not mutate a run", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: normalCheckout });
  const run = adapter.receive({ version: 1, requestId: "run", type: "run" });
  const reset = adapter.receive({ version: 1, requestId: "busy", type: "reset" });
  const pause = adapter.receive({ version: 1, requestId: "pause", type: "pause" });
  await Promise.all([run, reset, pause]);
  assert.ok(events.some(event => event.requestId === "busy" && event.type === "error" && event.error.code === "INVALID_WORKER_COMMAND"));
  assert.ok(events.some(event => event.requestId === "pause" && event.type === "projection.updated"));
  assert.ok(events.some(event => event.requestId === "run" && event.type === "run.finished" && event.status === "PAUSED"));
  const running = events.find(event => event.type === "projection.updated" && event.projection.simulation.status === "RUNNING");
  const paused = events.find(event => event.requestId === "pause" && event.type === "projection.updated");
  assert.ok(running?.type === "projection.updated" && paused?.type === "projection.updated");
  assert.equal(running.projection.simulation.processedEvents, 16);
  assert.equal(paused.projection.simulation.processedEvents, 16);
  assert.deepEqual(paused.projection.history, running.projection.history);
  await adapter.receive({ version: 1, requestId: "step", type: "step" });
  const stepped = events.at(-1);
  assert.ok(stepped?.type === "projection.updated");
  assert.equal(stepped.projection.simulation.processedEvents, 17);
});

test("terminal runtime failures return SIMULATION_FAILED with a failed boundary projection", async t => {
  const original = DeterministicScenarioEngine.prototype.create;
  // Inject a terminal model failure through the real engine, keeping the production adapter
  // free of test-only runtime ports and exercising the same kernel failure path.
  t.mock.method(DeterministicScenarioEngine.prototype, "create", function (this: DeterministicScenarioEngine, input: CanonicalValue) {
    return original.call(this, {
      ...(input as Record<string, CanonicalValue>),
      actions: [
        { id: "stop", at: 0, kind: "service", target: "orders", state: "STOPPED" },
        { id: "illegal", at: 1, kind: "service", target: "orders", state: "RUNNING" },
      ],
    });
  });
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: normalCheckout });
  const initial = events.find(event => event.type === "loaded");
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const failure = events.at(-1)!;
  assert.ok(failure.type === "error");
  assert.equal(failure.error.code, "SIMULATION_FAILED");
  assert.equal((failure.error.context as { code: string }).code, "INVALID_SERVICE_TRANSITION");
  assert.ok(events.some(event => event.type === "projection.updated" && event.projection.simulation.status === "FAILED"));
  await adapter.receive({ version: 1, requestId: "reset", type: "reset" });
  const reset = events.at(-1);
  assert.ok(initial?.type === "loaded" && reset?.type === "projection.updated");
  assert.deepEqual(reset.projection, initial.projection);
  await adapter.receive({ version: 1, requestId: "step", type: "step" });
  const step = events.at(-1);
  assert.ok(step?.type === "projection.updated");
  assert.equal(step.projection.simulation.processedEvents, 1);
});

test("failed subscribers leave canonical history unchanged", async () => {
  const received: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => { received.push(event); throw new Error("subscriber"); });
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: normalCheckout });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projected = received.filter(event => event.type === "projection.updated").at(-1);
  assert.ok(projected?.type === "projection.updated");
  const baseline = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }).create(normalCheckout);
  await baseline.simulation.run();
  assert.deepEqual(projected.projection.history.observations, structuredClone(baseline.simulation.history.all()));
  assert.ok(Object.isFrozen(projected.projection.components));
});
