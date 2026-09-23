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
