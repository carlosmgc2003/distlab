import assert from "node:assert/strict";
import test from "node:test";
import type { Observation } from "@distlab/contracts";
import { ScenarioDocumentDiagnosticCodes, ScenarioDocumentLimits, simulationTime } from "@distlab/contracts";
import { DiagnosticCodes } from "@distlab/scenario";
import { catalogLabel, diagnosticPath, errorDiagnostics, explainDiagnostic, oversized, shortId } from "../src/scenario-file.ts";
import { importedChecks } from "../src/lesson-checks.ts";
import { messages } from "../src/i18n/catalog.ts";

const en = messages("en");
const es = messages("es");

test("ADR-006 step 1: a file over the document byte limit is rejected before it is read", () => {
  assert.deepEqual(oversized(ScenarioDocumentLimits.documentBytes), []);
  assert.deepEqual(oversized(0), []);
  assert.deepEqual(oversized(ScenarioDocumentLimits.documentBytes + 1), [{ path: "", code: "DOCUMENT_SIZE" }]);
});

test("every document and scenario diagnostic code has its own plain explanation", () => {
  const fallback = explainDiagnostic("NOT_A_CODE", en);
  const codes = [...Object.values(ScenarioDocumentDiagnosticCodes), ...Object.values(DiagnosticCodes)];
  for (const code of codes) {
    const explanation = explainDiagnostic(code, en);
    assert.notEqual(explanation, fallback, `${code} is explained`);
    assert.doesNotMatch(explanation, /[<>]/, "explanations are plain text");
    // Spanish has its own sentence for every code.
    const spanish = explainDiagnostic(code, es);
    assert.notEqual(spanish, explainDiagnostic("NOT_A_CODE", es), `${code} is explained in Spanish`);
    assert.notEqual(spanish, explanation, `${code} is translated`);
  }
  assert.equal(new Set(codes.map(code => explainDiagnostic(code, en))).size, codes.length, "no two codes share an explanation");
  assert.equal(diagnosticPath("", en), "(whole document)");
  assert.equal(diagnosticPath("", es), "(documento completo)");
  assert.equal(diagnosticPath("/catalog/id", en), "/catalog/id");
});

test("explanations show the size limit with the language's own digit grouping, and keep code-like tokens literal", () => {
  assert.equal(explainDiagnostic("DOCUMENT_SIZE", en), `The file is larger than ${ScenarioDocumentLimits.documentBytes.toLocaleString("en-US")} bytes, so it was not read.`);
  assert.match(explainDiagnostic("DOCUMENT_SIZE", es), new RegExp(`más de ${ScenarioDocumentLimits.documentBytes.toLocaleString("es")} bytes`));
  assert.match(explainDiagnostic("RESERVED_KEY", es), /__proto__/);
  assert.match(explainDiagnostic("FORMAT", es), /"distlab\.scenario"/);
  assert.match(explainDiagnostic("START_TIME_MISMATCH", es), /configuration\.startTime/);
});

test("diagnostics are read from an error context only when every entry has a path and a code", () => {
  assert.deepEqual(errorDiagnostics({ diagnostics: [{ path: "/catalog/id", code: "UNKNOWN_CATALOG" }] }), [{ path: "/catalog/id", code: "UNKNOWN_CATALOG" }]);
  for (const context of [null, [], { diagnostics: "x" }, { diagnostics: [{ path: 1, code: "X" }] }, { diagnostics: [null] }]) assert.equal(errorDiagnostics(context), null);
  assert.equal(catalogLabel({ id: "mvp.checkout", version: "1.0.0" }), "mvp.checkout@1.0.0");
  assert.equal(shortId("run:0123456789abcdef"), "01234567");
  assert.equal(shortId("fedcba9876543210"), "fedcba98");
});

function evaluated(id: string, assertionId: string, sequence: number): Observation {
  return { schemaVersion: 1, id, time: simulationTime(sequence), sequence, type: "scenario.assertion.evaluated", source: "scenario", data: { assertionId } } as Observation;
}

test("imported checks keep stored verdicts, label from the document or the ID, and link settled checks to evidence", () => {
  const assertions = [
    { id: "order-not-charged-twice", status: "PASS", time: 1030 },
    { id: "unlabelled", status: "FAIL", time: 40 },
    { id: "waiting", status: "PENDING" },
    { id: "cut-short", status: "INCOMPLETE", time: 5 },
    { id: "odd", status: "SOMETHING" },
    { status: "PASS" },
  ];
  const labels = { "order-not-charged-twice": "The customer is charged at most once.", waiting: "<b>Not HTML</b>" };
  const observations = [evaluated("o1", "order-not-charged-twice", 1), evaluated("o2", "unlabelled", 2), evaluated("o3", "order-not-charged-twice", 3), evaluated("o4", "waiting", 4)];
  assert.deepEqual(importedChecks(assertions, labels, observations), [
    { id: "order-not-charged-twice", kind: "imported", label: "The customer is charged at most once.", verdict: "PASS", time: 1030, evidenceId: "o3" },
    { id: "unlabelled", kind: "imported", label: "unlabelled", verdict: "FAIL", time: 40, evidenceId: "o2" },
    // An unsettled check has no time and no evidence, even when a record exists.
    { id: "waiting", kind: "imported", label: "<b>Not HTML</b>", verdict: "PENDING" },
    { id: "cut-short", kind: "imported", label: "cut-short", verdict: "INCOMPLETE" },
    { id: "odd", kind: "imported", label: "odd", verdict: "PENDING" },
  ]);
  assert.deepEqual(importedChecks(undefined, undefined, []), []);
  // A label key that only exists on the prototype is not a label.
  assert.equal(importedChecks([{ id: "toString", status: "PASS" }], {}, [])[0]?.label, "toString");
});
