import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalValue, LessonOverlayPolicy, ScenarioDefinition } from "@distlab/contracts";
import { STUDENT_ID_PREFIX } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutAssessment, checkoutCatalog, checkoutOverlayPolicy, commerceAssessment, commerceCatalog, commerceLessonNames,
  commerceOverlayPolicy, commerceScenario, normalCheckout, responseLostCheckout,
} from "@distlab/catalogs";
import { DeterministicScenarioEngine, composeOverlay, inDomain, openHarness, resolveTarget } from "@distlab/scenario";
import type { HarnessExport } from "@distlab/scenario";

interface Lesson {
  readonly id: string;
  readonly document: CanonicalValue;
  readonly policy: LessonOverlayPolicy;
  readonly engine: DeterministicScenarioEngine;
}

const checkoutEngine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });
const commerceEngine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const lessons: readonly Lesson[] = [
  { id: "normal", document: normalCheckout, policy: checkoutOverlayPolicy("normal"), engine: checkoutEngine },
  { id: "response-lost", document: responseLostCheckout, policy: checkoutOverlayPolicy("response-lost"), engine: checkoutEngine },
  ...commerceLessonNames.map(name => ({ id: name, document: commerceScenario(name), policy: commerceOverlayPolicy(name), engine: commerceEngine })),
];
const definition = (lesson: Lesson) => lesson.document as unknown as ScenarioDefinition;
const encode = (value: unknown) => canonicalEncode(value as CanonicalValue);

function compose(lesson: Lesson, overlay: unknown) {
  const result = composeOverlay(lesson.document, lesson.policy, overlay as CanonicalValue | undefined, value => lesson.engine.validate(value));
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

/** OVL-AC-2 fixture: a seeded probabilistic rule and, where the policy allows one, a scheduled fault. */
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
    parameters: [],
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
