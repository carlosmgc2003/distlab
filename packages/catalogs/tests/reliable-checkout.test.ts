import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssessmentRow, CanonicalValue, Observation, ParameterOverride } from "@distlab/contracts";
import {
  assessmentDefinitions, commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames, commerceOverlayPolicy, commerceScenario,
  reliableCheckoutAssessment, reliableCheckoutChecks, reliableCheckoutName, reliableCheckoutOverlayPolicy, reliableCheckoutScenario, reliableCheckoutTimes,
} from "@distlab/catalogs";
import {
  DeterministicScenarioEngine, compareExports, composeOverlay, openHarness, validateAssessmentDefinition,
  type AssessmentBaseLesson, type HarnessExport,
} from "@distlab/scenario";

/** Reliable Checkout, the base lesson of the #97 assessment (docs/spec/assessment.md). */
const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const validate = (document: CanonicalValue) => engine.validate(document);
type Doc = Record<string, CanonicalValue>;
const document = reliableCheckoutScenario as Doc;

const defaults: readonly ParameterOverride[] = [];
const protectedDesign: readonly ParameterOverride[] = [
  { key: "retries", value: 1 }, { key: "idempotency", value: true }, { key: "compensation", value: true },
  { key: "outbox", value: true }, { key: "consumer-idempotency", value: true },
];
const row = (id: string): AssessmentRow => reliableCheckoutAssessment.rows.find(item => item.id === id)!;

/** One suite row as the assessment will load it: the row's faults and the design's parameters. */
async function runRow(item: AssessmentRow, parameters: readonly ParameterOverride[]): Promise<HarnessExport> {
  const overlay = { version: 1, faults: item.faults, scheduledFaults: item.scheduledFaults, parameters } as unknown as CanonicalValue;
  const composed = composeOverlay(reliableCheckoutScenario, reliableCheckoutOverlayPolicy, overlay, validate, commerceCatalog);
  assert.ok(composed.ok, `${item.id}: ${JSON.stringify(composed)}`);
  const session = openHarness(engine.create(composed.document));
  await session.run();
  return session.inspect();
}
const verdicts = (result: HarnessExport) => Object.fromEntries(result.results.map(item => [item.id, item.status]));
const of = (result: HarnessExport, type: string, source?: string): readonly Observation[] =>
  result.history.observations.filter(item => item.type === type && (source === undefined || item.source === source));
const data = (item: Observation) => item.data as Record<string, CanonicalValue>;
/** Runtime log records (`runtime.log`) one model wrote with the given message. */
const logged = (result: HarnessExport, source: string, message: string) => of(result, "runtime.log", source).filter(item => data(item).message === message);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const visible = (result: HarnessExport, id: string) => json((result.state as { components: Record<string, { visible: CanonicalValue }> }).components[id]!.visible);
const orderStatus = (result: HarnessExport) =>
  json((result.state as { databases: Record<string, { tables: Record<string, Record<string, { status: string }>> }> }).databases.orders!.tables.orders!["order-1"]!.status);

test("the base lesson validates, packages no fault, and every check is a business invariant", () => {
  assert.deepEqual(validate(reliableCheckoutScenario), []);
  assert.equal(document.name, reliableCheckoutName);
  assert.deepEqual(document.faults, [], "an overlay cannot remove a packaged fault, so the base packages none");
  assert.ok(!(document.actions as Doc[]).some(action => action.kind === "fault"));
  const assertions = (document.assertions as Doc[]).map(item => item.id);
  assert.deepEqual(reliableCheckoutChecks.map(check => check.id), assertions, "one classification per assertion, in document order");
  assert.ok(reliableCheckoutChecks.every(check => check.kind === "invariant" && check.label.length > 0));
  assert.equal(reliableCheckoutOverlayPolicy.lesson, reliableCheckoutName);
  // Catalog only until the assessment view (#97 step 3): not a packaged lesson the host accepts yet.
  assert.ok(!commerceLessonNames.some(name => `${name}@1` === reliableCheckoutName));
});

/** Resolves a definition's base the way a catalog does: by packaged scenario name. */
function packagedBase(base: string): AssessmentBaseLesson | undefined {
  if (base === reliableCheckoutName) return { document: reliableCheckoutScenario, policy: reliableCheckoutOverlayPolicy, checks: reliableCheckoutChecks };
  const name = commerceLessonNames.find(item => `${item}@1` === base);
  return name ? { document: commerceScenario(name), policy: commerceOverlayPolicy(name), checks: commerceChecks(name) } : undefined;
}

test("ASSESS-AC-2: every packaged assessment definition validates against its base lesson", () => {
  assert.ok(assessmentDefinitions.length > 0, "at least one packaged definition");
  const ids = assessmentDefinitions.map(definition => definition.id);
  assert.equal(new Set(ids).size, ids.length, "definition IDs are unique");
  for (const definition of assessmentDefinitions) {
    assert.deepEqual(validateAssessmentDefinition(definition, packagedBase(definition.base), validate), [], definition.id);
  }
});

