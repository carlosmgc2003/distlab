import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalValue, LessonOverlayPolicy, LessonParameter, ScenarioDefinition } from "@distlab/contracts";
import { STUDENT_ID_PREFIX } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutAssessment, checkoutCatalog, checkoutOverlayPolicy, commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames,
  commerceOverlayPolicy, commerceScenario, normalCheckout, reliableCheckoutOverlayPolicy, reliableCheckoutScenario, responseLostCheckout,
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
  // Catalog-only until the assessment view (#97), but held to every overlay rule a packaged lesson is.
  { id: "reliable-checkout", document: reliableCheckoutScenario, policy: reliableCheckoutOverlayPolicy, engine: commerceEngine, catalog: commerceCatalog },
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
        // A crash may carry a restart (ADR-004 amendment, #97 D-8): the restarted service must not end the run either.
        if (kind === "crash") for (const after of [1, 10]) {
          overlays.push({ version: 1, scheduledFaults: [{ id: "student-scheduled", at, kind: "fault", fault: { id: "student-scheduled-fault", kind, target: target.id }, restart: { after } }] });
        }
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
  ["lease-unfenced", "lease-fenced"], ["clock-last-write-wins", "clock-lamport"],
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
    ["inventory-oversell", "inventory-optimistic", ["optimistic-concurrency"]],
    ["lease-unfenced", "lease-fenced", ["fencing"]],
    ["clock-last-write-wins", "clock-lamport", ["logical-clock"]]] as const;
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

/** Every combination of each declared parameter's domain edges, as overlay parameter lists. */
function extremes(lesson: Lesson): { key: string; value: CanonicalValue }[][] {
  let combinations: { key: string; value: CanonicalValue }[][] = [[]];
  for (const parameter of lesson.policy.parameters) {
    const domain = parameter.domain;
    const values: CanonicalValue[] = domain.type === "boolean" ? [true, false] : domain.type === "integer" ? [domain.minimum, domain.maximum] : [...domain.choices];
    combinations = combinations.flatMap(chosen => values.map(value => [...chosen, { key: parameter.key, value }]));
  }
  return combinations;
}

/**
 * Each business invariant's stored verdict beside the same predicate evaluated on the run's final
 * state (#163). A verdict of PASS with `holdsAtEnd: false` is a false HOLDS.
 */
async function invariantsAtEnd(name: typeof commerceLessonNames[number], overlay: unknown) {
  const lesson = lessons.find(item => item.id === name)!;
  const document = compose(lesson, overlay).document;
  const session = lesson.engine.create(document);
  const harness = openHarness(session);
  await harness.run();
  const result = harness.inspect();
  const projection = session.projection();
  const ids = new Set(commerceChecks(name).filter(check => check.kind === "invariant").map(check => check.id));
  const rows = (document as unknown as ScenarioDefinition).assertions.filter(assertion => ids.has(assertion.id)).map(assertion => ({
    id: assertion.id,
    status: result.results.find(item => item.id === assertion.id)!.status,
    holdsAtEnd: commerceAssessment.find(assertion.predicate)!.evaluate({ parameters: assertion.parameters, projection }).pass,
  }));
  return { result, rows };
}
const payments = (result: HarnessExport) =>
  Object.keys(((result.state as { databases: Record<string, { tables: Record<string, Record<string, unknown>> }> }).databases.payments!.tables.payments!));
const delayedRetry = { version: 1, faults: [{ id: "student-slow-retry", point: "network.request", source: "client", target: "payments", from: 0, probability: 1, maxApplications: 1, occurrence: 2, effect: { kind: "delay", duration: 30 } }] };

test("#163 retry-unsafe reports the double charge for every allowed client timeout", async () => {
  for (let timeout = 1; timeout <= 60; timeout++) {
    const { result, rows } = await invariantsAtEnd("retry-unsafe", { version: 1, parameters: [{ key: "timeout", value: timeout }] });
    assert.equal(result.status, "COMPLETED", `timeout=${timeout}`);
    assert.deepEqual(rows, [{ id: "one-payment-per-order", status: payments(result).length > 1 ? "FAIL" : "PASS", holdsAtEnd: payments(result).length <= 1 }], `timeout=${timeout}`);
  }
  // The reported case: with timeout=40 the second charge lands at t=42, after the time the lesson used to check.
  const { result, rows } = await invariantsAtEnd("retry-unsafe", { version: 1, parameters: [{ key: "timeout", value: 40 }] });
  assert.deepEqual(payments(result), ["payment-1", "payment-2"]);
  assert.equal(rows[0]!.status, "FAIL");
  const verdict = result.results.find(item => item.id === "one-payment-per-order")!;
  assert.equal(verdict.time, 42);
  assert.deepEqual(Object.keys(verdict.evidence as Record<string, unknown>), ["payment-1", "payment-2"]);
});

