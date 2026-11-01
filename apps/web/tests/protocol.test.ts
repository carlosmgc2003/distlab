import assert from "node:assert/strict";
import test from "node:test";
import { detached, isCanonical, isWorkerCommand, isWorkerEvent } from "../src/protocol.ts";
import { projection, session } from "./support.ts";

test("commands use exactly the specified discriminants, version and canonical payloads", () => {
  for (const type of ["pause", "step", "reset"]) assert.ok(isWorkerCommand({ version: 1, requestId: "x", type }));
  assert.ok(isWorkerCommand({ version: 1, requestId: "x", type: "load", scenario: {} }));
  assert.ok(isWorkerCommand({ version: 1, requestId: "x", type: "load", scenario: {}, overlay: { version: 1 } }), "the overlay is an optional canonical field of load");
  for (const extra of [{ policy: {} }, { document: {} }]) assert.equal(isWorkerCommand({ version: 1, requestId: "x", type: "load", scenario: {}, ...extra }), false);
  for (const type of ["run", "reset", "step", "pause"]) assert.equal(isWorkerCommand({ version: 1, requestId: "x", type, overlay: { version: 1 } }), false, `${type} takes no overlay`);
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
  const event = { version: 1, requestId: "x", type: "loaded", projection: projection(), session: session() };
  assert.ok(isWorkerEvent(event));
  assert.equal(isWorkerEvent({ version: 1, requestId: "x", type: "loaded", projection: projection() }), false, "loaded carries the applied session");
  assert.ok(isWorkerEvent({ version: 1, type: "projection.updated", projection: projection() }));
  for (const broken of [
    { ...event, version: 2 },
    { ...event, projection: { ...projection(), simulation: { ...projection().simulation, pendingEvents: -1 } } },
    { ...event, projection: { ...projection(), architecture: { components: [{ id: "x", kind: "mutable", label: "x" }], links: [] } } },
    { ...event, projection: { ...projection(), operations: {} } },
    { ...event, session: { ...session(), overlay: { ...session().overlay, version: 2 } } },
    { ...event, session: { ...session(), policy: {} } },
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

test("enum fields reject canonical nonstrings without coercing or throwing", () => {
  for (const value of [["READY"], ["COMPLETED"], ["service"], ["host"], { toString: null }]) {
    const initial = projection();
    for (const broken of [
      { version: 1, requestId: "x", type: "run.finished", status: value },
      { version: 1, type: "projection.updated", projection: { ...initial, simulation: { ...initial.simulation, status: value } } },
      { version: 1, type: "projection.updated", projection: { ...initial, architecture: { ...initial.architecture, components: [{ ...initial.architecture.components[0], kind: value }] } } },
      { version: 1, type: "projection.updated", projection: { ...initial, components: [{ ...initial.components[0], visibility: value }] } },
    ]) assert.equal(isWorkerEvent(broken), false);
  }
});
