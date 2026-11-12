import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Observation } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import {
  assertionEvidence,
  attemptLabel,
  attemptOf,
  continuesHistory,
  correlation,
  edgeFor,
  milestoneTypeList,
  movementOf,
  orderObservations,
  payloadVisibility,
  recordedChanges,
  recordKind,
  recordKinds,
  storedScalar,
  storedText,
  traceView,
} from "../src/records.ts";
import { recordLabel, emphasisFor } from "../src/timeline.ts";
import { storyLabel, storyMilestones } from "../src/story-timeline.ts";

const document = readFileSync(fileURLToPath(new URL("../../../docs/learning-timeline.md", import.meta.url)), "utf8");

function observation(overrides: { readonly type: string; readonly source: string; readonly id?: string; readonly time?: number; readonly sequence?: number; readonly target?: string; readonly traceId?: string; readonly spanId?: string; readonly parentSpanId?: string; readonly causationId?: string; readonly data?: Observation["data"] }): Observation {
  return {
    id: overrides.id ?? overrides.type,
    time: simulationTime(overrides.time ?? 1),
    sequence: overrides.sequence ?? 1,
    source: overrides.source,
    type: overrides.type,
    schemaVersion: 1,
    ...(overrides.target !== undefined ? { target: overrides.target } : {}),
    ...(overrides.traceId !== undefined ? { traceId: overrides.traceId } : {}),
    ...(overrides.spanId !== undefined ? { spanId: overrides.spanId } : {}),
    ...(overrides.parentSpanId !== undefined ? { parentSpanId: overrides.parentSpanId } : {}),
    ...(overrides.causationId !== undefined ? { causationId: overrides.causationId } : {}),
    ...(overrides.data !== undefined ? { data: overrides.data } : {}),
  };
}

/**
 * The document wins. Every deviation below is a recorded decision, not an
 * oversight: an entry here without a decision fails the test.
 */
const DOCUMENTED_DEVIATIONS: Readonly<Record<string, string>> = {
  // Unresolved: the document omits the request timeout that the checkout lesson is about.
  "network.request.timedout": "pending: the document does not list it and the lesson needs it",
};

/** The milestone types the Story view section of the document names. */
function documentedMilestoneTypes(): readonly string[] {
  const section = document.slice(document.indexOf("## Story view"), document.indexOf("## Quick views"));
  const listed = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("- ")) continue;
    for (const match of line.matchAll(/`([a-z]+(?:\.[a-z-]+)+)`/g)) if (match[1]) listed.add(match[1]);
  }
  return [...listed];
}

test("the milestone table matches the documented Story milestone set", () => {
  const documented: readonly string[] = documentedMilestoneTypes().filter(type => type in DOCUMENTED_DEVIATIONS || !type.endsWith(".*"));
  const table: ReadonlySet<string> = new Set(milestoneTypeList);
  assert.deepEqual(
    [...table].filter(type => !documented.includes(type)),
    Object.keys(DOCUMENTED_DEVIATIONS).filter(type => table.has(type)),
    "a table entry the document does not name needs a recorded decision",
  );
  assert.deepEqual(
    documented.filter(type => !table.has(type)),
    Object.keys(DOCUMENTED_DEVIATIONS).filter(type => !table.has(type)),
    "a documented milestone the table omits needs a recorded decision",
  );
  // Recorded history lists milestones only, so the records lessons teach with are milestones.
  for (const type of ["runtime.log", "kv.expired", "database.transaction.rejected", "message.dead", "scenario.assertion.evaluated"]) {
    assert.ok(table.has(type), `${type} is a documented milestone`);
  }
});

test("every milestone has wording in each view that names it", () => {
  for (const type of milestoneTypeList) {
    const record = observation({ type, source: "orders", target: "payments" });
    assert.notEqual(recordLabel(record), type, `no wording in Recorded history for ${type}`);
    assert.notEqual(storyLabel(record), type, `no wording in Story for ${type}`);
    assert.notEqual(storyLabel(record), undefined, `not a Story milestone for ${type}`);
    assert.notEqual(recordKind(record), undefined, `no teaching category for ${type}`);
  }
});

test("the canonical transaction rollback type is worded and the removed alias is not", () => {
  const canonical = observation({ type: "database.transaction.rolledback", source: "orders" });
  assert.equal(recordLabel(canonical), "Database transaction rolled back");
  assert.equal(storyLabel(canonical), "Transaction rolled back");
  assert.equal(recordKind(canonical), "rollback");
  // The kernel never emits `rolled_back`; it is a stored type no runtime produces.
  const alias = observation({ type: "database.transaction.rolled_back", source: "orders" });
  assert.equal(recordKind(alias), undefined);
});