test("#163 retry-unsafe reports the double charge when a student fault delays the retry", async () => {
  const { result, rows } = await invariantsAtEnd("retry-unsafe", delayedRetry);
  assert.deepEqual(payments(result), ["payment-1", "payment-2"]);
  assert.deepEqual(rows, [{ id: "one-payment-per-order", status: "FAIL", holdsAtEnd: false }]);
  assert.ok(result.results[0]!.time > 30, "the violation is later than the time the lesson used to check");
  // The same fault on the idempotent lesson leaves one payment, and the invariant holds to the end of the run.
  const safe = await invariantsAtEnd("retry-idempotent", delayedRetry);
  assert.deepEqual(payments(safe.result), ["payment-1"]);
  assert.deepEqual(safe.rows, [{ id: "one-payment-per-order", status: "PASS", holdsAtEnd: true }]);
});

test("#163 no business invariant reads HOLDS while the final state violates it, at every design-choice extreme of every lesson", async () => {
  for (const name of commerceLessonNames) for (const parameters of extremes(lessons.find(item => item.id === name)!)) {
    const { result, rows } = await invariantsAtEnd(name, { version: 1, parameters });
    assert.equal(result.status, "COMPLETED", `${name} ${JSON.stringify(parameters)}`);
    assert.ok(rows.length > 0, name);
    for (const row of rows) assert.ok(!(row.status === "PASS" && !row.holdsAtEnd), `${name} ${JSON.stringify(parameters)}: ${row.id} reads HOLDS, and the final state violates it`);
  }
});

test("#163 no business invariant reads HOLDS while the final state violates it, when a request on any link is delayed", async () => {
  for (const name of commerceLessonNames) {
    const lesson = lessons.find(item => item.id === name)!;
    for (const link of definition(lesson).architecture.links) for (const occurrence of [1, 2]) {
      const fault = { id: "student-slow", point: "network.request", source: link.source, target: link.target, from: 0, probability: 1, maxApplications: 1, occurrence, effect: { kind: "delay", duration: 30 } };
      const { result, rows } = await invariantsAtEnd(name, { version: 1, faults: [fault] });
      assert.equal(result.status, "COMPLETED", `${name} ${link.source} → ${link.target} #${occurrence}`);
      for (const row of rows) assert.ok(!(row.status === "PASS" && !row.holdsAtEnd), `${name} ${link.source} → ${link.target} #${occurrence}: ${row.id} reads HOLDS, and the final state violates it`);
    }
  }
});

