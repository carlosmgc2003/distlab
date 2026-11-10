import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssessmentDefinition, AssessmentRow, CanonicalValue } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import { commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames, commerceOverlayPolicy, commerceScenario } from "@distlab/catalogs";
import type { CommerceLessonName } from "@distlab/catalogs";
import { DeterministicScenarioEngine, validateAssessmentDefinition, type AssessmentBaseLesson } from "@distlab/scenario";

/**
 * Assessment definitions over existing packaged commerce lessons. These are
 * test fixtures, not packaged definitions: the first packaged definition needs
 * the Reliable Checkout base lesson (docs/spec/assessment.md, plan step 2), and
 * the ASSESS-AC-2 catalog test over packaged definitions lands with it.
 */

const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const validate = (document: CanonicalValue) => engine.validate(document);

/** Resolves `base` the way a catalog would: by packaged scenario name, or not at all. */
function packagedBase(base: string): AssessmentBaseLesson | undefined {
  const name = commerceLessonNames.find(item => `${item}@1` === base) as CommerceLessonName | undefined;
  return name ? { document: commerceScenario(name), policy: commerceOverlayPolicy(name), checks: commerceChecks(name) } : undefined;
}
const check = (definition: AssessmentDefinition) => validateAssessmentDefinition(definition, packagedBase(definition.base), validate)
  .map(item => `${item.path} ${item.code}`);

type Fault = AssessmentRow["faults"][number];
type Scheduled = AssessmentRow["scheduledFaults"][number];
const rule = (value: Record<string, unknown>) => ({ from: 0, probability: 1, maxApplications: 1, ...value }) as unknown as Fault;
const scheduled = (value: Record<string, unknown>) => value as unknown as Scheduled;

/** Notifications lessons allow delivery and network faults and a student crash, so every row kind applies. */
const notifications: AssessmentDefinition = {
  version: 1,
  id: "notifications-fixture-assessment@1",
  title: "Notifications under failure (test fixture)",
  requirements: ["A confirmed order stays confirmed while its notification fails.", "No notification is attempted more than 3 times."],
  base: "notifications-dlq@1",
  rows: [
    { id: "packaged-story", label: "The lesson's own outage", faults: [], scheduledFaults: [] },
    { id: "duplicate-order-placed", label: "Duplicate OrderPlaced", scheduledFaults: [], faults: [
      rule({ id: "student-row-duplicate", point: "message.delivery", source: "orders", target: "notifications", name: "OrderPlaced",
        effect: { kind: "duplicate", additionalCopies: 1, spacing: 3 } }),
    ] },
    { id: "slow-provider-response", label: "Slow provider response", scheduledFaults: [], faults: [
      rule({ id: "student-row-slow-send", point: "network.response", source: "messaging", target: "notifications", name: "POST /send",
        effect: { kind: "delay", duration: 5 } }),
    ] },
    { id: "orders-crash-and-restart", label: "Orders crashes and restarts", faults: [], scheduledFaults: [
      scheduled({ id: "student-row-orders-crash", at: 2, kind: "fault", fault: { id: "student-row-orders-crash-fault", kind: "crash", target: "orders" },
        restart: { after: 10 } }),
    ] },
  ],
  invariants: [
    { id: "order-confirmed-despite-notification-failure", label: "An order is confirmed while its notification fails" },
    { id: "failed-notification-dead-lettered", label: "A failed notification is dead-lettered" },
    { id: "bounded-notification-retries", label: "No notification is attempted more than 3 times" },
  ],
};

test("ASSESS-AC-2: row overlays with student- IDs, including a crash with restart, validate against a packaged commerce lesson", () => {
  const base = packagedBase(notifications.base)!;
  assert.ok(base.policy!.faults.scheduled.includes("crash"), "the base policy allows a student crash");
  assert.ok(notifications.rows.every(row => [...row.faults, ...row.scheduledFaults].every(entry => entry.id.startsWith("student-"))));
  assert.deepEqual(check(notifications), []);
});

test("ASSESS-AC-2: the same fixture over a packaged lesson in another family is rejected for its own reasons", () => {
  // Saga lessons allow no student crash, and their assertions are other invariants.
  assert.deepEqual(check({ ...notifications, base: "saga-compensated@1" }), [
    "/invariants/0/id REFERENCE",
    "/invariants/1/id REFERENCE",
    "/invariants/2/id REFERENCE",
    "/rows/1/faults/0/point OVERLAY_NOT_ALLOWED",
    // Saga lessons have no Messaging Provider: the applied document rejects the row's rule, at the row's path.
    "/rows/2/faults/0/source UNKNOWN_COMPONENT",
    "/rows/2/faults/0/target UNKNOWN_COMPONENT",
    "/rows/3/scheduledFaults/0/fault/kind OVERLAY_NOT_ALLOWED",
  ]);
});

test("ASSESS-AC-2: a scenario expectation of a packaged lesson is not an assessment invariant", () => {
  assert.equal(commerceChecks("notifications-dlq").find(item => item.id === "nothing-sent-during-outage")?.kind, "expectation");
  assert.deepEqual(check({ ...notifications, invariants: [{ id: "nothing-sent-during-outage", label: "Nothing sent" }] }), ["/invariants/0/id KIND"]);
});

test("ASSESS-AC-2: a base that names no packaged lesson is rejected", () => {
  assert.deepEqual(check({ ...notifications, base: "reliable-checkout@1" }), ["/base REFERENCE"]);
  assert.deepEqual(check({ ...notifications, base: "notifications-dlq" }), ["/base REFERENCE"]);
});

test("ASSESS-AC-2 (D-6): a row larger than the base policy's maxEntries is rejected", () => {
  const limit = packagedBase(notifications.base)!.policy!.faults.maxEntries;
  const faults = Array.from({ length: limit + 1 }, (_, index) => rule({
    id: `student-row-slow-${index}`, point: "network.response", source: "messaging", target: "notifications", name: "POST /send",
    from: index * 10, until: index * 10 + 5, effect: { kind: "delay", duration: 5 },
  }));
  const big: AssessmentRow = { id: "too-many-faults", label: "Too many faults", faults, scheduledFaults: [] };
  assert.deepEqual(check({ ...notifications, rows: [big] }), [`/rows/0/faults/${limit} OVERLAY_LIMIT`]);
  assert.deepEqual(check({ ...notifications, rows: [{ ...big, faults: faults.slice(0, limit) }] }), []);
});

test("ASSESS-AC-2: validating a definition is deterministic and leaves the packaged lesson unchanged", () => {
  const before = canonicalEncode(commerceScenario("notifications-dlq"));
  const messy: AssessmentDefinition = { ...notifications, base: "saga-compensated@1", rows: [...notifications.rows, notifications.rows[0]!] };
  const first = validateAssessmentDefinition(messy, packagedBase(messy.base), validate);
  const second = validateAssessmentDefinition(messy, packagedBase(messy.base), validate);
  assert.ok(first.length > 0);
  assert.equal(canonicalEncode(first as unknown as CanonicalValue), canonicalEncode(second as unknown as CanonicalValue));
  assert.deepEqual(validateAssessmentDefinition(notifications, packagedBase(notifications.base), validate), []);
  assert.equal(canonicalEncode(commerceScenario("notifications-dlq")), before);
});
