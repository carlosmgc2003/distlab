import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalValue, LessonOverlayPolicy, LessonParameter, ScenarioDefinition } from "@distlab/contracts";
import { STUDENT_ID_PREFIX } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutAssessment, checkoutCatalog, checkoutOverlayPolicy, commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames,
  commerceOverlayPolicy, commerceScenario, normalCheckout, responseLostCheckout,
} from "@distlab/catalogs";
import { DeterministicScenarioEngine, composeOverlay, inDomain, openHarness, resolveTarget } from "@distlab/scenario";
import type { HarnessExport, ScenarioCatalog } from "@distlab/scenario";

interface Lesson {
  readonly id: string;
  readonly document: CanonicalValue;
  readonly policy: LessonOverlayPolicy;
  readonly engine: DeterministicScenarioEngine;
  readonly catalog: ScenarioCatalog;
}

const checkoutEngine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });
const commerceEngine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const lessons: readonly Lesson[] = [
  { id: "normal", document: normalCheckout, policy: checkoutOverlayPolicy("normal"), engine: checkoutEngine, catalog: checkoutCatalog },
  { id: "response-lost", document: responseLostCheckout, policy: checkoutOverlayPolicy("response-lost"), engine: checkoutEngine, catalog: checkoutCatalog },
  ...commerceLessonNames.map(name => ({ id: name, document: commerceScenario(name), policy: commerceOverlayPolicy(name), engine: commerceEngine, catalog: commerceCatalog })),
];
const definition = (lesson: Lesson) => lesson.document as unknown as ScenarioDefinition;
const encode = (value: unknown) => canonicalEncode(value as CanonicalValue);

function compose(lesson: Lesson, overlay: unknown) {
  const result = composeOverlay(lesson.document, lesson.policy, overlay as CanonicalValue | undefined, value => lesson.engine.validate(value), lesson.catalog);
  assert.ok(result.ok, `${lesson.id}: ${JSON.stringify(result)}`);
  return result;
}
async function run(lesson: Lesson, overlay: unknown, options: { maxEvents?: number; step?: boolean } = {}): Promise<HarnessExport> {
  const session = openHarness(lesson.engine.create(compose(lesson, overlay).document));
  if (options.step) { while ((await session.step()) !== undefined) { /* one event at a time */ } }
  else if (options.maxEvents) { while ((await session.run({ maxEvents: options.maxEvents })).status === "PAUSED") { /* resume */ } }
  else await session.run();
  return session.inspect();
}

/** A value inside the parameter's domain that differs from its default. */
function nonDefault(parameter: LessonParameter): CanonicalValue {
  const domain = parameter.domain;
  if (domain.type === "boolean") return !domain.default;
  if (domain.type === "integer") return domain.default < domain.maximum ? domain.default + 1 : domain.default - 1;
  return domain.choices.find(choice => choice !== domain.default)!;
}

/** OVL-AC-2 fixture: a seeded probabilistic rule, a non-default parameter, and, where the policy allows one, a scheduled fault. */
function fixture(lesson: Lesson) {
  const doc = definition(lesson);
  const link = doc.architecture.links[0]!;
  const scheduled = lesson.policy.faults.scheduled.includes("external-availability")
    ? { id: "student-outage", at: 1, kind: "fault", fault: { id: "student-outage-fault", kind: "external-availability", target: doc.architecture.components.find(item => item.kind === "external")!.id, state: "RATE_LIMITED" } }
    : lesson.policy.faults.scheduled.includes("crash")
      ? { id: "student-crash", at: 2, kind: "fault", fault: { id: "student-crash-fault", kind: "crash", target: doc.architecture.components.find(item => item.kind === "service")!.id } }
      : undefined;
  return {
    version: 1,
    faults: [{ id: "student-coin", point: "network.request", source: link.source, target: link.target, from: 0, probability: 0.5, maxApplications: 4, effect: { kind: "delay", duration: 3 } }],
    scheduledFaults: scheduled ? [scheduled] : [],
    parameters: lesson.policy.parameters.slice(0, 1).map(parameter => ({ key: parameter.key, value: nonDefault(parameter) })),
  };
}