test("records outside the milestone set state their stored type and never a milestone", () => {
  for (const type of ["kv.read", "service.lifecycle.changed", "database.write.staged", "scheduler.event.scheduled"]) {
    const record = observation({ type, source: "orders" });
    assert.equal(recordKind(record), undefined, type);
    assert.equal(storyLabel(record), undefined, type);
    assert.equal(recordLabel(record), type, type);
  }
  // Every fault record stays a milestone, including ones the table does not name.
  assert.equal(recordKind(observation({ type: "fault.custom.rule", source: "faults" })), "fault");
  assert.equal(recordLabel(observation({ type: "fault.custom.rule", source: "faults" })), "Fault recorded");
});

test("labels add only stored fields: a log's message, a key, a rejection code, and a check's verdict", () => {
  const cases: readonly (readonly [Observation, string, string])[] = [
    [observation({ type: "runtime.log", source: "orders", data: { level: "info", message: "saga.compensation" } }), "Log: saga.compensation", "Log: saga.compensation"],
    [observation({ type: "kv.expired", source: "kv", data: { key: "lock:report", expiresAt: 12 } }), "Key-value entry expired: lock:report", "Key-value entry expired: lock:report"],
    [observation({ type: "database.transaction.rejected", source: "inventory", data: { transactionId: "t", code: "TRANSACTION_CONFLICT" } }), "Database transaction rejected (TRANSACTION_CONFLICT)", "Transaction rejected (TRANSACTION_CONFLICT)"],
    [observation({ type: "message.dead", source: "bus", data: { reason: "RETRY_EXHAUSTED", attempts: 3 } }), "Message dead-lettered (RETRY_EXHAUSTED)", "Message dead-lettered (RETRY_EXHAUSTED)"],
    [observation({ type: "scenario.assertion.evaluated", source: "simulation", data: { assertionId: "one-charge", verdict: false } }), "Check: one-charge did not pass", "Check: one-charge did not pass"],
  ];
  for (const [record, detail, story] of cases) {
    assert.equal(recordLabel(record), detail);
    assert.equal(storyLabel(record), story);
  }
  // A redacted payload adds nothing.
  assert.equal(recordLabel(observation({ type: "runtime.log", source: "orders", data: { redacted: true } })), "Log");
});

test("a check is a milestone for its first result and each change, never for an unchanged repeat", () => {
  const check = (id: string, sequence: number, assertionId: string, verdict: boolean) =>
    observation({ id, sequence, time: sequence, type: "scenario.assertion.evaluated", source: "simulation", data: { assertionId, verdict } });
  const rows = [
    check("a1", 1, "a", false), check("b1", 2, "b", true), check("a2", 3, "a", false),
    check("a3", 4, "a", true), check("b2", 5, "b", true), check("a4", 6, "a", true),
    observation({ id: "x", sequence: 7, time: 7, type: "scenario.assertion.evaluated", source: "simulation", data: { redacted: true } }),
    observation({ id: "y", sequence: 8, time: 8, type: "scenario.assertion.evaluated", source: "simulation", data: { redacted: true } }),
  ];
  assert.deepEqual(storyMilestones(rows).map(item => item.observation.id), ["a1", "b1", "a3", "x", "y"],
    "a record without a readable check id or verdict is never treated as a repeat");
  assert.ok(storyMilestones(rows).every(item => item.kind === "check"));
});

test("a selection emphasis names the movement, the link, and the components", () => {
  const edges = [{ id: "request:orders:payments:0", source: "orders", target: "payments", relationship: "request" as const }];
  const request = observation({ type: "network.request.sent", source: "orders", target: "payments", time: 7 });
  const emphasis = emphasisFor(request, edges);
  assert.equal(emphasis.origin, "selection");
  assert.equal(emphasis.kind, "request");
  assert.equal(emphasis.edgeId, "request:orders:payments:0");
  assert.deepEqual(emphasis.nodeIds, ["orders", "payments"]);
  // The reader is told what moved, where, and at which stored virtual time.
  assert.equal(emphasis.text, "Request sent from orders to payments at virtual time 7.");
  assert.equal(emphasis.pulseId, request.id);

  // A record that travels no link states that it does, and still names both components.
  const commit = observation({ type: "database.transaction.committed", source: "orders", target: "payments" });
  const still = emphasisFor(commit, edges);
  assert.equal(still.kind, undefined);
  assert.equal(still.pulseId, undefined);
  assert.deepEqual(still.nodeIds, ["orders", "payments"]);
  assert.match(still.text ?? "", /^Selected database\.transaction\.committed at orders to payments at virtual time 1\. No request or message movement\.$/);
});

