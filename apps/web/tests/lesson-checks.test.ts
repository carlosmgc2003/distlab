import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, Observation, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { commerceChecks, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import type { CommerceLessonName } from "@distlab/catalogs";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { lessonChecks } from "../src/lesson-checks.ts";
import { scenarios } from "../src/scenarios.ts";

async function finished(name: CommerceLessonName): Promise<RuntimeProjectionSet> {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: commerceScenario(name) });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const event = events.filter(e => "projection" in e).at(-1);
  assert.ok(event && "projection" in event);
  return event.projection;
}
function view(name: CommerceLessonName, projection: RuntimeProjectionSet) {
  // Like the lesson panel, find the client by its role, not by a component ID.
  const client = projection.components.find(entry => entry.visibility === "student" && (entry.state as Record<string, CanonicalValue>).role === "commerce-client");
  const assertions = (client?.state as Record<string, CanonicalValue> | undefined)?.assertions;
  return lessonChecks(assertions, commerceChecks(name), projection.history.observations);
}

test("every commerce lesson's checks reach the student as invariants or expectations, never as a bare PASS", async () => {
  for (const name of commerceLessonNames) {
    const choice = scenarios.find(item => item.id === name);
    assert.ok(choice && "checks" in choice, `${name} carries its classification to the main thread`);
    assert.deepEqual(choice.checks, commerceChecks(name));
    const result = view(name, await finished(name));
    const classified = commerceChecks(name);
    assert.deepEqual(result.invariants.map(row => row.id), classified.filter(check => check.kind === "invariant").map(check => check.id), name);
    assert.deepEqual(result.expectations.map(row => row.id), classified.filter(check => check.kind === "expectation").map(check => check.id), name);
    // Every packaged lesson reproduces its setup; an unsafe lesson's finding is a VIOLATED invariant.
    assert.ok(result.reproduced === null || result.reproduced === "yes", `${name} reproduced its setup`);
    // The unfilled design gap also violates an invariant: nothing receives the payment event.
    const unsafe = ["retry-unsafe", "saga-uncompensated", "dual-write", "outbox-unsafe-consumer", "outbox-notifications-gap", "cascade-unprotected", "notifications-unbounded", "cache-stale-price", "inventory-oversell"].includes(name);
    assert.equal(result.invariants.some(row => row.verdict === "VIOLATED"), unsafe, name);
    for (const row of [...result.invariants, ...result.expectations]) {
      assert.ok(!/^PASS|^FAIL/.test(row.verdict), `${name} ${row.id}`);
      assert.equal(typeof row.time, "number");
      assert.ok(row.evidenceId, `${name} ${row.id} links to its evaluation record`);
    }
  }
});

test("the Saga pair shows the same invariants VIOLATED, then HOLDS, each with evidence", async () => {
  const unsafe = view("saga-uncompensated", await finished("saga-uncompensated"));
  const safe = view("saga-compensated", await finished("saga-compensated"));
  assert.deepEqual(unsafe.invariants.map(row => `${row.verdict} ${row.label}`), [
    "VIOLATED A failed order is cancelled",
    "VIOLATED A failed order does not keep inventory reserved",
    "VIOLATED A failed order keeps no approved payment",
  ]);
  assert.deepEqual(safe.invariants.map(row => row.id), unsafe.invariants.map(row => row.id));
  assert.ok(safe.invariants.every(row => row.verdict === "HOLDS"));
  assert.equal(unsafe.reproduced, "yes");
  assert.equal(safe.reproduced, "yes");
});

test("evidence is the latest visible evaluation record of that check", () => {
  const evaluation = (id: string, assertionId: string, redacted = false): Observation => ({
    id, sequence: Number(id.slice(1)), time: simulationTime(5), type: "scenario.assertion.evaluated", source: "simulation",
    entityRefs: [{ kind: "assertion", id: assertionId }], data: redacted ? { redacted: true } : { assertionId, verdict: false, evidence: null },
  } as unknown as Observation);
  const assertions = [
    { id: "one-payment-per-order", status: "FAIL", time: 30, evidence: null },
    { id: "unclassified", status: "PASS", time: 30, evidence: null },
    { id: "pending", status: "PENDING", time: 0, evidence: null },
  ];
  const checks = [{ id: "one-payment-per-order", kind: "invariant", label: "One charge" }, { id: "pending", kind: "invariant", label: "Later" }] as const;
  const result = lessonChecks(assertions, checks, [evaluation("o1", "one-payment-per-order"), evaluation("o2", "one-payment-per-order"), evaluation("o3", "unclassified"), evaluation("o4", "one-payment-per-order", true)]);
  assert.deepEqual(result.invariants, [
    { id: "one-payment-per-order", label: "One charge", verdict: "VIOLATED", time: 30, evidenceId: "o2" },
    { id: "pending", label: "Later", verdict: "PENDING" },
  ]);
  // Without a classification a check never claims HOLDS: it is an expectation under its own ID.
  assert.deepEqual(result.expectations, [{ id: "unclassified", label: "unclassified", verdict: "reproduced", time: 30, evidenceId: "o3" }]);
  assert.equal(result.reproduced, "yes");
  // A redacted record is never read back into a check, so it cannot become evidence.
  assert.equal(lessonChecks(assertions, checks, [evaluation("o4", "one-payment-per-order", true)]).invariants[0]!.evidenceId, undefined);
  assert.deepEqual(lessonChecks(undefined, checks, []), { invariants: [], expectations: [], reproduced: null });
});