test("OVL-AC-1 absent, empty, and all-default overlays reproduce every packaged lesson exactly", async () => {
  for (const lesson of lessons) {
    const packaged = openHarness(lesson.engine.create(lesson.document));
    await packaged.run();
    const expected = packaged.inspect();
    const defaults = { version: 1, parameters: lesson.policy.parameters.map(item => ({ key: item.key, value: item.domain.default })) };
    for (const overlay of [undefined, { version: 1 }, defaults]) {
      const result = compose(lesson, overlay);
      assert.equal(encode(result.document), encode(lesson.document), lesson.id);
      const actual = await run(lesson, overlay);
      assert.equal(actual.history.runId, expected.history.runId, lesson.id);
      assert.equal(actual.digest, expected.digest, lesson.id);
      assert.equal(encode(actual), encode(expected), lesson.id);
    }
  }
});

test("ARCH-AC-1 overlays without architecture edits reproduce every packaged lesson's document, runId, and export", async () => {
  for (const lesson of lessons) {
    const packaged = openHarness(lesson.engine.create(lesson.document));
    await packaged.run();
    const expected = packaged.inspect();
    const empty = { slots: [], bindings: [], resources: [], subscriptions: [] };
    for (const overlay of [undefined, { version: 1 }, { version: 1, architecture: {} }, { version: 1, architecture: empty }]) {
      const result = compose(lesson, overlay);
      assert.equal(Object.hasOwn(result.overlay, "architecture"), false, `${lesson.id}: an empty architecture normalizes to absent`);
      assert.equal(encode(result.document), encode(lesson.document), lesson.id);
      const actual = await run(lesson, overlay);
      assert.equal(actual.history.runId, expected.history.runId, lesson.id);
      assert.equal(encode(actual), encode(expected), lesson.id);
    }
    // Every packaged component satisfies the composition rules, so ADR-005 stage 4 adds no diagnostic.
    assert.deepEqual(lesson.engine.validate(lesson.document), [], lesson.id);
  }
});

test("a lesson whose policy declares no architecture allowance rejects every architecture edit", () => {
  for (const lesson of lessons.filter(item => item.policy.architecture === undefined)) {
    const doc = definition(lesson);
    const service = doc.architecture.components.find(item => item.kind === "service")!;
    const result = composeOverlay(lesson.document, lesson.policy, {
      version: 1, architecture: { resources: [{ owner: service.id, resource: "store", change: "attach" }] },
    } as unknown as CanonicalValue, value => lesson.engine.validate(value), lesson.catalog);
    assert.ok(!result.ok, lesson.id);
    assert.deepEqual(result.diagnostics.map(item => `${item.path} ${item.code}`), ["/architecture/resources/0 OVERLAY_LIMIT", "/architecture/resources/0 OVERLAY_NOT_ALLOWED"], lesson.id);
  }
});

test("OVL-AC-2 the same lesson and overlay replay identically across sessions, reset, and run cadence", async () => {
  for (const lesson of lessons) {
    const overlay = fixture(lesson);
    const first = await run(lesson, overlay);
    const second = await run(lesson, overlay);
    assert.equal(first.status, "COMPLETED", lesson.id);
    assert.equal(first.history.runId, second.history.runId, lesson.id);
    assert.equal(first.digest, second.digest, lesson.id);
    const session = openHarness(lesson.engine.create(compose(lesson, overlay).document));
    await session.run();
    await session.reset();
    await session.run();
    assert.equal(session.inspect().digest, first.digest, `${lesson.id} reset`);
    assert.equal((await run(lesson, overlay, { maxEvents: 3 })).digest, first.digest, `${lesson.id} maxEvents`);
    assert.equal((await run(lesson, overlay, { step: true })).digest, first.digest, `${lesson.id} step`);
    assert.ok(first.history.observations.some(item => item.type === "fault.rule.matched" && (item.data as { ruleId: string }).ruleId === "student-coin"), `${lesson.id} uses the student rule`);
    if (overlay.parameters.length) assert.notEqual(encode(compose(lesson, { version: 1, parameters: overlay.parameters }).document), encode(lesson.document), `${lesson.id} the parameter changes the applied document`);
  }
});