test("a redacted or omitted payload is never reconstructed", () => {
  // Redaction is stored as the single field the kernel writes for a redacted mode.
  const redacted = observation({ type: "message.delivered", source: "payments", data: { redacted: true } });
  assert.equal(payloadVisibility(redacted), "redacted");
  assert.equal(attemptLabel(redacted), "", "a redacted payload names no attempt");
  assert.equal(recordLabel(redacted), "Message delivered");
  assert.equal(storedText(redacted, "consumer"), undefined);
  assert.equal(storedScalar(redacted, "attempt"), undefined);
  assert.deepEqual(recordedChanges(redacted), []);

  const omitted = observation({ type: "message.delivered", source: "payments" });
  assert.equal(payloadVisibility(omitted), "omitted");
  assert.equal(recordLabel(omitted), "Message delivered");
  assert.equal(attemptOf(omitted), undefined);

  const stored = observation({ type: "message.delivered", source: "payments", data: { attempt: 2 } });
  assert.equal(recordLabel(stored), "Message delivered (attempt 2)");
});

test("stored changes carry only what the record stores", () => {
  const record = observation({
    type: "database.transaction.committed", source: "orders",
    data: { before: { state: "CREATED" }, after: { state: "PAID" }, changes: [{ table: "orders", key: "order-1", after: { state: "PAID" } }, { note: "ignored" }] },
  });
  const changes = recordedChanges(record);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { before: { state: "CREATED" }, after: { state: "PAID" } });
  assert.deepEqual(changes[1], { table: "orders", key: "order-1", after: { state: "PAID" } });
});

test("a movement states only stored fields and names no drawn link", () => {
  const edges = [{ id: "request:orders:payments:0", source: "orders", target: "payments", relationship: "request" as const }];
  const request = observation({ id: "r", type: "network.request.sent", source: "orders", target: "payments", time: 4, sequence: 9 });
  const movement = movementOf(request)!;
  assert.equal(movement.from, "orders");
  assert.equal(movement.to, "payments");
  assert.equal(movement.relationship, "request");
  assert.equal(movement.text, "Request sent from orders to payments at virtual time 4.");
  // Link identity belongs to the layer that draws the architecture.
  assert.equal("edgeId" in movement, false);
  assert.equal(edgeFor(movement, edges)?.id, "request:orders:payments:0");
  assert.equal(edgeFor(movement, [{ ...edges[0]!, relationship: "publication" }]), undefined);

  const published = observation({ id: "p", type: "message.published", source: "orders", data: { destination: "OrderCreated" } });
  assert.equal(movementOf(published)?.relationship, "publication");
  assert.equal(movementOf(published)?.from, "orders");
  assert.equal(movementOf(observation({ type: "database.transaction.committed", source: "orders" })), null);
});

test("canonical order and history continuity are one rule", () => {
  const rows = [
    observation({ id: "later", time: 10, sequence: 3, type: "network.response.sent", source: "orders" }),
    observation({ id: "first", time: 10, sequence: 1, type: "network.request.sent", source: "customer-app" }),
    observation({ id: "middle", time: 10, sequence: 2, type: "network.request.delivered", source: "customer-app" }),
  ];
  // Canonical order is recorded sequence; equal virtual times keep their recorded order.
  assert.deepEqual(orderObservations(rows).map(item => item.id), ["first", "middle", "later"]);
  // A snapshot published out of order reads back in recorded order, not arrival order.
  assert.deepEqual(orderObservations([...rows].reverse()).map(item => item.id), ["first", "middle", "later"]);
  // A replaced session no longer continues: it is shorter, or its first record differs.
  assert.equal(continuesHistory([rows[0]!, rows[1]!], [rows[1]!]), false);
  assert.equal(continuesHistory([rows[1]!], [rows[0]!]), false);
  assert.equal(continuesHistory([rows[1]!], [rows[1]!, observation({ id: "next", sequence: 4, type: "clock.advanced", source: "simulation" })]), true);
});

