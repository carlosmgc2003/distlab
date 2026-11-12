import assert from "node:assert/strict";
import test from "node:test";
import type { CheckRow, InvariantVerdict } from "../src/lesson-checks.ts";
import { endsRun, outcomeSummary as summarize, runOutcome as outcomeOf } from "../src/lesson-outcome.ts";
import { messages } from "../src/i18n/catalog.ts";

const m = messages("en");
const outcomeSummary = (view: Parameters<typeof summarize>[0]) => summarize(view, m);
const runOutcome = (status: Parameters<typeof outcomeOf>[0]) => outcomeOf(status, m);

const rows = (...verdicts: InvariantVerdict[]): { invariants: CheckRow<InvariantVerdict>[] } =>
  ({ invariants: verdicts.map((verdict, i) => ({ id: `check-${i}`, kind: "invariant" as const, label: `Check ${i}`, verdict })) });

test("outcomeSummary counts violated invariants, and a violation wins over pending or incomplete ones", () => {
  assert.equal(outcomeSummary(rows("VIOLATED", "VIOLATED", "VIOLATED")), "3 of 3 business invariants violated");
  assert.equal(outcomeSummary(rows("HOLDS", "VIOLATED", "HOLDS")), "1 of 3 business invariants violated");
  assert.equal(outcomeSummary(rows("VIOLATED", "PENDING", "INCOMPLETE")), "1 of 3 business invariants violated");
});

test("outcomeSummary says all invariants hold only when every one is settled as HOLDS", () => {
  assert.equal(outcomeSummary(rows("HOLDS")), "The 1 business invariant holds");
  assert.equal(outcomeSummary(rows("HOLDS", "HOLDS", "HOLDS")), "All 3 business invariants hold");
  assert.notEqual(outcomeSummary(rows("HOLDS", "PENDING")), "All 2 business invariants hold");
});

test("outcomeSummary reads pending while any invariant is pending, including a view without rows", () => {
  assert.equal(outcomeSummary(rows("PENDING", "PENDING")), "Checks are pending: run the lesson");
  assert.equal(outcomeSummary(rows("HOLDS", "PENDING", "INCOMPLETE")), "Checks are pending: run the lesson");
  assert.equal(outcomeSummary(rows()), "Checks are pending: run the lesson");
});

test("outcomeSummary reads incomplete when nothing is violated or pending but not every invariant holds", () => {
  assert.equal(outcomeSummary(rows("INCOMPLETE")), "Checks are incomplete");
  assert.equal(outcomeSummary(rows("HOLDS", "INCOMPLETE")), "Checks are incomplete");
});

test("outcomeSummary never shows a bare PASS or FAIL", () => {
  for (const verdicts of [["VIOLATED"], ["HOLDS"], ["PENDING"], ["INCOMPLETE"]] as InvariantVerdict[][]) {
    assert.doesNotMatch(outcomeSummary(rows(...verdicts)), /\b(PASS|FAIL)\b/);
  }
});

test("runOutcome keeps the checkout Run overview's outcome sentences", () => {
  assert.equal(runOutcome("COMPLETED"), "Execution completed; business outcome is shown from recorded state.");
  assert.equal(runOutcome("FAILED"), "Execution failed.");
  assert.equal(runOutcome("RUNNING"), "Execution in progress.");
  assert.equal(runOutcome("READY"), "Execution partial or ready.");
  assert.equal(runOutcome("PAUSED"), "Execution partial or ready.");
});

test("only COMPLETED and FAILED end a run", () => {
  assert.deepEqual((["READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED", undefined] as const).map(endsRun), [false, false, false, true, true, false]);
});