test("ASSESS-AC-2 (D-3, D-6): the Reliable Checkout rows are the six of vision §21, with student- IDs, inside maxEntries", () => {
  assert.deepEqual(reliableCheckoutAssessment.rows.map(item => item.label), [
    "Happy path", "Duplicate OrderConfirmed", "Inventory unavailable", "Processor response lost", "Notification provider down", "Crash after local commit",
  ]);
  for (const item of reliableCheckoutAssessment.rows) {
    const ids = [...item.faults.map(entry => entry.id), ...item.scheduledFaults.flatMap(entry => [entry.id, entry.fault.id])];
    assert.ok(ids.every(id => id.startsWith("student-row-")), item.id);
    // Room for the student's own entries if a later increment allows them (D-6).
    assert.ok(item.faults.length + item.scheduledFaults.length < reliableCheckoutOverlayPolicy.faults.maxEntries, item.id);
  }
  assert.deepEqual(reliableCheckoutAssessment.invariants.map(item => item.id), reliableCheckoutChecks.map(check => check.id));
});

/** docs/spec/assessment.md, "Expected outcomes". A row passes when every invariant holds (D-4). */
const expected = {
  defaults: { "happy-path": "PASS", "duplicate-order-confirmed": "FAIL", "inventory-unavailable": "FAIL", "processor-response-lost": "FAIL", "notification-provider-down": "PASS", "crash-after-local-commit": "FAIL" },
  protected: { "happy-path": "PASS", "duplicate-order-confirmed": "PASS", "inventory-unavailable": "PASS", "processor-response-lost": "PASS", "notification-provider-down": "PASS", "crash-after-local-commit": "PASS" },
};

test("ASSESS-AC-4: the defaults and the fully protected design give the expected-outcomes matrix", async () => {
  for (const [design, parameters] of [["defaults", defaults], ["protected", protectedDesign]] as const) {
    const matrix: Record<string, string> = {};
    for (const item of reliableCheckoutAssessment.rows) {
      const result = await runRow(item, parameters);
      assert.equal(result.status, "COMPLETED", `${design} ${item.id}`);
      // The deadline checks see the finished story: no message or request happens at or after them.
      const late = result.history.observations.filter(entry => /^(message|network)\./.test(entry.type) && entry.time >= reliableCheckoutTimes.deadline);
      assert.deepEqual(late.map(entry => `${entry.time} ${entry.type}`), [], `${design} ${item.id}`);
      const cells = verdicts(result);
      assert.deepEqual(Object.keys(cells), reliableCheckoutAssessment.invariants.map(invariant => invariant.id));
      assert.ok(Object.values(cells).every(status => status === "PASS" || status === "FAIL"), `${design} ${item.id}: every verdict settled`);
      matrix[item.id] = Object.values(cells).every(status => status === "PASS") ? "PASS" : "FAIL";
    }
    assert.deepEqual(matrix, expected[design], design);
  }
});

test("ASSESS-AC-4: each failing default row violates the invariant its fault is about", async () => {
  const violated = async (id: string) => Object.entries(verdicts(await runRow(row(id), defaults))).filter(([, status]) => status === "FAIL").map(([key]) => key);
  assert.deepEqual(await violated("duplicate-order-confirmed"), ["notified-exactly-once"]);
  assert.deepEqual(await violated("inventory-unavailable"), ["order-final"]);
  assert.deepEqual(await violated("processor-response-lost"), ["failed-order-uncharged", "order-final"]);
  assert.deepEqual(await violated("crash-after-local-commit"), ["notified-exactly-once"]);
});

test("the duplicate row: two sends without the inbox, one with it", async () => {
  const unsafe = await runRow(row("duplicate-order-confirmed"), defaults);
  assert.equal(visible(unsafe, "messaging").sent.length, 2);
  const safe = await runRow(row("duplicate-order-confirmed"), [{ key: "consumer-idempotency", value: true }]);
  assert.equal(visible(safe, "messaging").sent.length, 1);
  assert.equal(logged(safe, "notifications", "consumer.duplicate-ignored").length, 1);
});

test("the inventory row: the order is stuck without compensation and cancelled with it", async () => {
  const unsafe = await runRow(row("inventory-unavailable"), defaults);
  assert.equal(orderStatus(unsafe), "NEEDS_COMPENSATION");
  assert.equal(of(unsafe, "network.request.sent", "orders").filter(item => item.target === "payments").length, 0, "no payment after a failed reservation");
  const safe = await runRow(row("inventory-unavailable"), [{ key: "compensation", value: true }]);
  assert.equal(orderStatus(safe), "CANCELLED");
});