test("traces and causation are read from stored ids only", () => {
  const rows = [
    observation({ id: "effect", sequence: 1, type: "network.request.delivered", source: "orders", traceId: "t1", spanId: "s1", parentSpanId: "s0", causationId: "cause" }),
    observation({ id: "cause", sequence: 2, type: "network.request.sent", source: "customer-app", traceId: "t1", spanId: "s0" }),
    observation({ id: "outside", sequence: 3, type: "clock.advanced", source: "simulation", traceId: "t2" }),
  ];
  const view = traceView(rows, "t1");
  assert.equal(view.roots.length, 1);
  assert.equal(view.roots[0]!.spanId, "s0");
  assert.equal(view.roots[0]!.children[0]!.spanId, "s1");
  assert.deepEqual(view.causation, [{ effectId: "effect", causeId: "cause", causeFound: true }]);
  const links = correlation(rows, rows[0]!);
  assert.equal(links.cause?.id, "cause");
  assert.deepEqual(links.parentObservations.map(item => item.id), ["cause"]);
  assert.deepEqual(links.effects, []);
  const orphan = correlation(rows, observation({ id: "orphan", sequence: 4, type: "network.request.sent", source: "x", causationId: "gone" }));
  assert.equal(orphan.unresolvedCauseId, "gone");
});

test("every teaching category is listed once, in legend order", () => {
  assert.equal(recordKinds.length, 14);
  assert.equal(new Set(recordKinds).size, recordKinds.length);
  const story = storyMilestones([
    observation({ id: "a", sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders" }),
    observation({ id: "b", sequence: 2, type: "runtime.log", source: "orders" }),
    observation({ id: "c", sequence: 3, type: "scheduler.event.scheduled", source: "simulation" }),
  ]);
  assert.deepEqual(story.map(milestone => milestone.observation.id), ["a", "b"]);
  assert.deepEqual(story.map(milestone => milestone.kind), ["request", "log"]);
});

test("#165 an assertion record's stored evidence reads as rows, from stored fields only", () => {
  const evaluated = (data?: Observation["data"]) => observation({ type: "scenario.assertion.evaluated", source: "simulation", ...(data !== undefined ? { data } : {}) });
  // Rows keyed by ID, as commerce.rows stores them: one keyed row per entry, in the Service state form.
  assert.deepEqual(assertionEvidence(evaluated({ assertionId: "one-payment-per-order", verdict: false, evidence: {
    "payment-1": { paymentId: "payment-1", status: "APPROVED", orderId: "order-1", amount: 5000 },
    "payment-2": { paymentId: "payment-2", status: "APPROVED", orderId: "order-1", amount: 5000 },
  } })), { kind: "rows", assertionId: "one-payment-per-order", passed: false, rows: [
    { key: "payment-1", text: "paymentId: payment-1 · status: APPROVED · orderId: order-1 · amount: 5000" },
    { key: "payment-2", text: "paymentId: payment-2 · status: APPROVED · orderId: order-1 · amount: 5000" },
  ] });
  // A list, as commerce.stock stores it: one row per item.
  assert.deepEqual(assertionEvidence(evaluated({ assertionId: "stock-never-negative", verdict: false, evidence: [{ sku: "sku-1", stock: -1, version: 3 }] })),
    { kind: "rows", assertionId: "stock-never-negative", passed: false, rows: [{ text: "sku: sku-1 · stock: -1 · version: 3" }] });
  // Metrics, as commerce.metrics stores them: one row of scalars.
  const metrics = assertionEvidence(evaluated({ assertionId: "bounded-waiting", verdict: true, evidence: { peakActive: 3, active: 0 } }));
  assert.deepEqual(metrics, { kind: "rows", assertionId: "bounded-waiting", passed: true, rows: [{ text: "peakActive: 3 · active: 0" }] });
  // Mixed groups, as commerce.dead-letters stores them: one keyed row per field.
  const dead = assertionEvidence(evaluated({ assertionId: "failed-notification-dead-lettered", verdict: true, evidence: { exhausted: [{ messageId: "m-1", state: "DEAD", attempt: 3 }], deadLetters: ["m-1"] } }));
  assert.deepEqual(dead?.kind === "rows" ? dead.rows : undefined, [
    { key: "exhausted", text: "messageId: m-1 · state: DEAD · attempt: 3" }, { key: "deadLetters", text: "m-1" },
  ]);
  // Empty evidence gives no rows; a payload without evidence says so; the result is only what was stored.
  assert.deepEqual(assertionEvidence(evaluated({ assertionId: "priced", verdict: true, evidence: [] })), { kind: "rows", assertionId: "priced", passed: true, rows: [] });
  assert.deepEqual(assertionEvidence(evaluated({ assertionId: "priced" })), { kind: "none", assertionId: "priced" });
  // A redacted or omitted payload is never reconstructed.
  assert.deepEqual(assertionEvidence(evaluated({ redacted: true })), { kind: "unavailable", visibility: "redacted" });
  assert.deepEqual(assertionEvidence(evaluated()), { kind: "unavailable", visibility: "omitted" });
  // Any other record is not an assertion record.
  assert.equal(assertionEvidence(observation({ type: "database.transaction.committed", source: "payments", data: { evidence: {} } })), undefined);
});
