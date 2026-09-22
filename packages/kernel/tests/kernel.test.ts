import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCodes, simulationTime, type VisibilityPolicy } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode, ExecutionHistory, sha256Hex } from "../dist/index.js";

const visible: VisibilityPolicy = { defaultMode: "visible", byType: {}, summaryFields: {} };
const clock = { now: () => simulationTime(7) };
function history(policy = visible, limit = 3) {
  const result = new ExecutionHistory({ runId: "run:test", clock, historyLimit: limit, visibility: policy });
  result.registerSchema("network.request.sent", () => true);
  return result;
}

test("canonical encoding sorts keys, detaches values, and rejects accessors", () => {
  assert.equal(canonicalEncode(canonicalCopy({ b: [true, null], a: 1 })), '{"a":1,"b":[true,null]}');
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const source = { nested: { value: 1 } }; const copied = canonicalCopy(source) as { nested: { value: number } };
  source.nested.value = 2; assert.equal(copied.nested.value, 1); assert.throws(() => { copied.nested.value = 3; });
  let read = false; const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { read = true; return 1; } });
  assert.throws(() => canonicalCopy(accessor)); assert.equal(read, false);
});

test("history is ordered, immutable, filtered, and visibility-safe", () => {
  const store = history({ defaultMode: "summary", byType: {}, summaryFields: { "network.request.sent": ["before"] } });
  const input = { type: "network.request.sent", source: "client", data: { before: "a", hidden: "b" }, entityRefs: [{ kind: "request", id: "1" }] } as const;
  const first = store.record(input); const second = store.record({ type: "network.request.sent", source: "client", causationId: first.id, data: { before: "b" } });
  assert.equal((first.data as { before: string }).before, "a"); assert.equal(first.sequence, 0); assert.equal(second.sequence, 1);
  assert.equal(store.query({ component: "client", entity: { kind: "request", id: "1" } }).length, 1);
  assert.throws(() => { (first as { source: string }).source = "changed"; });
  assert.throws(() => store.record({ type: "network.request.sent", source: "client", causationId: "missing" }));
});

test("notifications are deferred and limits seal independently", () => {
  const store = history(visible, 1); let calls = 0;
  store.subscribe(() => { calls += 1; assert.throws(() => store.record({ type: "network.request.sent", source: "client" }), (error: unknown) => (error as { code: string }).code === ErrorCodes.OBSERVER_REENTRANCY); });
  store.record({ type: "network.request.sent", source: "client" }); assert.equal(calls, 0); store.flushNotifications(); assert.equal(calls, 1);
  assert.throws(() => store.record({ type: "network.request.sent", source: "client" }), (error: unknown) => (error as { code: string }).code === ErrorCodes.HISTORY_LIMIT_EXCEEDED);
  store.sealFailure({ time: simulationTime(7), code: "HISTORY_LIMIT_EXCEEDED", context: { type: "network.request.sent" }, historyComplete: false, lastObservationId: store.all()[0]!.id });
  assert.equal(store.export().terminalFailure?.historyComplete, false);
});