test("OVL-AC-3 every overlay field changes runId, and student entries are traceable by ID prefix", async () => {
  const lesson = lessons.find(item => item.id === "normal")!;
  const base = {
    version: 1,
    faults: [{ id: "student-drop", point: "network.response", source: "payment-processor", target: "payments", name: "POST /authorize", from: 0, until: 500, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
    scheduledFaults: [{ id: "student-crash", at: 1500, kind: "fault", fault: { id: "student-crash-fault", kind: "crash", target: "orders" } }],
    parameters: [],
  };
  const runId = (overlay: unknown) => lesson.engine.create(compose(lesson, overlay).document).simulation.history.export().runId;
  const reference = runId(base);
  const rule = base.faults[0]!;
  const action = base.scheduledFaults[0]!;
  const variants: unknown[] = [
    ...[{ id: "student-drop-2" }, { from: 1 }, { until: 501 }, { occurrence: 2 }, { probability: 0.5 }, { maxApplications: 2 },
      { name: "POST /other" }, { effect: { kind: "delay", duration: 5 } }, { source: "payments", target: "payment-processor", point: "network.request" }]
      .map(change => ({ ...base, faults: [{ ...rule, ...change }] })),
    ...[{ at: 1501 }, { id: "student-crash-2" }, { fault: { ...action.fault, target: "payments" } }, { fault: { ...action.fault, id: "student-other" } }]
      .map(change => ({ ...base, scheduledFaults: [{ ...action, ...change }] })),
  ];
  const ids = variants.map(runId);
  assert.ok(ids.every(id => id !== reference));
  assert.equal(new Set(ids).size, ids.length);

  const result = await run(lesson, base);
  const studentRecords = result.history.observations.filter(item => JSON.stringify(item.data ?? null).includes(`"${STUDENT_ID_PREFIX}`));
  const types = new Set(studentRecords.map(item => item.type));
  for (const type of ["fault.rule.matched", "fault.effect.selected", "fault.applied", "scenario.action.dispatched"]) assert.ok(types.has(type), type);
  // The drop reproduces the lost-response story: Payments times out and records UNKNOWN.
  assert.ok(result.history.observations.some(item => item.type === "network.response.dropped"));
  assert.ok(result.history.observations.some(item => item.type === "network.request.timedout" && item.source === "payments"));
});

test("OVL-AC-3 packaged rules are evaluated before student rules at a shared probe", async () => {
  const lesson = lessons.find(item => item.id === "response-lost")!;
  const result = await run(lesson, { version: 1, faults: [{ id: "student-also-drop", point: "network.response", source: "payment-processor", target: "payments", from: 0, effect: { kind: "drop" } }] });
  const matched = result.history.observations.filter(item => item.type === "fault.rule.matched").map(item => (item.data as { ruleId: string }).ruleId);
  assert.deepEqual(matched.slice(0, 2), ["drop-first-processor-authorize-response", "student-also-drop"]);
});

test("OVL-AC-6 every policy matches its packaged document", () => {
  for (const lesson of lessons) {
    const doc = definition(lesson);
    assert.equal(lesson.policy.lesson, doc.name);
    assert.ok(lesson.policy.faults.maxEntries > 0);
    const owned = new Set<string>();
    for (const parameter of lesson.policy.parameters) {
      assert.ok(inDomain(parameter.domain.default as CanonicalValue, parameter), `${lesson.id}.${parameter.key} default in domain`);
      for (const target of parameter.targets) {
        const location = resolveTarget(lesson.document, target);
        assert.ok(location, `${lesson.id}.${parameter.key} target resolves`);
        assert.equal(location.count, 1, `${lesson.id}.${parameter.key} target resolves exactly once`);
        assert.equal(encode(location.container[location.field]), encode(parameter.domain.default), `${lesson.id}.${parameter.key} packaged value equals the default`);
        assert.ok(!owned.has(location.path), `${lesson.id} targets are disjoint`);
        owned.add(location.path);
      }
    }
    const packagedIds = [...doc.faults.map(item => item.id), ...doc.actions.map(item => item.id), ...doc.actions.flatMap(item => item.kind === "fault" ? [item.fault.id] : [])];
    assert.ok(packagedIds.every(id => !id.startsWith(STUDENT_ID_PREFIX)), `${lesson.id} packaged IDs do not use the student prefix`);
  }
});

test("every fault kind a policy offers runs its lesson to completion instead of ending the run", async () => {
  const effects = { delay: { kind: "delay", duration: 50 }, drop: { kind: "drop" }, disconnect: { kind: "disconnect" }, fail: { kind: "fail" }, duplicate: { kind: "duplicate", additionalCopies: 1, spacing: 2 } };
  for (const lesson of lessons) {
    const doc = definition(lesson);
    const overlays: unknown[] = lesson.policy.faults.rules.flatMap(rule => rule.effects.map(effect => ({
      version: 1, faults: [{ id: "student-broad", point: rule.point, from: 0, maxApplications: 100, effect: effects[effect], ...(effect === "duplicate" ? { until: 1 } : {}) }],
    })));
    for (const kind of lesson.policy.faults.scheduled) {
      const targets = doc.architecture.components.filter(item => item.kind === (kind === "crash" ? "service" : "external"));
      assert.ok(targets.length, `${lesson.id} has a target for ${kind}`);
      for (const target of targets) for (const at of [0, 3, 10]) for (const state of kind === "crash" ? [undefined] : ["UNAVAILABLE", "RATE_LIMITED", "DEGRADED"]) {
        overlays.push({ version: 1, scheduledFaults: [{ id: "student-scheduled", at, kind: "fault", fault: { id: "student-scheduled-fault", kind, target: target.id, ...(state ? { state } : {}) } }] });
      }
    }
    for (const overlay of overlays) {
      const result = composeOverlay(lesson.document, lesson.policy, overlay as CanonicalValue, value => lesson.engine.validate(value));
      // A duplicate rule that overlaps a packaged duplicate is a validation error, which the panel shows inline.
      if (!result.ok) { assert.equal(result.code, "INVALID_OVERLAY", `${lesson.id} ${JSON.stringify(overlay)}`); continue; }
      const session = lesson.engine.create(result.document);
      await session.simulation.run();
      assert.equal(session.simulation.status, "COMPLETED", `${lesson.id} ${JSON.stringify(overlay)}`);
    }
  }
});

test("lessons offer only the fault points their architecture has", () => {
  for (const lesson of lessons) {
    const doc = definition(lesson);
    const points = new Set(lesson.policy.faults.rules.map(rule => rule.point));
    assert.equal(points.has("message.delivery"), doc.architecture.destinations.length > 0, lesson.id);
    assert.equal(points.has("database.commit"), doc.architecture.databases.length > 0, lesson.id);
    if (lesson.policy.faults.scheduled.includes("external-availability")) assert.ok(doc.architecture.components.some(item => item.kind === "external"), lesson.id);
  }
});

const pairs = [
  ["retry-unsafe", "retry-idempotent"], ["saga-uncompensated", "saga-compensated"], ["dual-write", "outbox-unsafe-consumer"],
  ["outbox-unsafe-consumer", "outbox-idempotent"], ["cascade-unprotected", "cascade-breaker"], ["notifications-unbounded", "notifications-dlq"],
  ["cache-stale-price", "cache-invalidated"], ["inventory-oversell", "inventory-optimistic"],
] as const;

test("every paired lesson exposes the design choice that distinguishes the pair", () => {
  const withoutLessonStory = (document: CanonicalValue) => { const { name: _, assertions: __, ...rest } = document as Record<string, CanonicalValue>; return encode(rest); };
  for (const [from, to] of pairs) for (const [left, right] of [[from, to], [to, from]] as const) {
    const lesson = lessons.find(item => item.id === left)!;
    const paired = lessons.find(item => item.id === right)!;
    // The switches whose defaults differ are the pair's design choice; the paired lesson's defaults are its values.
    const parameters = paired.policy.parameters.filter(parameter => {
      const own = lesson.policy.parameters.find(item => item.key === parameter.key);
      assert.ok(own, `${left} declares ${parameter.key}`);
      return encode(own.domain.default as CanonicalValue) !== encode(parameter.domain.default as CanonicalValue);
    }).map(parameter => ({ key: parameter.key, value: parameter.domain.default }));
    assert.ok(parameters.length > 0, `${left} → ${right} differs in a declared parameter`);
    const applied = compose(lesson, { version: 1, parameters }).document;
    // Assertions stay the lesson's own until #96 separates invariants from expectations.
    assert.equal(withoutLessonStory(applied), withoutLessonStory(paired.document), `${left} with ${JSON.stringify(parameters)} has the ${right} architecture`);
  }
});

test("every declared parameter value at its domain edges runs its lesson to completion", async () => {
  for (const lesson of lessons) for (const parameter of lesson.policy.parameters) {
    const domain = parameter.domain;
    const values: CanonicalValue[] = domain.type === "boolean" ? [true, false] : domain.type === "integer" ? [domain.minimum, domain.maximum] : [...domain.choices];
    for (const value of values) {
      const result = await run(lesson, { version: 1, parameters: [{ key: parameter.key, value }] });
      assert.equal(result.status, "COMPLETED", `${lesson.id} ${parameter.key}=${JSON.stringify(value)}`);
    }
  }
});

test("a design choice changes the lesson outcome without changing the packaged assertions", async () => {
  const lesson = lessons.find(item => item.id === "retry-unsafe")!;
  const packaged = await run(lesson, { version: 1 });
  const result = await run(lesson, { version: 1, parameters: [{ key: "idempotency", value: true }] });
  // The packaged invariant states one payment per order: the unsafe lesson violates it, and
  // switching idempotency on makes the same assertion hold (#96).
  assert.equal(packaged.results.find(item => item.id === "one-payment-per-order")?.status, "FAIL");
  assert.equal(result.results.find(item => item.id === "one-payment-per-order")?.status, "PASS");
  const outOfRange = composeOverlay(lesson.document, lesson.policy, { version: 1, parameters: [{ key: "timeout", value: 0 }] } as unknown as CanonicalValue, value => lesson.engine.validate(value));
  assert.ok(!outOfRange.ok && outOfRange.code === "INVALID_OVERLAY");
  assert.deepEqual(outOfRange.diagnostics, [{ path: "/parameters/0/value", code: "PARAMETER_VALUE" }]);
});

test("a notifications design choice changes only the invariants it is about", async () => {
  const lesson = lessons.find(item => item.id === "notifications-unbounded")!;
  const verdicts = async (parameters: { key: string; value: CanonicalValue }[]) =>
    Object.fromEntries((await run(lesson, { version: 1, parameters })).results.map(item => [item.id, item.status]));
  // Confirming at checkout keeps the order confirmed, but the notification still retries without a bound.
  assert.deepEqual(await verdicts([{ key: "decoupled-confirmation", value: true }]), {
    "nothing-sent-during-outage": "PASS", "order-confirmed-despite-notification-failure": "PASS",
    "failed-notification-dead-lettered": "FAIL", "bounded-notification-retries": "FAIL",
  });
  // A bounded budget dead-letters the notification, but a coupled Orders then never confirms the order.
  assert.deepEqual(await verdicts([{ key: "max-attempts", value: 3 }]), {
    "nothing-sent-during-outage": "PASS", "order-confirmed-despite-notification-failure": "FAIL",
    "failed-notification-dead-lettered": "PASS", "bounded-notification-retries": "PASS",
  });
});

test("a pair's distinguishing design choice gives the paired lesson's business invariant verdicts", async () => {
  // A pair may differ in more than one design choice; the notifications pair needs both to reach the paired verdicts.
  const pairs = [["retry-unsafe", "retry-idempotent", ["idempotency"]], ["saga-uncompensated", "saga-compensated", ["compensation"]],
    ["dual-write", "outbox-unsafe-consumer", ["outbox"]], ["outbox-unsafe-consumer", "outbox-idempotent", ["consumer-idempotency"]],
    ["cascade-unprotected", "cascade-breaker", ["circuit-breaker"]],
    ["notifications-unbounded", "notifications-dlq", ["decoupled-confirmation", "max-attempts"]],
    ["cache-stale-price", "cache-invalidated", ["cache-invalidation"]],
    ["inventory-oversell", "inventory-optimistic", ["optimistic-concurrency"]]] as const;
  const invariants = (name: typeof pairs[number][0 | 1], result: HarnessExport) => {
    const ids = new Set(commerceChecks(name).filter(check => check.kind === "invariant").map(check => check.id));
    return result.results.filter(item => ids.has(item.id)).map(item => `${item.id} ${item.status}`);
  };
  for (const [from, to, keys] of pairs) {
    const source = lessons.find(item => item.id === from)!, target = lessons.find(item => item.id === to)!;
    const parameters = keys.map(key => ({ key, value: target.policy.parameters.find(parameter => parameter.key === key)!.domain.default }));
    const switched = await run(source, { version: 1, parameters });
    const paired = await run(target, { version: 1 });
    assert.deepEqual(invariants(from, switched), invariants(to, paired), `${from} with ${JSON.stringify(parameters)}`);
    assert.notDeepEqual(invariants(from, await run(source, { version: 1 })), invariants(to, paired), `${from} and ${to} differ`);
  }
});