test("the lost-response row: one ambiguous charge by default, one replayed charge with retries and a key, two charges with retries alone (D-2)", async () => {
  const authorizations = (result: HarnessExport) => (visible(result, "payment-processor").authorizations as { status: string }[]).map(item => item.status);
  const unsafe = await runRow(row("processor-response-lost"), defaults);
  assert.deepEqual(authorizations(unsafe), ["APPROVED"]);
  assert.equal(orderStatus(unsafe), "NEEDS_COMPENSATION");
  const safe = await runRow(row("processor-response-lost"), [{ key: "retries", value: 1 }, { key: "idempotency", value: true }]);
  assert.deepEqual(authorizations(safe), ["APPROVED"], "the retry carried the same key and was replayed");
  assert.equal(orderStatus(safe), "CONFIRMED");
  const trap = await runRow(row("processor-response-lost"), [{ key: "retries", value: 1 }]);
  assert.deepEqual(authorizations(trap), ["APPROVED", "APPROVED"]);
  assert.equal(verdicts(trap)["charged-at-most-once"], "FAIL", "retries without idempotency double the charge");
  const voided = await runRow(row("processor-response-lost"), [{ key: "compensation", value: true }]);
  assert.deepEqual(authorizations(voided), ["VOIDED"], "compensation voids the ambiguous charge");
  assert.equal(orderStatus(voided), "CANCELLED");
});

test("the provider row: rejected sends NACK until the provider returns, then one notification goes out (#126)", async () => {
  for (const parameters of [defaults, protectedDesign]) {
    const result = await runRow(row("notification-provider-down"), parameters);
    const rejected = of(result, "service.handler.failed", "notifications").filter(item => data(item).code === "EXTERNAL_UNAVAILABLE");
    if (parameters === defaults) assert.ok(rejected.length > 0, "the direct publication meets the outage");
    // A rejection is recorded when its reply returns, 1 ms after the provider refused the send.
    assert.ok(rejected.every(item => item.time - 1 < reliableCheckoutTimes.providerBack));
    assert.equal(of(result, "message.nacked").length, rejected.length);
    assert.equal(visible(result, "messaging").sent.length, 1);
  }
});

test("the crash row: the crash falls between the confirming commit and publication, and only the outbox recovers", async () => {
  for (const parameters of [defaults, protectedDesign]) {
    const result = await runRow(row("crash-after-local-commit"), parameters);
    const confirmed = logged(result, "orders", "checkout.confirmed")[0];
    assert.ok(confirmed && confirmed.time < reliableCheckoutTimes.crash, "the confirming commit precedes the crash");
    const lifecycle = of(result, "service.lifecycle.changed", "orders").map(item => `${item.time}:${String(data(item).after)}`);
    assert.deepEqual(lifecycle, ["0:RUNNING", `${reliableCheckoutTimes.crash}:CRASHED`,
      `${reliableCheckoutTimes.crash + reliableCheckoutTimes.restartAfter}:STARTING`, `${reliableCheckoutTimes.crash + reliableCheckoutTimes.restartAfter + 1}:RUNNING`]);
    assert.equal(orderStatus(result), "CONFIRMED", "the committed order survives the crash");
    const published = of(result, "message.published", "orders");
    if (parameters === defaults) assert.equal(published.length, 0, "the crash lost the publication");
    // The relay request reaches orders 1 ms after it is sent, and its relay pass runs 1 ms later.
    else assert.deepEqual(published.map(item => item.time), [reliableCheckoutTimes.relay + 2], "the relay published the recorded event");
  }
  // Without the crash, the default design publishes after the 10 ms boundary, which the crash time falls inside.
  const happy = await runRow(row("happy-path"), defaults);
  const confirmed = logged(happy, "orders", "checkout.confirmed")[0]!;
  const published = of(happy, "message.published", "orders")[0]!;
  assert.ok(confirmed.time < reliableCheckoutTimes.crash && reliableCheckoutTimes.crash < published.time);
});

test("ASSESS-INV-3: every row replays identically, fresh and after reset", async () => {
  for (const item of reliableCheckoutAssessment.rows) {
    const first = await runRow(item, protectedDesign);
    assert.ok(compareExports(first, await runRow(item, protectedDesign)), item.id);
  }
  const overlay = { version: 1, faults: [], scheduledFaults: row("crash-after-local-commit").scheduledFaults, parameters: defaults } as unknown as CanonicalValue;
  const composed = composeOverlay(reliableCheckoutScenario, reliableCheckoutOverlayPolicy, overlay, validate, commerceCatalog);
  assert.ok(composed.ok);
  const session = openHarness(engine.create(composed.document));
  await session.run();
  const fresh = session.inspect();
  await session.reset();
  await session.run();
  assert.ok(compareExports(fresh, session.inspect()));
});
