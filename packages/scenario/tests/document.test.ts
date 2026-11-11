import { test } from "node:test";
import assert from "node:assert/strict";
import { ScenarioDocumentDiagnosticCodes, ScenarioDocumentLimits } from "@distlab/contracts";
import type { CanonicalValue } from "@distlab/contracts/kernel";
import { DiagnosticCodes, documentDigest, parseDocumentText, validateScenarioDocument } from "@distlab/scenario";
import type { HostedCatalogRegistry } from "@distlab/scenario";
import { assessmentOf, catalogOf, model, predicate, truePredicate } from "./support.ts";

// ADR-006 document layer: parsing, envelope, limits, reserved names and IDs,
// and diagnostic ordering, against a fixture registry. Policy integrity and
// the packaged catalogs are covered in packages/catalogs/tests/document.test.ts.

let instantiated = 0;
let evaluated = 0;
const watched = model({ model: "demo.service", kind: "service", instantiate: () => { instantiated += 1; throw new Error("instantiated during validation"); } });
const registry: HostedCatalogRegistry = {
  catalogs: [
    { catalog: catalogOf([watched, model({ model: "demo.client", kind: "client", actions: ["go"] })], "1.0.0", "demo.catalog"),
      assessment: assessmentOf([truePredicate, predicate("demo.counted", () => { evaluated += 1; return { pass: true, evidence: null }; })]) },
    { catalog: catalogOf([model({ model: "demo.client", kind: "client" })], "2.0.0", "demo.catalog"), assessment: assessmentOf([truePredicate]) },
  ],
  reservedNames: ["packaged-lesson@1"],
};

type Doc = Record<string, unknown>;
const scenario = (extra: Doc = {}): Doc => ({
  version: 1, name: "imported@1", seed: "seed-1",
  architecture: { components: [{ id: "svc", kind: "service", model: "demo.service", version: "1", configuration: {} }] },
  assertions: [{ id: "always-true", predicate: "demo.true", parameters: {}, mode: "at", at: 0 }],
  ...extra,
});
const documentOf = (extra: Doc = {}): Doc => ({
  format: "distlab.scenario", formatVersion: 1,
  catalog: { id: "demo.catalog", version: "1.0.0" },
  presentation: { title: "Demo", summary: "A demo.", assertions: { "always-true": "Always true." } },
  scenario: scenario(),
  ...extra,
});
const check = (value: unknown) => validateScenarioDocument(typeof value === "string" ? value : JSON.stringify(value), registry);
const codes = (value: unknown) => {
  const result = check(value);
  return result.ok ? [] : result.diagnostics.map(item => `${item.path} ${item.code}`);
};
const stage = (value: unknown) => { const result = check(value); return result.ok ? "ok" : result.stage; };

test("a valid document normalizes its scenario, keeps its presentation, and resolves the exact catalog version", () => {
  const result = check(documentOf());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.hosted, registry.catalogs[0]);
  assert.deepEqual(result.document.catalog, { id: "demo.catalog", version: "1.0.0" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.document.presentation)), { title: "Demo", summary: "A demo.", assertions: { "always-true": "Always true." } });
  assert.equal(result.document.scenario.configuration.historyLimit, 100000);
  assert.equal(result.document.overlayPolicy, undefined);
  assert.equal(result.digest, documentDigest(JSON.parse(JSON.stringify(documentOf())) as CanonicalValue));
  assert.ok(Object.isFrozen(result.document));
});

// --- Stage 2: text ----------------------------------------------------------------------

