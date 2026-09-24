import assert from "node:assert/strict";
import test from "node:test";
import { SimulationHost } from "../src/host.ts";
import { FakeWorker, projection } from "./support.ts";

async function ready() {
  const worker = new FakeWorker();
  const host = new SimulationHost(() => worker);
  const loaded = host.load({});
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "loaded", projection: projection() });
  await loaded;
  return { host, worker };
}

test("pending transport commands reconcile only on their correlated terminal responses", async () => {
  const { host, worker } = await ready();
  assert.deepEqual(host.getSnapshot().pendingCommands, []);
  const run = host.run();
  const runId = worker.last().requestId;
  assert.deepEqual(host.getSnapshot().pendingCommands, ["run"]);
  assert.equal(host.getSnapshot().projection?.simulation.status, "READY");
  worker.emit({ version: 1, requestId: runId, type: "accepted" });
  worker.emit({ version: 1, requestId: runId, type: "projection.updated", projection: projection("RUNNING") });
  const pause = host.pause();
  const pauseId = worker.last().requestId;
  assert.deepEqual(host.getSnapshot().pendingCommands, ["run", "pause"]);
  worker.emit({ version: 1, requestId: pauseId, type: "accepted" });
  assert.equal(host.getSnapshot().projection?.simulation.status, "RUNNING");
  worker.emit({ version: 1, requestId: runId, type: "projection.updated", projection: projection("PAUSED") });
  assert.deepEqual(host.getSnapshot().pendingCommands, ["run", "pause"]);
  worker.emit({ version: 1, requestId: runId, type: "run.finished", status: "PAUSED" });
  await run;
  assert.deepEqual(host.getSnapshot().pendingCommands, ["pause"]);
  worker.emit({ version: 1, requestId: pauseId, type: "projection.updated", projection: projection("PAUSED") });
  await pause;
  assert.deepEqual(host.getSnapshot().pendingCommands, []);
  assert.ok(Object.isFrozen(host.getSnapshot().pendingCommands));
});

test("control errors settle their own request while a run remains busy", async () => {
  const { host, worker } = await ready();
  const run = host.run();
  const runId = worker.last().requestId;
  const rejected = assert.rejects(host.reset(), { code: "INVALID_WORKER_COMMAND" });
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "error", error: {
    code: "INVALID_WORKER_COMMAND", message: "Busy", context: { reason: "CONTROL_BUSY" },
  } });
  await rejected;
  assert.deepEqual(host.getSnapshot().pendingCommands, ["run"]);
  assert.deepEqual(host.getSnapshot().error?.context, { reason: "CONTROL_BUSY" });
  worker.emit({ version: 1, requestId: runId, type: "projection.updated", projection: projection("COMPLETED") });
  worker.emit({ version: 1, requestId: runId, type: "run.finished", status: "COMPLETED" });
  await run;
  assert.deepEqual(host.getSnapshot().pendingCommands, []);
});

test("reset can recover a failed session whose history could not supply a projection", async () => {
  const { host, worker } = await ready();
  const failed = assert.rejects(host.run(), { code: "SIMULATION_FAILED" });
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "error", error: {
    code: "SIMULATION_FAILED", message: "Failed", context: { code: "OBSERVATION_CAPACITY" },
  } });
  await failed;
  assert.equal(host.getSnapshot().projection, null);
  const reset = host.reset();
  assert.equal(host.getSnapshot().error?.code, "SIMULATION_FAILED");
  assert.equal(host.getSnapshot().projection, null);
  assert.deepEqual(host.getSnapshot().pendingCommands, ["reset"]);
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "projection.updated", projection: projection() });
  await reset;
  assert.equal(host.getSnapshot().projection?.simulation.status, "READY");
  assert.equal(host.getSnapshot().error, null);
  assert.deepEqual(host.getSnapshot().pendingCommands, []);
});

test("request correlation waits beyond accepted and run projections to the terminal response", async () => {
  const { host, worker } = await ready();
  let settled = false;
  const running = host.run(2).then(event => { settled = true; return event; });
  const requestId = worker.last().requestId;
  worker.emit({ version: 1, requestId: "unknown", type: "run.finished", status: "COMPLETED" });
  worker.emit({ version: 1, requestId, type: "accepted" });
  worker.emit({ version: 1, requestId, type: "projection.updated", projection: projection("PAUSED") });
  await Promise.resolve(); assert.equal(settled, false);
  worker.emit({ version: 1, requestId, type: "run.finished", status: "PAUSED" });
  assert.equal((await running).type, "run.finished");
  for (const control of [() => host.step(), () => host.pause(), () => host.reset()]) {
    const response = control();
    worker.emit({ version: 1, requestId: worker.last().requestId, type: "projection.updated", projection: projection() });
    assert.equal((await response).type, "projection.updated");
  }
  assert.equal(new Set(worker.commands.map(command => command.requestId)).size, worker.commands.length);
});

