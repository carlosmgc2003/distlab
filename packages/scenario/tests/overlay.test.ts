import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, LessonOverlayPolicy, ScenarioDiagnostic } from "@distlab/contracts";
import { OverlayDiagnosticCodes, STUDENT_ID_PREFIX } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import { EMPTY_OVERLAY, applyOverlay, composeOverlay, resolveTarget, validateOverlay } from "@distlab/scenario";
import { engineFor, model, truePredicate } from "./support.ts";

const models = [
  model({ model: "demo.client", kind: "client", actions: ["go"], instantiate: instance => ({
    id: instance.id, version: instance.version, callbacks: {}, initialState: {}, actions: { go: function* () { return null; } },
  }) }),
  model({ model: "demo.service", kind: "service", endpoints: ["GET /x"], consumers: ["Topic"] }),
  model({ model: "demo.external", kind: "external", operations: ["POST /y"] }),
];
const engine = engineFor(models, [truePredicate]);

const packaged = {
  version: 1, name: "overlay-fixture@1", seed: "seed-1", startTime: 0,
  architecture: {
    components: [
      { id: "client", kind: "client", model: "demo.client", version: "1", configuration: {} },
      { id: "svc", kind: "service", model: "demo.service", version: "1", configuration: { flag: false } },
      { id: "ext", kind: "external", model: "demo.external", version: "1", configuration: {} },
    ],
    links: [
      { source: "client", target: "svc", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 20, failureRate: 0 } },
      { source: "svc", target: "ext", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 20, failureRate: 0 } },
    ],
    databases: [{ owner: "svc", tables: [{ name: "rows", unique: [], checks: [] }], initial: { rows: {} } }],
    stores: [],
    destinations: [{ id: "Topic", kind: "topic", deliveryDelay: 1, ackTimeout: 10, retryDelay: 1, maxAttempts: 3, capacity: 100 }],
    subscriptions: [{ destination: "Topic", consumer: "svc" }],
  },
  external: [],
  faults: [{ id: "packaged-drop", point: "network.response", source: "svc", target: "client", name: "GET /x", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
  actions: [
    { id: "start-svc", at: 0, kind: "service", target: "svc", state: "RUNNING" },
    { id: "go", at: 0, kind: "client", target: "client", action: "go", data: { mode: "fast", retries: 1 } },
  ],
  assertions: [{ id: "ok", predicate: "demo.true", parameters: {}, mode: "always" }],
  configuration: { startTime: 0, historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
} as const satisfies Record<string, unknown>;
const document = packaged as unknown as CanonicalValue;

const policy: LessonOverlayPolicy = {
  version: 1, lesson: "overlay-fixture@1",
  faults: {
    rules: [{ point: "network.response", effects: ["drop", "delay"] }, { point: "message.delivery", effects: ["duplicate"] }],
    scheduled: ["crash"],
    maxEntries: 3,
  },
  parameters: [
    { key: "timeout", domain: { type: "integer", default: 20, minimum: 5, maximum: 100 }, targets: [
      { kind: "link", source: "client", target: "svc", field: "timeout" },
      { kind: "link", source: "svc", target: "ext", field: "timeout" },
    ] },
    { key: "flag", domain: { type: "boolean", default: false }, targets: [{ kind: "component", component: "svc", field: "flag" }] },
    { key: "mode", domain: { type: "choice", default: "fast", choices: ["fast", "slow"] }, targets: [{ kind: "action", action: "go", field: "mode" }] },
    { key: "attempts", domain: { type: "integer", default: 3, minimum: 1, maximum: 5 }, targets: [{ kind: "destination", destination: "Topic", field: "maxAttempts" }] },
  ],
};

const rule = (id: string, extra: Record<string, unknown> = {}) => ({ id, point: "network.response", source: "svc", target: "client", from: 0, effect: { kind: "delay", duration: 5 }, ...extra });
const crash = (id: string, at = 1) => ({ id, at, kind: "fault", fault: { id: `${id}-fault`, kind: "crash", target: "svc" } });
const overlay = (body: Record<string, unknown>) => ({ version: 1, ...body }) as unknown as CanonicalValue;
const codes = (diagnostics: readonly ScenarioDiagnostic[]) => diagnostics.map(item => `${item.path} ${item.code}`);

test("the fixture is a valid packaged document", () => {
  assert.deepEqual(engine.validate(document), []);
  assert.equal(STUDENT_ID_PREFIX, "student-");
});

test("absent, empty, and all-default overlays give the packaged document exactly", () => {
  const absent = validateOverlay(undefined, policy);
  assert.equal(absent.overlay, EMPTY_OVERLAY);
  assert.equal(applyOverlay(document, policy, absent.overlay!), document);
  for (const input of [overlay({}), overlay({ faults: [], scheduledFaults: [], parameters: [] }),
    overlay({ parameters: policy.parameters.map(item => ({ key: item.key, value: item.domain.default })) })]) {
    const result = composeOverlay(document, policy, input, value => engine.validate(value));
    assert.ok(result.ok);
    assert.deepEqual(result.overlay, EMPTY_OVERLAY);
    assert.equal(canonicalEncode(result.document), canonicalEncode(document));
  }
});

test("normalization applies fault defaults, keeps entry order, sorts overrides and drops defaults", () => {
  const result = validateOverlay(overlay({
    faults: [rule("student-b"), rule("student-a", { probability: 0.5, maxApplications: 2 })],
    scheduledFaults: [crash("student-c")],
    parameters: [{ key: "timeout", value: 40 }, { key: "flag", value: true }, { key: "mode", value: "fast" }],
  }), policy);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.overlay!.faults.map(item => [item.id, item.probability, item.maxApplications]), [["student-b", 1, 1], ["student-a", 0.5, 2]]);
  assert.deepEqual(result.overlay!.parameters, [{ key: "flag", value: true }, { key: "timeout", value: 40 }]);
});

test("composition appends student entries after packaged ones and overrides every declared target", () => {
  const result = composeOverlay(document, policy, overlay({
    faults: [rule("student-delay")], scheduledFaults: [crash("student-crash")],
    parameters: [{ key: "timeout", value: 40 }, { key: "flag", value: true }, { key: "mode", value: "slow" }, { key: "attempts", value: 5 }],
  }), value => engine.validate(value));
  assert.ok(result.ok, JSON.stringify(result));
  const applied = result.document as unknown as typeof packaged;
  assert.deepEqual(applied.faults.map(item => item.id), ["packaged-drop", "student-delay"]);
  assert.deepEqual(applied.actions.map(item => item.id), ["start-svc", "go", "student-crash"]);
  assert.deepEqual(applied.architecture.links.map(link => link.policy.timeout), [40, 40]);
  assert.equal(applied.architecture.components[1]!.configuration.flag, true);
  assert.deepEqual(JSON.parse(JSON.stringify(applied.actions[1])), { ...packaged.actions[1], data: { mode: "slow", retries: 1 } });
  assert.equal(applied.architecture.destinations[0]!.maxAttempts, 5);
  for (const key of ["name", "seed", "startTime", "external", "assertions", "configuration"] as const) {
    assert.equal(canonicalEncode((applied as Record<string, unknown>)[key] as CanonicalValue), canonicalEncode(packaged[key] as unknown as CanonicalValue), key);
  }
  // The packaged document is never mutated.
  assert.equal(packaged.architecture.links[0].policy.timeout, 20);
});

test("every overlay diagnostic code is reported at an overlay path, sorted by path then code, before the document is applied", () => {
  let validated = 0;
  const validate = (value: CanonicalValue) => { validated++; return engine.validate(value); };
  const cases: [Record<string, unknown>, string[]][] = [
    [{ faults: [{ ...rule("student-x"), point: "network.request" }] }, ["/faults/0/point OVERLAY_NOT_ALLOWED"]],
    [{ faults: [{ ...rule("student-x"), effect: { kind: "duplicate", additionalCopies: 1, spacing: 1 } }] }, ["/faults/0/effect/kind OVERLAY_NOT_ALLOWED"]],
    [{ scheduledFaults: [{ id: "student-x", at: 1, kind: "fault", fault: { id: "student-y", kind: "external-availability", target: "ext", state: "UNAVAILABLE" } }] }, ["/scheduledFaults/0/fault/kind OVERLAY_NOT_ALLOWED"]],
    [{ faults: [rule("drop-it")], scheduledFaults: [{ ...crash("student-c"), fault: { id: "c", kind: "crash", target: "svc" } }] },
      ["/faults/0/id OVERLAY_ID_PREFIX", "/scheduledFaults/0/fault/id OVERLAY_ID_PREFIX"]],
    [{ faults: [rule("student-1"), rule("student-2", { from: 5 })], scheduledFaults: [crash("student-3"), crash("student-4")] }, ["/scheduledFaults/1 OVERLAY_LIMIT"]],
    [{ parameters: [{ key: "retries", value: 2 }] }, ["/parameters/0/key UNKNOWN_PARAMETER"]],
    [{ parameters: [{ key: "timeout", value: 4 }, { key: "flag", value: "yes" }, { key: "mode", value: "medium" }, { key: "attempts", value: 1.5 }] },
      ["/parameters/0/value PARAMETER_VALUE", "/parameters/1/value PARAMETER_VALUE", "/parameters/2/value PARAMETER_VALUE", "/parameters/3/value PARAMETER_VALUE"]],
    [{ parameters: [{ key: "flag", value: true }, { key: "flag", value: false }] }, ["/parameters/1/key DUPLICATE"]],
    [{ version: 2, extra: true }, ["/extra UNSUPPORTED", "/version VERSION"]],
  ];
  for (const [body, expected] of cases) {
    const result = composeOverlay(document, policy, { version: 1, ...body } as unknown as CanonicalValue, validate);
    assert.ok(!result.ok);
    assert.equal(result.code, "INVALID_OVERLAY");
    assert.deepEqual(codes(result.diagnostics), expected, JSON.stringify(body));
  }
  assert.equal(validated, 0, "policy, prefix and limit failures stop before the overlay is applied");
  assert.deepEqual(Object.values(OverlayDiagnosticCodes).sort(), ["OVERLAY_ID_PREFIX", "OVERLAY_LIMIT", "OVERLAY_NOT_ALLOWED", "PARAMETER_VALUE", "UNKNOWN_PARAMETER"]);
});

test("a lesson without a policy accepts only the empty overlay", () => {
  assert.ok(composeOverlay(document, undefined, overlay({}), value => engine.validate(value)).ok);
  const result = composeOverlay(document, undefined, overlay({ faults: [rule("student-a")], scheduledFaults: [crash("student-b")] }), value => engine.validate(value));
  assert.ok(!result.ok);
  assert.deepEqual(codes(result.diagnostics), ["/faults/0 OVERLAY_LIMIT", "/faults/0/point OVERLAY_NOT_ALLOWED", "/scheduledFaults/0 OVERLAY_LIMIT", "/scheduledFaults/0/fault/kind OVERLAY_NOT_ALLOWED"]);
});

test("applied-document diagnostics in student entries are translated to overlay paths", () => {
  const result = composeOverlay(document, policy, overlay({
    faults: [rule("student-window", { from: 10, until: 5 }), rule("student-ghost", { target: "nobody" })],
    scheduledFaults: [{ ...crash("student-dup"), fault: { id: "student-window", kind: "crash", target: "svc" } }],
  }), value => engine.validate(value));
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_OVERLAY");
  assert.deepEqual(codes(result.diagnostics), [
    "/faults/0/until FAULT",
    "/faults/1/target UNKNOWN_COMPONENT",
    "/scheduledFaults/0/fault/id DUPLICATE",
  ]);
  const late = composeOverlay(document, policy, overlay({ scheduledFaults: [crash("student-late", "soon" as unknown as number)] }), value => engine.validate(value));
  assert.ok(!late.ok);
  assert.deepEqual(codes(late.diagnostics), ["/scheduledFaults/0/at TYPE"]);
});

test("a diagnostic at a parameter target maps to the submitted override; any other diagnostic is a catalog defect", () => {
  const input = overlay({ parameters: [{ key: "flag", value: true }, { key: "timeout", value: 40 }] });
  const atTarget = composeOverlay(document, policy, input, () => [{ path: "/architecture/links/1/policy/timeout", code: "TYPE" }]);
  assert.ok(!atTarget.ok);
  assert.deepEqual([atTarget.code, ...codes(atTarget.diagnostics)], ["INVALID_OVERLAY", "/parameters/1/value TYPE"]);
  const packagedDefect = composeOverlay(document, policy, input, () => [{ path: "/faults/0/id", code: "DUPLICATE" }]);
  assert.ok(!packagedDefect.ok);
  assert.equal(packagedDefect.code, "INVALID_SCENARIO");
});

test("parameter targets resolve by stable identity", () => {
  assert.equal(resolveTarget(document, { kind: "link", source: "svc", target: "ext", field: "timeout" })?.path, "/architecture/links/1/policy/timeout");
  assert.equal(resolveTarget(document, { kind: "component", component: "svc", field: "flag" })?.path, "/architecture/components/1/configuration/flag");
  assert.equal(resolveTarget(document, { kind: "destination", destination: "Topic", field: "maxAttempts" })?.path, "/architecture/destinations/0/maxAttempts");
  assert.equal(resolveTarget(document, { kind: "action", action: "go", field: "mode" })?.path, "/actions/1/data/mode");
  assert.equal(resolveTarget(document, { kind: "action", action: "start-svc", field: "state" }), undefined, "only client action data is a target");
  assert.equal(resolveTarget(document, { kind: "component", component: "svc", field: "missing" }), undefined);
});

test("overlaid sessions replay deterministically and change the input-derived runId", async () => {
  const input = overlay({ faults: [rule("student-delay", { name: "GET /x" })], scheduledFaults: [crash("student-crash", 3)] });
  const runs = [];
  for (let index = 0; index < 2; index++) {
    const result = composeOverlay(document, policy, input, value => engine.validate(value));
    assert.ok(result.ok);
    const session = engine.create(result.document);
    await session.simulation.run();
    runs.push(session.simulation.history.export());
  }
  assert.equal(canonicalEncode(runs[0] as unknown as CanonicalValue), canonicalEncode(runs[1] as unknown as CanonicalValue));
  const plain = engine.create(document);
  await plain.simulation.run();
  assert.notEqual(runs[0]!.runId, plain.simulation.history.export().runId);
});