test("DOC-AC-4 the parser accepts exactly RFC 8259 JSON", () => {
  const value = (text: string) => { const parsed = parseDocumentText(text); assert.deepEqual(parsed.diagnostics, [], text); return JSON.parse(JSON.stringify(parsed.value)) as unknown; };
  assert.deepEqual(value(' {"a" : [1, -2.5e3, true, false, null, "x\\n\\u00e9\\ud83d\\ude00\\/"], "b": {}} \r\n\t'),
    { a: [1, -2500, true, false, null, "x\né😀/"], b: {} });
  assert.equal(value("-0"), 0);
  assert.equal(value('"plain"'), "plain");
  for (const text of ["", "{", "[1,]", '{"a":1,}', "{'a':1}", '{"a" 1}', "01", "1.", ".5", "+1", "NaN", "Infinity", "1e400", "tru", "nul",
    '"tab\there"', '"\\x41"', '"\\u12"', "[1] [2]", "﻿{}", "// comment\n{}", '{"a":1}}', "[1 2]", '{"a":1 "b":2}', " {}"]) {
    assert.deepEqual(parseDocumentText(text).diagnostics, [{ path: "", code: ScenarioDocumentDiagnosticCodes.DOCUMENT_SYNTAX }], JSON.stringify(text));
  }
  assert.deepEqual(codes("{not json"), [" DOCUMENT_SYNTAX"]);
});