test("the fenced lease stays safe when a student delays the lock's own calls, and a longer lease refuses the second worker", async () => {
  const lesson = lessons.find(item => item.id === "lease-fenced")!;
  const outcomes = (result: HarnessExport) => Object.fromEntries(result.history.observations
    .filter(item => item.type === "runtime.log" && (item.data as { message: string }).message === "client.result")
    .map(item => (item.data as unknown as { data: { label: string; result: { status: string } } }).data).map(data => [data.label, data.result.status]));
  const file = (result: HarnessExport) => (result.state as { databases: { storage: { tables: { files: Record<string, { writer: string; token: number }> } } } }).databases.storage.tables.files["reports/daily.csv"];
  // Worker-1 draws its token after its lease expired (and after worker-2 drew token 1), so it gets the larger token 2.
  // Its own clock check stops it: a worker that passes the check drew its token while its lease was live.
  const slowToken = await run(lesson, { version: 1, faults: [{ id: "student-slow-token", point: "network.request", source: "worker-1", target: "kv", from: 0, probability: 1, maxApplications: 1, occurrence: 2, effect: { kind: "delay", duration: 16 } }] });
  assert.equal(slowToken.status, "COMPLETED");
  assert.deepEqual(outcomes(slowToken), { "job-worker-1": "LEASE_EXPIRED", "job-worker-2": "WRITTEN" });
  assert.deepEqual(JSON.parse(JSON.stringify(file(slowToken))), { content: "report by worker-2", writer: "worker-2", token: 1 });
  assert.deepEqual(slowToken.results.map(item => item.status), ["FAIL", "PASS", "PASS"], "the packaged setup expectation names token 2; both invariants hold");
  // A call to the store that times out leaves the worker not knowing whether it holds the lease, so it does not write.
  const lostAnswer = await run(lesson, { version: 1, faults: [{ id: "student-lost-answer", point: "network.response", source: "kv", target: "worker-1", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } }] });
  // The entry it could not confirm still expires at t=12, so worker-2 takes the lease at t=17 and writes.
  assert.deepEqual(outcomes(lostAnswer), { "job-worker-1": "LOCK_UNAVAILABLE", "job-worker-2": "WRITTEN" });
  assert.equal(file(lostAnswer)!.writer, "worker-2");
  // A 40 ms lease is still live at t=17: the store's set-if-absent fails, and worker-2 never writes.
  const longLease = await run(lesson, { version: 1, parameters: [{ key: "lease-ttl", value: 40 }] });
  assert.deepEqual(outcomes(longLease), { "job-worker-1": "WRITTEN", "job-worker-2": "LOCK_BUSY" });
  assert.deepEqual(longLease.history.observations.filter(item => item.type === "kv.condition.failed").map(item => item.time), [17]);
});

test("#163 fresh, reset, and stepped runs agree on the verdicts of a changed experiment", async () => {
  const lesson = lessons.find(item => item.id === "retry-unsafe")!;
  for (const overlay of [{ version: 1, parameters: [{ key: "timeout", value: 40 }] }, delayedRetry]) {
    const fresh = await run(lesson, overlay);
    assert.deepEqual(fresh.results.map(item => [item.id, item.status]), [["one-payment-per-order", "FAIL"]]);
    const session = openHarness(lesson.engine.create(compose(lesson, overlay).document));
    await session.run();
    await session.reset();
    await session.run();
    for (const other of [session.inspect(), await run(lesson, overlay, { step: true }), await run(lesson, overlay, { maxEvents: 3 })]) {
      assert.equal(other.digest, fresh.digest);
      assert.deepEqual(other.results, fresh.results);
    }
  }
});

test("#97 D-8 a crashed Payments restarts and answers the retry from its durable result", async () => {
  // Payments crashes at t=2, after committing payment-1, and restarts at t=12 (RUNNING at t=13), before the retry at t=21.
  const overlay = { version: 1, scheduledFaults: [{ id: "student-crash", at: 2, kind: "fault", fault: { id: "student-crash-payments", kind: "crash", target: "payments" }, restart: { after: 10 } }] };
  const lifecycle = (result: HarnessExport) => result.history.observations.filter(item => item.type === "service.lifecycle.changed" && item.source === "payments")
    .map(item => `${item.time}:${(item.data as { after: string }).after}`);
  const payments = (result: HarnessExport) => Object.keys((result.state as { databases: Record<string, { tables: Record<string, Record<string, unknown>> }> }).databases.payments!.tables.payments!);
  const safe = await run(lessons.find(item => item.id === "retry-idempotent")!, overlay);
  assert.equal(safe.status, "COMPLETED");
  assert.deepEqual(lifecycle(safe), ["0:RUNNING", "2:CRASHED", "12:STARTING", "13:RUNNING"]);
  assert.deepEqual(payments(safe), ["payment-1"]);
  assert.deepEqual(safe.results.map(item => [item.id, item.status]), [["one-payment-per-order", "PASS"]]);
  const unsafe = await run(lessons.find(item => item.id === "retry-unsafe")!, overlay);
  assert.deepEqual(payments(unsafe), ["payment-1", "payment-2"]);
  assert.deepEqual(unsafe.results.map(item => [item.id, item.status]), [["one-payment-per-order", "FAIL"]]);
  // Same lesson, overlay, and seed: same run.
  assert.equal((await run(lessons.find(item => item.id === "retry-idempotent")!, overlay)).digest, safe.digest);
});
