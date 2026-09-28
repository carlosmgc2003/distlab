import { test } from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import type { HarnessExport } from "@distlab/scenario";
import assert from "node:assert/strict";
import { commerceAssessment, commerceCatalog, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import { compareExports, DeterministicScenarioEngine, openHarness } from "@distlab/scenario";

function object(value: CanonicalValue): Record<string, CanonicalValue> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, CanonicalValue>;
}
function logs(result: HarnessExport, message: string) {
  return result.history.observations.filter(o => o.type === "runtime.log" && object(o.data!).message === message).map(o => object(object(o.data!).data!));
}
const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
async function execute(name: typeof commerceLessonNames[number]) {
  const session = openHarness(engine.create(commerceScenario(name)));
  await session.run();
  return session.inspect();
}
function metrics(result: HarnessExport, owner: string) {
  const entries = object(object(result.state).stores!)[owner];
  assert.ok(Array.isArray(entries));
  const entry = entries.find(item => object(item).key === "dependency");
  assert.ok(entry);
  return object(entry).value!;
}

test("paired lessons use equivalent fault schedules, workloads, and seeds", () => {
  for (const [left, right] of [["retry-unsafe", "retry-idempotent"], ["saga-uncompensated", "saga-compensated"], ["dual-write", "outbox-idempotent"], ["outbox-unsafe-consumer", "outbox-idempotent"], ["cascade-unprotected", "cascade-breaker"]] as const) {
    const a = object(commerceScenario(left)), b = object(commerceScenario(right));
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.faults, b.faults);
    assert.deepEqual(a.actions, b.actions);
  }
});

test("circuit breaker reduces downstream load and upstream accumulated waiting", async () => {
  const unsafe = await execute("cascade-unprotected"), safe = await execute("cascade-breaker");
  for (const owner of ["api", "orders", "payments"]) {
    const a = object(metrics(unsafe, owner)), b = object(metrics(safe, owner));
    assert.ok(Number(b.totalWait) < Number(a.totalWait), owner);
    assert.ok(Number(b.peakActive) < Number(a.peakActive), owner);
    assert.equal(b.active, 0);
  }
  const callsToRisk = (result: HarnessExport) => result.history.observations.filter(o => o.type === "network.request.sent" && o.source === "payments").length;
  assert.equal(callsToRisk(unsafe), 16);
  assert.equal(callsToRisk(safe), 5);
});

test("outbox and payment roll back together when the local commit fails", async () => {
  const doc = object(commerceScenario("outbox-idempotent"));
  const modified = { ...doc, assertions: [], faults: [{ id: "reject-payment-commit", point: "database.commit", source: "payments", target: "payments", name: "payments", from: 0, probability: 1, maxApplications: 1, effect: { kind: "fail" } }] };
  const session = openHarness(engine.create(modified));
  await session.run();
  const result = session.inspect();
  assert.equal(result.status, "COMPLETED");
  const databases = object(object(result.state).databases!);
  const tables = object(object(databases.payments!).tables!);
  assert.equal(Object.keys(object(tables.payments!)).length, 0);
  assert.equal(Object.keys(object(tables.outbox!)).length, 0);
  assert.equal(result.history.observations.filter(o => o.type === "message.published").length, 0);
  assert.ok(result.history.observations.some(o => o.type === "database.transaction.rejected"));
});
for (const name of commerceLessonNames) {
  test(`${name}: behavioral assertions and fresh/reset/step replay`, async () => {
    const document = commerceScenario(name);
    assert.deepEqual(engine.validate(document), []);
    const session = openHarness(engine.create(document));
    await session.run();
    const result = session.inspect();
    assert.equal(result.status, "COMPLETED");
    assert.ok(result.results.length > 0);
    assert.ok(result.results.every(r => r.status === "PASS"), JSON.stringify(result.results));
    assert.ok(result.history.observations.some(o => o.type === "fault.effect.selected" || o.type === "fault.applied"));
    const fresh = openHarness(engine.create(document));
    await fresh.run();
    assert.ok(compareExports(result, fresh.inspect()));
    await session.reset();
    await session.run();
    assert.ok(compareExports(result, session.inspect()));
    const steppedSession = engine.create(document);
    const stepped = openHarness(steppedSession);
    for (let i = 0; steppedSession.simulation.status !== "COMPLETED" && i < 10000; i++) await stepped.step();
    assert.ok(compareExports(result, stepped.inspect()));
    if (name.startsWith("retry")) {
      const events = result.history.observations;
      const commit = events.findIndex(o => o.type === "database.transaction.committed");
      const drop = events.findIndex(o => o.type === "network.response.dropped");
      const timeout = events.findIndex(o => o.type === "network.request.timedout");
      assert.ok(commit >= 0 && commit < drop && drop < timeout);
      assert.equal(events.filter(o => o.type === "network.request.sent").length, 2);
      const outcome = logs(result, "client.result")[0]!;
      assert.equal(object(outcome.result!).paymentId, name === "retry-idempotent" ? "payment-1" : "payment-2");
    }
    if (name.startsWith("outbox-")) {
      const delivered = result.history.observations.filter(o => o.type === "message.delivered");
      assert.equal(delivered.length, 2);
      assert.equal(object(delivered[0]!.data!).messageId, object(delivered[1]!.data!).messageId);
      assert.equal(logs(result, "notification.created").length, name === "outbox-idempotent" ? 1 : 2);
      assert.equal(logs(result, "consumer.duplicate-ignored").length, name === "outbox-idempotent" ? 1 : 0);
    }
    if (name === "saga-compensated") {
      assert.deepEqual(logs(result, "saga.compensation").map(entry => entry.component), ["payments", "inventory", "orders"]);
    }
    if (name === "cqrs-delayed") {
      assert.deepEqual(logs(result, "cqrs.projection-read").map(entry => entry.status), ["PENDING", "PAID"]);
      assert.deepEqual(logs(result, "cqrs.write-read").map(entry => entry.status), ["PAID", "PAID"]);
    }
    if (name.startsWith("cascade-")) {
      const responses = logs(result, "client.result").map(entry => object(entry.result!));
      assert.equal(responses.length, 16);
      assert.equal(responses.filter(reply => reply.status === "APPROVED").length, name === "cascade-breaker" ? 2 : 3);
      assert.ok(responses.every(reply => reply.status === "APPROVED" || reply.status === "UNAVAILABLE"));
      assert.equal(result.history.observations.some(o => o.type === "database.transaction.rejected"), false);
    }
    if (name === "cascade-breaker") {
      assert.deepEqual(logs(result, "breaker.state").map(entry => entry.state), ["CLOSED", "OPEN", "HALF_OPEN", "CLOSED"]);
    }
  });
}