test("DOC-AC-4 duplicate keys and the __proto__ key are rejected at their JSON pointers", () => {
  const text = '{"format":"distlab.scenario","format":"x","scenario":{"name":"a","name":"b","nested":[{"x":1},{"__proto__":{"polluted":true},"a/b~c":1,"a/b~c":2}]}}';
  assert.deepEqual(codes(text), [
    "/format DUPLICATE_KEY",
    "/scenario/name DUPLICATE_KEY",
    "/scenario/nested/1/__proto__ RESERVED_KEY",
    "/scenario/nested/1/a~1b~0c DUPLICATE_KEY",
  ]);
  assert.equal(stage(text), "text");
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("DOC-AC-4 nesting deeper than the limit is rejected at the outermost container past it, without exhausting the stack", () => {
  const nested = (depth: number) => "[".repeat(depth) + "]".repeat(depth);
  assert.deepEqual(parseDocumentText(nested(ScenarioDocumentLimits.nestingDepth)).diagnostics, []);
  assert.deepEqual(parseDocumentText(nested(ScenarioDocumentLimits.nestingDepth + 1)).diagnostics, [{ path: `/${Array(ScenarioDocumentLimits.nestingDepth).fill("0").join("/")}`, code: "DOCUMENT_DEPTH" }]);
  // Deep enough to overflow a recursive parser, and still inside the byte limit.
  const deep = "[".repeat(100_000) + "]".repeat(100_000);
  assert.deepEqual(parseDocumentText(deep).diagnostics.map(item => item.code), ["DOCUMENT_DEPTH"]);
  // The document root, scenario, configuration, and models are depths 1 to 4, so the 29th array of `a` is the first past 32.
  assert.deepEqual(codes({ ...documentOf(), scenario: scenario({ configuration: { models: JSON.parse(`{"a":${nested(31)}}`) } }) }), [`/scenario/configuration/models/a${"/0".repeat(28)} DOCUMENT_DEPTH`]);
});

test("DOC-AC-4 an oversized document is rejected before parsing, counting UTF-8 bytes", () => {
  const limit = ScenarioDocumentLimits.documentBytes;
  // Not JSON at all: only the size is reported, so the text was never parsed.
  assert.deepEqual(codes("x".repeat(limit + 1)), [" DOCUMENT_SIZE"]);
  // Under the limit in UTF-16 code units, over it in UTF-8 bytes.
  const padded = (filler: string, count: number) => `"${filler.repeat(count)}"`;
  assert.deepEqual(parseDocumentText(padded("é", limit / 2)).diagnostics.map(item => item.code), ["DOCUMENT_SIZE"]);
  assert.deepEqual(parseDocumentText(padded("é", limit / 2 - 1)).diagnostics, []);
  assert.deepEqual(parseDocumentText(padded("😀", limit / 4)).diagnostics.map(item => item.code), ["DOCUMENT_SIZE"]);
  assert.deepEqual(parseDocumentText(padded("a", limit - 2)).diagnostics, []);
});

test("DOC-AC-3 the digest ignores whitespace and key order and changes with any value", () => {
  const compact = JSON.stringify(documentOf());
  const reordered = `{\n  "scenario": ${JSON.stringify(scenario(), null, 4)},\n  "presentation": {"assertions": {"always-true": "Always true."}, "summary": "A demo.", "title": "Demo"},\n  "catalog": {"version": "1.0.0", "id": "demo.catalog"}, "formatVersion": 1, "format": "distlab.scenario"\n}`;
  const digest = (text: string) => { const result = check(text); assert.ok(result.ok); return result.digest; };
  assert.equal(digest(reordered), digest(compact));
  assert.notEqual(digest(JSON.stringify({ ...documentOf(), presentation: { title: "Demo!" } })), digest(compact));
});

// --- Stage 3: envelope ------------------------------------------------------------------

test("DOC-AC-7 format and an unsupported formatVersion stop the envelope stage", () => {
  assert.deepEqual(codes({ ...documentOf(), format: "distlab.lesson", extra: 1 }), ["/format FORMAT"]);
  assert.deepEqual(codes({ ...documentOf(), formatVersion: 2, newField: true }), ["/formatVersion FORMAT_VERSION"]);
  assert.deepEqual(codes({ ...documentOf(), formatVersion: "1" }), ["/formatVersion TYPE"]);
  const { format: _format, formatVersion: _version, ...bare } = documentOf();
  assert.deepEqual(codes(bare), ["/format REQUIRED", "/formatVersion REQUIRED"]);
  assert.deepEqual(codes([]), [" TYPE"]);
});

test("DOC-AC-7 an unknown key at any envelope level is UNSUPPORTED, and the scenario's own keys are the engine's", () => {
  assert.deepEqual(codes({
    ...documentOf(), extra: 1,
    catalog: { id: "demo.catalog", version: "1.0.0", channel: "beta" },
    presentation: { title: "Demo", subtitle: "x" },
    overlayPolicy: { version: 1, lesson: "imported@1", faults: { rules: [{ point: "network.request", effects: [], weight: 1 }], scheduled: [], maxEntries: 1, extra: 1 }, parameters: [], future: true },
  }), [
    "/catalog/channel UNSUPPORTED",
    "/extra UNSUPPORTED",
    "/overlayPolicy/faults/extra UNSUPPORTED",
    "/overlayPolicy/faults/rules/0/weight UNSUPPORTED",
    "/overlayPolicy/future UNSUPPORTED",
    "/presentation/subtitle UNSUPPORTED",
  ]);
  assert.deepEqual(codes({ ...documentOf(), scenario: scenario({ shorthand: { external: {} } }) }), ["/scenario/shorthand UNSUPPORTED"]);
});

test("DOC-AC-7 an unknown catalog and an unhosted version of a known catalog are distinct diagnostics", () => {
  assert.deepEqual(codes({ ...documentOf(), catalog: { id: "demo.other", version: "1.0.0" } }), ["/catalog/id UNKNOWN_CATALOG"]);
  assert.deepEqual(codes({ ...documentOf(), catalog: { id: "demo.catalog", version: "3.0.0" } }), ["/catalog/version CATALOG_VERSION"]);
  // The catalog is never inferred from model names: version 2.0.0 of the same catalog is a different hosted catalog.
  const result = check({ ...documentOf(), catalog: { id: "demo.catalog", version: "2.0.0" } });
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics.map(item => `${item.path} ${item.code}`), ["/scenario/architecture/components/0/model UNKNOWN_MODEL"]);
  assert.deepEqual(codes({ ...documentOf(), catalog: { id: 1 } }), ["/catalog/id TYPE", "/catalog/version REQUIRED"]);
});

test("envelope members are required and typed, and presentation text has length limits", () => {
  assert.deepEqual(codes({ format: "distlab.scenario", formatVersion: 1 }), ["/catalog REQUIRED", "/presentation REQUIRED", "/scenario REQUIRED"]);
  assert.deepEqual(codes({ ...documentOf(), scenario: [], presentation: { title: 7, summary: null, assertions: { a: 1 } } }),
    ["/presentation/assertions/a TYPE", "/presentation/summary TYPE", "/presentation/title TYPE", "/scenario TYPE"]);
  const { titleLength, summaryLength, assertionLabelLength } = ScenarioDocumentLimits;
  const presentation = (title: string, summary: string, label: string) => codes({ ...documentOf(), presentation: { title, summary, assertions: { "always-true": label } } });
  assert.deepEqual(presentation("t".repeat(titleLength), "s".repeat(summaryLength), "l".repeat(assertionLabelLength)), []);
  // Limits count characters (code points), not UTF-16 units.
  assert.deepEqual(presentation("😀".repeat(titleLength), "s", "l"), []);
  assert.deepEqual(presentation("t".repeat(titleLength + 1), "s".repeat(summaryLength + 1), "l".repeat(assertionLabelLength + 1)),
    ["/presentation/assertions/always-true DOCUMENT_LIMIT", "/presentation/summary DOCUMENT_LIMIT", "/presentation/title DOCUMENT_LIMIT"]);
});

test("the overlay policy's shape is checked in the envelope stage", () => {
  assert.deepEqual(codes({ ...documentOf(), overlayPolicy: { version: 2, lesson: 1, faults: { rules: [{ point: "disk.write", effects: ["melt"] }, { point: "network.request", effects: [] }, { point: "network.request", effects: [] }], scheduled: ["flood"], maxEntries: -1 },
    parameters: [{ key: "", domain: { type: "float", default: 1 }, targets: [{ kind: "file", field: "x" }] }, { key: "a", domain: { type: "integer", default: 1, minimum: 0.5 }, targets: {} }, { key: "a", domain: { type: "choice", default: "x", choices: [1] }, targets: [] }],
    architecture: { slots: [{ component: "svc" }], bindings: [{ component: "svc", peer: "p", candidates: [2] }], resources: [{ owner: "svc", resource: "queue" }], subscriptions: [{}], linkPolicy: { requestLatency: "1" }, maxEdits: 1.5 } } }), [
    "/overlayPolicy/architecture/bindings/0/candidates/0 TYPE",
    "/overlayPolicy/architecture/linkPolicy/failureRate REQUIRED",
    "/overlayPolicy/architecture/linkPolicy/jitter REQUIRED",
    "/overlayPolicy/architecture/linkPolicy/requestLatency TYPE",
    "/overlayPolicy/architecture/linkPolicy/responseLatency REQUIRED",
    "/overlayPolicy/architecture/linkPolicy/timeout REQUIRED",
    "/overlayPolicy/architecture/maxEdits TYPE",
    "/overlayPolicy/architecture/resources/0/resource TYPE",
    "/overlayPolicy/architecture/slots/0/models REQUIRED",
    "/overlayPolicy/architecture/subscriptions/0/consumer REQUIRED",
    "/overlayPolicy/architecture/subscriptions/0/destination REQUIRED",
    "/overlayPolicy/faults/maxEntries TYPE",
    "/overlayPolicy/faults/rules/0/effects/0 FAULT",
    "/overlayPolicy/faults/rules/0/point FAULT",
    "/overlayPolicy/faults/rules/2/point DUPLICATE",
    "/overlayPolicy/faults/scheduled/0 FAULT",
    "/overlayPolicy/lesson TYPE",
    "/overlayPolicy/parameters/0/domain/type TYPE",
    "/overlayPolicy/parameters/0/key REQUIRED",
    "/overlayPolicy/parameters/0/targets/0/kind TYPE",
    "/overlayPolicy/parameters/1/domain/maximum REQUIRED",
    "/overlayPolicy/parameters/1/domain/minimum TYPE",
    "/overlayPolicy/parameters/1/targets TYPE",
    "/overlayPolicy/parameters/2/domain/choices/0 TYPE",
    "/overlayPolicy/parameters/2/key DUPLICATE",
    "/overlayPolicy/version VERSION",
  ]);
});

// --- Stage 4: scenario ------------------------------------------------------------------

test("engine diagnostics are prefixed with /scenario and a label must name an existing assertion", () => {
  assert.deepEqual(codes({ ...documentOf(), presentation: { title: "Demo", assertions: { "always-true": "x", ghost: "y" } }, scenario: scenario({ seed: 42, architecture: { components: [{ id: "svc", kind: "service", model: "demo.missing", version: "1" }] } }) }), [
    "/presentation/assertions/ghost REFERENCE",
    "/scenario/architecture/components/0/model UNKNOWN_MODEL",
    "/scenario/seed TYPE",
  ]);
  assert.equal(stage({ ...documentOf(), scenario: scenario({ seed: 42 }) }), "scenario");
});

test("DOC-AC-4 count limits and historyLimit are checked before engine validation", () => {
  const many = (count: number, item: (index: number) => unknown) => Array.from({ length: count }, (_, index) => item(index));
  const components = many(ScenarioDocumentLimits.components + 1, index => ({ id: `c${index}`, kind: "service", model: "demo.missing", version: "1" }));
  const result = codes({ ...documentOf(), presentation: { title: "Demo" }, scenario: scenario({
    architecture: { components, links: many(ScenarioDocumentLimits.links + 1, () => ({})) },
    actions: many(ScenarioDocumentLimits.actions + 1, () => ({})),
    faults: many(ScenarioDocumentLimits.faultRules + 1, () => ({})),
    assertions: many(ScenarioDocumentLimits.assertions + 1, () => ({})),
    configuration: { historyLimit: ScenarioDocumentLimits.historyLimit + 1 },
  }) });
  // The engine did not run: no UNKNOWN_MODEL or schema diagnostics, only the limits.
  assert.deepEqual(result, [
    "/scenario/actions DOCUMENT_LIMIT",
    "/scenario/architecture/components DOCUMENT_LIMIT",
    "/scenario/architecture/links DOCUMENT_LIMIT",
    "/scenario/assertions DOCUMENT_LIMIT",
    "/scenario/configuration/historyLimit DOCUMENT_LIMIT",
    "/scenario/faults DOCUMENT_LIMIT",
  ]);
  assert.deepEqual(codes({ ...documentOf(), scenario: scenario({ configuration: { historyLimit: ScenarioDocumentLimits.historyLimit } }) }), []);
});

test("DOC-AC-4 a packaged scenario name and any student- ID are reserved", () => {
  assert.deepEqual(codes({ ...documentOf(), scenario: scenario({ name: " packaged-lesson@1 " }) }), ["/scenario/name RESERVED_NAME"]);
  assert.deepEqual(codes({ ...documentOf(), presentation: { title: "Demo" }, scenario: scenario({
    architecture: {
      components: [{ id: "student-svc", kind: "service", model: "demo.service", version: "1" }],
      destinations: [{ id: "student-topic", kind: "topic" }],
    },
    faults: [{ id: "student-rule", point: "network.request", from: 0, effect: { kind: "drop" } }],
    actions: [{ id: "student-start", at: 0, kind: "service", target: "student-svc", state: "RUNNING" },
      { id: "crash", at: 1, kind: "fault", fault: { id: "student-crash", kind: "crash", target: "student-svc" } }],
    assertions: [{ id: "student-check", predicate: "demo.true", parameters: {}, mode: "at", at: 0 }],
  }) }), [
    "/scenario/actions/0/id RESERVED_ID",
    "/scenario/actions/1/fault/id RESERVED_ID",
    "/scenario/architecture/components/0/id RESERVED_ID",
    "/scenario/architecture/destinations/0/id RESERVED_ID",
    "/scenario/assertions/0/id RESERVED_ID",
    "/scenario/faults/0/id RESERVED_ID",
  ]);
});

test("DOC-AC-4 strings that look like code stay inert data", () => {
  const code = "<script>globalThis.pwned = true</script>${globalThis.pwned = true}";
  const result = check({ ...documentOf(), presentation: { title: code, summary: "javascript:alert(1)" }, scenario: scenario({ name: `${code}@1`, seed: "require('fs')" }) });
  assert.ok(result.ok);
  assert.equal(result.document.presentation.title, code);
  assert.equal(result.document.scenario.name, `${code}@1`);
  assert.equal((globalThis as { pwned?: boolean }).pwned, undefined);
});

// --- Staging and purity -----------------------------------------------------------------

test("DOC-AC-4 validation stops at the first failing stage and sorts its diagnostics by path, then code", () => {
  // An envelope failure hides scenario failures; a text failure hides everything.
  assert.deepEqual(codes({ ...documentOf(), catalog: { id: "demo.other", version: "1.0.0" }, scenario: scenario({ seed: 42 }) }), ["/catalog/id UNKNOWN_CATALOG"]);
  assert.equal(stage('{"format":"distlab.scenario","format":"distlab.scenario"}'), "text");
  const result = check({ ...documentOf(), scenario: scenario({ name: "packaged-lesson@1", seed: 1, version: 2 }) });
  assert.ok(!result.ok);
  const sorted = [...result.diagnostics].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  assert.deepEqual(result.diagnostics, sorted);
  assert.deepEqual(result.diagnostics.map(item => `${item.path} ${item.code}`), ["/scenario/name RESERVED_NAME", "/scenario/seed TYPE", "/scenario/version VERSION"]);
});

test("DOC-AC-4 validation instantiates no model, evaluates no predicate, and draws no randomness", () => {
  const random = Math.random;
  Math.random = () => { throw new Error("Math.random during validation"); };
  try {
    const counted = { ...documentOf(), scenario: scenario({ assertions: [{ id: "counted", predicate: "demo.counted", parameters: {}, mode: "at", at: 0 }] }), presentation: { title: "Demo" } };
    assert.ok(check(counted).ok);
    for (const text of ["{", '{"a":1,"a":2}', JSON.stringify({ ...counted, formatVersion: 9 }), JSON.stringify({ ...counted, scenario: scenario({ name: "packaged-lesson@1" }) })]) {
      assert.equal(check(text).ok, false);
    }
  } finally { Math.random = random; }
  assert.equal(instantiated, 0);
  assert.equal(evaluated, 0);
});

test("#121 an imported workload call to a misspelled endpoint fails validation at its /scenario path", () => {
  const workloadRegistry: HostedCatalogRegistry = {
    catalogs: [{
      catalog: catalogOf([
        model({ model: "demo.orders", kind: "service", endpoints: ["POST /checkout"] }),
        model({ model: "demo.shopper", kind: "client", actions: ["request"], workloadCalls: [{ action: "request", target: "target", endpoint: "endpoint" }] }),
      ], "1.0.0", "demo.catalog"),
      assessment: assessmentOf([truePredicate]),
    }],
    reservedNames: [],
  };
  const withEndpoint = (endpoint: string) => JSON.stringify(documentOf({ scenario: scenario({
    architecture: {
      components: [
        { id: "shopper", kind: "client", model: "demo.shopper", version: "1", configuration: {} },
        { id: "orders", kind: "service", model: "demo.orders", version: "1", configuration: {} },
      ],
      links: [{ source: "shopper", target: "orders" }],
    },
    actions: [{ id: "checkout", at: 0, kind: "client", target: "shopper", action: "request", data: { target: "orders", endpoint } }],
  }) }));
  assert.ok(validateScenarioDocument(withEndpoint("POST /checkout"), workloadRegistry).ok);
  const result = validateScenarioDocument(withEndpoint("POST /chekout"), workloadRegistry);
  assert.ok(!result.ok);
  assert.equal(result.stage, "scenario");
  assert.deepEqual(result.diagnostics.map(item => `${item.path} ${item.code}`), ["/scenario/actions/0/data/endpoint INTERFACE"]);
});

test("diagnostic codes come from the contract constants and the existing scenario codes", () => {
  const known = new Set<string>([...Object.values(ScenarioDocumentDiagnosticCodes), ...Object.values(DiagnosticCodes)]);
  const samples = [codes("{"), codes({ ...documentOf(), formatVersion: 3 }), codes({ ...documentOf(), presentation: { title: "x", assertions: { ghost: "y" } } })];
  for (const item of samples.flat()) assert.ok(known.has(item.split(" ")[1]!), item);
});
