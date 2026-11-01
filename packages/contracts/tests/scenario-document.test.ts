import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIO_DOCUMENT_FORMAT, ScenarioDocumentDiagnosticCodes, ScenarioDocumentLimits } from "../dist/index.js";

// Transcribed from docs/spec/adr/006-scenario-documents.md, "Trust model" limits table.
const adrLimits = {
  documentBytes: 262_144,
  nestingDepth: 32,
  components: 32,
  links: 128,
  actions: 2_000,
  faultRules: 64,
  assertions: 64,
  historyLimit: 100_000,
  titleLength: 120,
  summaryLength: 2_000,
  assertionLabelLength: 200,
};

// Transcribed from docs/spec/adr/006-scenario-documents.md, "Validation".
const adrCodes = [
  "DOCUMENT_SIZE", "DOCUMENT_SYNTAX", "DOCUMENT_DEPTH", "DUPLICATE_KEY", "RESERVED_KEY", "FORMAT", "FORMAT_VERSION",
  "UNKNOWN_CATALOG", "CATALOG_VERSION", "DOCUMENT_LIMIT", "RESERVED_NAME", "RESERVED_ID", "POLICY_TARGET",
  "POLICY_DEFAULT", "POLICY_ALLOWANCE",
];

test("scenario document format is the ADR-006 constant", () => {
  assert.equal(SCENARIO_DOCUMENT_FORMAT, "distlab.scenario");
});

test("ScenarioDocumentLimits is frozen and matches the ADR-006 limits table", () => {
  assert.ok(Object.isFrozen(ScenarioDocumentLimits));
  assert.deepEqual({ ...ScenarioDocumentLimits }, adrLimits);
  for (const value of Object.values(ScenarioDocumentLimits)) assert.ok(Number.isSafeInteger(value) && value > 0);
  assert.throws(() => { (ScenarioDocumentLimits as Record<string, number>).components = 1_000; }, TypeError);
});

test("ScenarioDocumentDiagnosticCodes is frozen and lists exactly the ADR-006 document codes", () => {
  assert.ok(Object.isFrozen(ScenarioDocumentDiagnosticCodes));
  assert.deepEqual(Object.keys(ScenarioDocumentDiagnosticCodes).sort(), [...adrCodes].sort());
  for (const [key, value] of Object.entries(ScenarioDocumentDiagnosticCodes)) assert.equal(value, key);
  assert.throws(() => { (ScenarioDocumentDiagnosticCodes as Record<string, string>).EXTRA = "EXTRA"; }, TypeError);
});

test("document codes do not reuse the envelope's existing scenario codes", () => {
  for (const code of ["REQUIRED", "TYPE", "UNSUPPORTED", "REFERENCE"]) assert.ok(!Object.hasOwn(ScenarioDocumentDiagnosticCodes, code));
});
