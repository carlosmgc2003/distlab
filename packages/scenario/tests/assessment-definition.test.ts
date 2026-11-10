import assert from "node:assert/strict";
import test from "node:test";
import type { AssessmentDefinition, AssessmentRow, CanonicalValue, LessonOverlayPolicy, ScenarioDiagnostic } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import { validateAssessmentDefinition, type AssessmentBaseLesson } from "@distlab/scenario";
import { engineFor, model, truePredicate } from "./support.ts";

const engine = engineFor([
  model({ model: "demo.client", kind: "client", actions: ["go"], instantiate: instance => ({
    id: instance.id, version: instance.version, callbacks: {}, initialState: {}, actions: { go: function* () { return null; } },
  }) }),
  model({ model: "demo.service", kind: "service", endpoints: ["GET /x"] }),
], [truePredicate]);
const validate = (document: CanonicalValue) => engine.validate(document);

const link = (source: string, target: string) => ({ source, target, policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 20, failureRate: 0 } });
const packaged = {
  version: 1, name: "assessment-fixture@1", seed: "seed-1", startTime: 0,
  architecture: {
    components: [
      { id: "client", kind: "client", model: "demo.client", version: "1", configuration: {} },
      { id: "svc", kind: "service", model: "demo.service", version: "1", configuration: { flag: false } },
    ],
    links: [link("client", "svc")],
    databases: [], stores: [], destinations: [], subscriptions: [],
  },
  external: [],
  // The base lesson of an assessment carries no packaged fault: the rows are the faults.
  faults: [],
  actions: [
    { id: "start-svc", at: 0, kind: "service", target: "svc", state: "RUNNING" },
    { id: "go", at: 0, kind: "client", target: "client", action: "go", data: {} },
  ],
  assertions: [
    { id: "kept", predicate: "demo.true", parameters: {}, mode: "always" },
    { id: "also-kept", predicate: "demo.true", parameters: {}, mode: "always" },
    { id: "setup", predicate: "demo.true", parameters: {}, mode: "at", at: 10 },
    { id: "unclassified", predicate: "demo.true", parameters: {}, mode: "always" },
  ],
  configuration: { startTime: 0, historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
};
const document = packaged as unknown as CanonicalValue;

const policy: LessonOverlayPolicy = {
  version: 1, lesson: "assessment-fixture@1",
  faults: { rules: [{ point: "network.response", effects: ["drop", "delay"] }], scheduled: ["crash"], maxEntries: 3 },
  parameters: [{ key: "flag", domain: { type: "boolean", default: false }, targets: [{ kind: "component", component: "svc", field: "flag" }] }],
};

const base: AssessmentBaseLesson = {
  document, policy,
  checks: [
    { id: "kept", kind: "invariant" },
    { id: "also-kept", kind: "invariant" },
    { id: "setup", kind: "expectation" },
  ],
};

const drop = (id: string, extra: Record<string, unknown> = {}) => ({
  id, point: "network.response", source: "svc", target: "client", name: "GET /x", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" }, ...extra,
}) as unknown as AssessmentRow["faults"][number];
const crash = (id: string, at: number, restart?: Record<string, unknown>) => ({
  id, at, kind: "fault", fault: { id: `${id}-fault`, kind: "crash", target: "svc" }, ...restart ? { restart } : {},
}) as unknown as AssessmentRow["scheduledFaults"][number];
const row = (id: string, faults: AssessmentRow["faults"] = [], scheduledFaults: AssessmentRow["scheduledFaults"] = []): AssessmentRow =>
  ({ id, label: id, faults, scheduledFaults });

const valid: AssessmentDefinition = {
  version: 1, id: "fixture-assessment@1", title: "Fixture", requirements: ["Keep the invariants."], base: "assessment-fixture@1",
  rows: [
    row("happy-path"),
    row("response-lost", [drop("student-row-lost-response")]),
    row("crash-and-restart", [], [crash("student-row-crash", 3, { after: 5 })]),
  ],
  invariants: [{ id: "kept", label: "Kept" }, { id: "also-kept", label: "Also kept" }],
};
const definition = (changes: Partial<AssessmentDefinition>): AssessmentDefinition => ({ ...valid, ...changes });
const codes = (diagnostics: readonly ScenarioDiagnostic[]) => diagnostics.map(item => `${item.path} ${item.code}`);
// An explicit `undefined` lesson means the caller found no packaged lesson, so it must not fall back to `base`.
const check = (changes: Partial<AssessmentDefinition>, ...lesson: [AssessmentBaseLesson | undefined] | []) =>
  codes(validateAssessmentDefinition(definition(changes), lesson.length ? lesson[0] : base, validate));

test("the fixture base lesson is a valid packaged document", () => {
  assert.deepEqual(engine.validate(document), []);
});

test("ASSESS-AC-2: a definition with a happy path, a student fault, and a crash with restart validates", () => {
  assert.deepEqual(validateAssessmentDefinition(valid, base, validate), []);
});

test("ASSESS-AC-2: `base` must name a packaged lesson", () => {
  // The caller found no packaged lesson with that name.
  assert.deepEqual(check({}, undefined), ["/base REFERENCE"]);
  // The caller resolved a different lesson than the one the definition names.
  assert.deepEqual(check({ base: "other-lesson@1" }), ["/base REFERENCE"]);
  // Without a base, list rules still apply; base-relative rules are not guessed.
  assert.deepEqual(check({ rows: [], invariants: [{ id: "missing", label: "Missing" }] }, undefined), ["/base REFERENCE", "/rows REQUIRED"]);
});

test("ASSESS-AC-2: rows and invariants are non-empty", () => {
  assert.deepEqual(check({ rows: [] }), ["/rows REQUIRED"]);
  assert.deepEqual(check({ invariants: [] }), ["/invariants REQUIRED"]);
});

test("ASSESS-AC-2: row and invariant IDs are unique", () => {
  assert.deepEqual(check({ rows: [row("a"), row("b"), row("a"), row("a")] }), ["/rows/2/id DUPLICATE", "/rows/3/id DUPLICATE"]);
  assert.deepEqual(check({ invariants: [{ id: "kept", label: "One" }, { id: "kept", label: "Two" }] }), ["/invariants/1/id DUPLICATE"]);
});

test("ASSESS-AC-2: every invariant is an assertion of the base document", () => {
  assert.deepEqual(check({ invariants: [{ id: "kept", label: "Kept" }, { id: "not-an-assertion", label: "Missing" }] }), ["/invariants/1/id REFERENCE"]);
});

test("ASSESS-AC-2: every invariant is classified as a business invariant, not a scenario expectation", () => {
  assert.deepEqual(check({ invariants: [{ id: "setup", label: "Setup" }] }), ["/invariants/0/id KIND"]);
  // An assertion the classification does not list is not a business invariant either.
  assert.deepEqual(check({ invariants: [{ id: "unclassified", label: "Unclassified" }] }), ["/invariants/0/id KIND"]);
  // A classification entry without a matching assertion does not make one.
  const listed: AssessmentBaseLesson = { ...base, checks: [...base.checks, { id: "ghost", kind: "invariant" }] };
  assert.deepEqual(check({ invariants: [{ id: "ghost", label: "Ghost" }] }, listed), ["/invariants/0/id REFERENCE"]);
});

test("ASSESS-AC-2: row faults need the student prefix and are reported at the row's path", () => {
  assert.deepEqual(check({ rows: [row("happy"), row("unprefixed", [drop("row-lost-response")], [crash("assessment-crash", 3)])] }), [
    "/rows/1/faults/0/id OVERLAY_ID_PREFIX",
    "/rows/1/scheduledFaults/0/fault/id OVERLAY_ID_PREFIX",
    "/rows/1/scheduledFaults/0/id OVERLAY_ID_PREFIX",
  ]);
});

test("ASSESS-AC-2: row faults must be allowed by the base policy", () => {
  const duplicate = drop("student-dup", { effect: { kind: "duplicate", additionalCopies: 1, spacing: 1 } });
  const request = drop("student-request", { point: "network.request", source: "client", target: "svc" });
  const outage = { id: "student-outage", at: 1, kind: "fault", fault: { id: "student-outage-fault", kind: "external-availability", target: "svc", state: "UNAVAILABLE" } } as unknown as AssessmentRow["scheduledFaults"][number];
  assert.deepEqual(check({ rows: [row("disallowed", [duplicate, request], [outage])] }), [
    "/rows/0/faults/0/effect/kind OVERLAY_NOT_ALLOWED",
    "/rows/0/faults/1/point OVERLAY_NOT_ALLOWED",
    "/rows/0/scheduledFaults/0/fault/kind OVERLAY_NOT_ALLOWED",
  ]);
  // A lesson without a policy accepts only the empty overlay (no allowed fault, an entry limit of 0): only a fault-free row composes.
  const closed: AssessmentBaseLesson = { ...base, policy: undefined };
  assert.deepEqual(check({ rows: [row("happy"), row("lost", [drop("student-lost")])] }, closed), ["/rows/1/faults/0 OVERLAY_LIMIT", "/rows/1/faults/0/point OVERLAY_NOT_ALLOWED"]);
});

test("ASSESS-AC-2 (D-6): each row fits the policy's maxEntries, a crash with restart counting once", () => {
  const atLimit = row("at-limit", [drop("student-a"), drop("student-b", { from: 10 })], [crash("student-c", 3, { after: 5 })]);
  assert.deepEqual(check({ rows: [atLimit] }), []);
  const over = row("over", [drop("student-a"), drop("student-b", { from: 10 }), drop("student-c", { from: 20 })], [crash("student-d", 3, { after: 5 })]);
  assert.deepEqual(check({ rows: [row("happy"), over] }), ["/rows/1/scheduledFaults/0 OVERLAY_LIMIT"]);
});

test("ASSESS-AC-2: a row's crash restart and applied-document diagnostics translate to the row", () => {
  const badRestart = row("bad-restart", [], [crash("student-crash", 3, { after: 0 })]);
  const unknownTarget = row("unknown-target", [drop("student-lost", { source: "nowhere" })]);
  const beforeStart = row("before-start", [], [crash("student-early", -1)]);
  // Stage 3 (the restart's `after`) and stage 4 (the applied document) both name the row's own entry.
  assert.deepEqual(check({ rows: [badRestart, unknownTarget, beforeStart] }), [
    "/rows/0/scheduledFaults/0/restart/after TIME",
    "/rows/1/faults/0/source UNKNOWN_COMPONENT",
    "/rows/2/scheduledFaults/0/at TIME",
  ]);
});

test("ASSESS-AC-2: a base lesson the scenario validator rejects is reported at /base", () => {
  const broken = () => [{ path: "/architecture/components/1/model", code: "UNKNOWN_MODEL" }];
  assert.deepEqual(codes(validateAssessmentDefinition(valid, base, broken)), ["/base UNKNOWN_MODEL"]);
});

test("ASSESS-AC-2: rows compose without the student's parameters", () => {
  // The policy's parameters are the student's configuration; a definition cannot set them, and validation sends none.
  const seen: CanonicalValue[] = [];
  validateAssessmentDefinition(valid, base, value => { seen.push(value); return validate(value); });
  for (const applied of seen) {
    const svc = ((applied as { architecture: { components: { id: string; configuration: { flag: boolean } }[] } }).architecture.components).find(item => item.id === "svc")!;
    assert.equal(svc.configuration.flag, false);
  }
});

test("ASSESS-AC-2: diagnostics are deterministic and sorted, and inputs are not changed", () => {
  const messy = definition({
    rows: [row("x", [drop("bad")]), row("x"), row("y", [], [crash("student-c", 3, { after: 0 })])],
    invariants: [{ id: "setup", label: "Setup" }, { id: "missing", label: "Missing" }, { id: "setup", label: "Again" }],
  });
  const before = canonicalEncode(messy as unknown as CanonicalValue);
  const first = validateAssessmentDefinition(messy, base, validate);
  const second = validateAssessmentDefinition(messy, base, validate);
  assert.deepEqual(first, second);
  assert.equal(canonicalEncode(first as unknown as CanonicalValue), canonicalEncode(second as unknown as CanonicalValue));
  assert.equal(canonicalEncode(messy as unknown as CanonicalValue), before);
  const sorted = [...first].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
  assert.deepEqual(first, sorted);
  assert.deepEqual(codes(first), [
    "/invariants/0/id KIND",
    "/invariants/1/id REFERENCE",
    "/invariants/2/id DUPLICATE",
    "/invariants/2/id KIND",
    "/rows/0/faults/0/id OVERLAY_ID_PREFIX",
    "/rows/1/id DUPLICATE",
    "/rows/2/scheduledFaults/0/restart/after TIME",
  ]);
});
