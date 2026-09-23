import assert from "node:assert/strict";
import test from "node:test";
import { detached, isCanonical, isWorkerCommand, isWorkerEvent } from "../src/protocol.ts";
import { projection } from "./support.ts";

test("commands use exactly the specified discriminants, version and canonical payloads", () => {
  for (const type of ["pause", "step", "reset"]) assert.ok(isWorkerCommand({ version: 1, requestId: "x", type }));
  assert.ok(isWorkerCommand({ version: 1, requestId: "x", type: "load", scenario: {} }));
  assert.ok(isWorkerCommand({ version: 1, requestId: "x", type: "run", maxEvents: 0 }));
  for (const change of [{ version: 2 }, { requestId: "" }, { type: "status" }, { maxEvents: -1 }, { maxEvents: 1.5 }, { maxEvents: undefined }, { maxEvents: Infinity }, { sessionId: "invented" }]) {
    assert.equal(isWorkerCommand({ version: 1, requestId: "x", type: "run", ...change }), false);
  }
  for (const scenario of [() => {}, new Date(), new Map(), undefined, { bad: undefined }]) {
    assert.equal(isWorkerCommand({ version: 1, requestId: "x", type: "load", scenario }), false);
  }
});

test("canonical transport rejects getters without invoking them, cycles, sparse arrays and capabilities", () => {
  const accessor = { get state() { throw new Error("must not be invoked"); } };
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  for (const value of [accessor, cyclic, [,,], new Set(), Symbol(), 1n, -0, NaN, { next() {} }, Object.create({ inherited: true })]) {
    assert.equal(isCanonical(value), false);
    assert.throws(() => detached(value));
  }
});

test("events validate nested projections and reject extra capability fields", () => {
  const event = { version: 1, requestId: "x", type: "loaded", projection: projection() };
  assert.ok(isWorkerEvent(event));
  assert.ok(isWorkerEvent({ version: 1, type: "projection.updated", projection: projection() }));
  for (const broken of [
    { ...event, version: 2 },
    { ...event, projection: { ...projection(), simulation: { ...projection().simulation, pendingEvents: -1 } } },
    { ...event, projection: { ...projection(), architecture: { components: [{ id: "x", kind: "mutable", label: "x" }], links: [] } } },
    { ...event, projection: { ...projection(), operations: {} } },
    { version: 1, requestId: "x", type: "run.finished", status: "READY" },
    { version: 1, requestId: "x", type: "error", error: { code: "BAD", message: "bad" } },
  ]) assert.equal(isWorkerEvent(broken), false);
});

test("projection copies are detached and recursively frozen after structured clone", () => {
  const original = structuredClone(projection());
  const copy = detached(original);
  assert.notEqual(copy, original);
  assert.notEqual(copy.components[0]!.state, original.components[0]!.state);
  assert.throws(() => { (copy.components[0]!.state as { value: number }).value = 9; });
  assert.throws(() => { (copy.architecture.components as unknown[]).push({}); });
  (original.components[0]!.state as { value: number }).value = 9;
  assert.deepEqual(copy.components[0]!.state, { value: 1 });
  assert.ok(Object.isFrozen(detached(structuredClone(copy)).components[0]!.state));
});
