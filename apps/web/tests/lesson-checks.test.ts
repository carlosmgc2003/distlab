import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, Observation, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { commerceChecks, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import type { CommerceLessonName } from "@distlab/catalogs";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { messages } from "../src/i18n/catalog.ts";
import { checkKey, checkLabel, lessonChecks, verdictLabel, verdictMark, verdictTone } from "../src/lesson-checks.ts";
import { scenarios } from "../src/scenarios.ts";

const en = messages("en");
const es = messages("es");

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
  return lessonChecks(name, assertions, commerceChecks(name), projection.history.observations, en);
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
    assert.ok(result.reproduced === null || result.reproduced === "YES", `${name} reproduced its setup`);
    // The unfilled design gap also violates an invariant: nothing receives the payment event.
    const unsafe = ["retry-unsafe", "saga-uncompensated", "dual-write", "outbox-unsafe-consumer", "outbox-notifications-gap", "cascade-unprotected", "notifications-unbounded", "cache-stale-price", "inventory-oversell", "lease-unfenced", "clock-last-write-wins"].includes(name);
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
  assert.equal(unsafe.reproduced, "YES");
  assert.equal(safe.reproduced, "YES");
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
  const result = lessonChecks("saga-uncompensated", assertions, checks, [evaluation("o1", "one-payment-per-order"), evaluation("o2", "one-payment-per-order"), evaluation("o3", "unclassified"), evaluation("o4", "one-payment-per-order", true)], en);
  assert.deepEqual(result.invariants, [
    { id: "one-payment-per-order", kind: "invariant", label: "One charge", verdict: "VIOLATED", time: 30, evidenceId: "o2" },
    { id: "pending", kind: "invariant", label: "Later", verdict: "PENDING" },
  ]);
  // Without a classification a check never claims HOLDS: it is an expectation under its own ID.
  assert.deepEqual(result.expectations, [{ id: "unclassified", kind: "expectation", label: "unclassified", verdict: "REPRODUCED", time: 30, evidenceId: "o3" }]);
  assert.equal(result.reproduced, "YES");
  // A redacted record is never read back into a check, so it cannot become evidence.
  assert.equal(lessonChecks("saga-uncompensated", assertions, checks, [evaluation("o4", "one-payment-per-order", true)], en).invariants[0]!.evidenceId, undefined);
  assert.deepEqual(lessonChecks("saga-uncompensated", undefined, checks, [], en), { invariants: [], expectations: [], reproduced: null });
});

test("verdicts are codes: the words, glyphs, and CSS tokens derive from the code, in either language", () => {
  const row = (kind: "invariant" | "expectation" | "imported", verdict: string) => ({ kind, verdict });
  assert.equal(verdictLabel(row("invariant", "HOLDS"), en), "HOLDS");
  assert.equal(verdictLabel(row("expectation", "NOT_REPRODUCED"), en), "not reproduced");
  assert.equal(verdictLabel(row("imported", "FAIL"), en), "FAIL");
  assert.equal(verdictLabel(row("invariant", "HOLDS"), es), "SE CUMPLE");
  assert.equal(verdictLabel(row("expectation", "NOT_REPRODUCED"), es), "no reproducida");
  // The CSS class and the glyph never depend on the words.
  for (const [code, tone, mark] of [["HOLDS", "holds", "✓"], ["VIOLATED", "violated", "✗"], ["REPRODUCED", "reproduced", "✓"], ["NOT_REPRODUCED", "not-reproduced", "✗"], ["PENDING", "pending", "…"], ["INCOMPLETE", "incomplete", "–"], ["PASS", "pass", "✓"], ["FAIL", "fail", "✗"]] as const) {
    assert.equal(verdictTone(code), tone);
    assert.equal(verdictMark(code), mark);
  }
  assert.equal(en.commerceLesson.reproducedSummary.NOT_YET, "not yet");
  assert.equal(es.commerceLesson.reproducedSummary.NOT_YET, "todavía no");
});

test("a check label is the catalog's English source, or its Spanish translation by stable id", () => {
  const source = commerceChecks("dual-write").find(check => check.id === "durable-outbox")!;
  assert.equal(checkLabel("dual-write", "durable-outbox", source.label, en), source.label);
  assert.equal(checkLabel("dual-write", "durable-outbox", source.label, es), "Ninguna fila del outbox registró el evento (t=6)");
  assert.equal(checkLabel("outbox-idempotent", "durable-outbox", "x", es), "El outbox registró el evento sin enviar junto con el pago (t=6)");
  assert.equal(checkLabel("retry-unsafe", "not-a-check", "Unknown source", es), "Unknown source", "an id without a translation falls back to the English source");
  assert.equal(checkKey("cascade-breaker", "dependency-recovered"), "cascade-breaker/dependency-recovered");
  assert.equal(checkKey("cascade-unprotected", "dependency-recovered"), "dependency-recovered");
});