test("new loads fence pending requests and stale events even when run fingerprints repeat", async () => {
  const workers: FakeWorker[] = [];
  const host = new SimulationHost(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const first = host.load({});
  const replaced = assert.rejects(first, { code: "SESSION_REPLACED" });
  const second = host.load({});
  await replaced;
  const old = workers[0]!, current = workers[1]!;
  assert.ok(old.terminated);
  old.emit({ version: 1, requestId: old.last().requestId, type: "loaded", projection: projection() });
  assert.equal(host.getSnapshot().projection, null);
  current.emit({ version: 1, requestId: current.last().requestId, type: "loaded", projection: projection() });
  await second;
  old.emit({ version: 1, type: "projection.updated", projection: projection("FAILED") });
  current.emit({ version: 1, requestId: old.last().requestId, type: "projection.updated", projection: projection("FAILED") });
  assert.equal(host.getSnapshot().projection?.simulation.status, "READY");
});

test("worker errors, message decode errors and malformed events clear runnable state and reject requests", async () => {
  for (const type of ["error", "messageerror", "malformed"]) {
    const { host, worker } = await ready();
    const pending = assert.rejects(host.run(), { code: "WORKER_UNAVAILABLE" });
    if (type === "malformed") worker.dispatchEvent(new MessageEvent("message", { data: { version: 99 } }));
    else worker.dispatchEvent(new Event(type));
    await pending;
    assert.equal(host.getSnapshot().projection, null);
    assert.equal(host.getSnapshot().error?.code, "WORKER_UNAVAILABLE");
    assert.ok(worker.terminated);
  }
});

test("structured load failures leave no old runnable state and subscribers cannot change projections", async () => {
  const { host, worker } = await ready();
  host.subscribe(() => { throw new Error("render failure"); });
  const loaded = host.load({});
  const rejected = assert.rejects(loaded, { code: "INVALID_SCENARIO" });
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "error", error: { code: "INVALID_SCENARIO", message: "Invalid scenario", context: [{ path: "/version", code: "BAD" }] } });
  await rejected;
  assert.equal(host.getSnapshot().projection, null);
  assert.ok(Object.isFrozen(host.getSnapshot().error?.context));
});

test("worker construction, postMessage failure, and host disposal settle outstanding requests", async () => {
  const unavailable = new SimulationHost(() => { throw new Error("worker blocked"); });
  await assert.rejects(unavailable.load({}), { code: "WORKER_UNAVAILABLE" });
  const { host, worker } = await ready();
  worker.postMessage = () => { throw new Error("clone failed"); };
  await assert.rejects(host.step(), { code: "WORKER_UNAVAILABLE" });
  const fresh = await ready();
  const running = assert.rejects(fresh.host.run(), { code: "WORKER_UNAVAILABLE" });
  fresh.host.dispose(); await running;
  assert.equal(fresh.host.getSnapshot().projection, null);
});

test("a failed projection never resolves a control before its structured terminal error", async () => {
  for (const type of ["run", "step", "reset", "pause"] as const) {
    const { host, worker } = await ready();
    const rejected = assert.rejects(host[type](), { code: "SIMULATION_FAILED" });
    const requestId = worker.last().requestId;
    worker.emit({ version: 1, requestId, type: "projection.updated", projection: projection("FAILED") });
    worker.emit({ version: 1, requestId, type: "error", error: { code: "SIMULATION_FAILED", message: "Failed", context: { code: "HANDLER_FAILED" } } });
    await rejected;
    assert.equal(host.getSnapshot().projection?.simulation.status, "FAILED");
    assert.equal(host.getSnapshot().error?.code, "SIMULATION_FAILED");
  }
});

test("invalid controls do not end an outstanding load", async () => {
  const worker = new FakeWorker();
  const host = new SimulationHost(() => worker);
  const loading = host.load({});
  await assert.rejects(host.run(-1), { code: "INVALID_WORKER_COMMAND" });
  assert.equal(host.getSnapshot().loading, true);
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "loaded", projection: projection() });
  await loading;
  assert.equal(host.getSnapshot().loading, false);
  assert.equal(host.getSnapshot().error, null);
});

test("reload after worker failure fences queued callbacks and pending control responses", async () => {
  const workers: FakeWorker[] = [];
  const callbacks: EventListener[] = [];
  const host = new SimulationHost(() => {
    const worker = new FakeWorker();
    const add = worker.addEventListener.bind(worker);
    worker.addEventListener = (type, listener) => {
      if (type === "message" && typeof listener === "function") callbacks.push(listener);
      add(type, listener);
    };
    workers.push(worker);
    return worker;
  });
  const first = host.load({});
  const old = workers[0]!;
  old.emit({ version: 1, requestId: old.last().requestId, type: "loaded", projection: projection() });
  await first;
  const running = assert.rejects(host.run(), { code: "WORKER_UNAVAILABLE" });
  const runId = old.last().requestId;
  old.dispatchEvent(new Event("error"));
  await running;
  const reloading = host.load({});
  const current = workers[1]!;
  current.emit({ version: 1, requestId: current.last().requestId, type: "loaded", projection: projection() });
  await reloading;
  // Invoke the removed listener directly to model an already queued callback.
  callbacks[0]!(new MessageEvent("message", { data: { version: 1, type: "projection.updated", projection: projection("FAILED") } }));
  current.emit({ version: 1, requestId: runId, type: "run.finished", status: "FAILED" });
  assert.equal(host.getSnapshot().projection?.simulation.status, "READY");
  assert.equal(host.getSnapshot().error, null);
  const resetting = host.reset();
  const resetId = current.last().requestId;
  const resetProjection = projection();
  current.emit({ version: 1, requestId: resetId, type: "projection.updated", projection: resetProjection });
  await resetting;
  (resetProjection.components[0]!.state as { value: number }).value = 2;
  assert.deepEqual(host.getSnapshot().projection?.components[0]!.state, { value: 1 });
  assert.ok(Object.isFrozen(host.getSnapshot().projection?.components[0]!.state));
  current.emit({ version: 1, requestId: resetId, type: "projection.updated", projection: projection("FAILED") });
  assert.equal(host.getSnapshot().projection?.simulation.status, "READY");
});
