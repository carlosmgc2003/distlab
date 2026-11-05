import { test } from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import type { HarnessExport } from "@distlab/scenario";
import assert from "node:assert/strict";
import { commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
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
  for (const [left, right] of [["retry-unsafe", "retry-idempotent"], ["saga-uncompensated", "saga-compensated"], ["dual-write", "outbox-idempotent"], ["outbox-unsafe-consumer", "outbox-idempotent"], ["cascade-unprotected", "cascade-breaker"], ["notifications-unbounded", "notifications-dlq"], ["cache-stale-price", "cache-invalidated"], ["inventory-oversell", "inventory-optimistic"]] as const) {
    const a = object(commerceScenario(left)), b = object(commerceScenario(right));
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.faults, b.faults);
    assert.deepEqual(a.actions, b.actions);
  }
});

const families = [["retry-unsafe", "retry-idempotent"], ["saga-uncompensated", "saga-compensated"], ["dual-write", "outbox-unsafe-consumer", "outbox-idempotent", "outbox-notifications-gap"], ["cqrs-delayed"], ["cascade-unprotected", "cascade-breaker"], ["notifications-unbounded", "notifications-dlq"], ["cache-stale-price", "cache-invalidated"], ["inventory-oversell", "inventory-optimistic"]] as const;
/** The business invariants each packaged lesson is meant to violate; every other check passes. */
const violated: Record<typeof commerceLessonNames[number], readonly string[]> = {
  "retry-unsafe": ["one-payment-per-order"],
  "retry-idempotent": [],
  "saga-uncompensated": ["failed-order-cancelled", "failed-order-releases-inventory", "failed-order-refunded"],
  "saga-compensated": [],
  "dual-write": ["one-notification-per-payment", "payment-event-published"],
  "outbox-unsafe-consumer": ["one-notification-per-payment"],
  "outbox-idempotent": [],
  "outbox-notifications-gap": ["one-notification-per-payment"],
  "cqrs-delayed": [],
  "cascade-unprotected": ["bounded-waiting"],
  "cascade-breaker": [],
  "notifications-unbounded": ["order-confirmed-despite-notification-failure", "failed-notification-dead-lettered", "bounded-notification-retries"],
  "notifications-dlq": [],
  "cache-stale-price": ["order-priced-at-checkout"],
  "cache-invalidated": [],
  "inventory-oversell": ["stock-never-negative", "one-reservation-per-unit"],
  "inventory-optimistic": [],
};
const assertionsOf = (name: typeof commerceLessonNames[number]) => object(commerceScenario(name)).assertions as Record<string, CanonicalValue>[];

test("every check in the 17 commerce lessons is classified as a business invariant or a scenario expectation", () => {
  assert.equal(families.flat().length, commerceLessonNames.length);
  for (const name of commerceLessonNames) {
    const checks = commerceChecks(name);
    assert.deepEqual(checks.map(check => check.id), assertionsOf(name).map(assertion => assertion.id), name);
    for (const check of checks) {
      assert.ok(check.kind === "invariant" || check.kind === "expectation", `${name} ${check.id}`);
      assert.ok(check.label.length > 0 && !check.label.includes(check.id), `${name} ${check.id} has a student-facing label`);
    }
    assert.ok(checks.some(check => check.kind === "invariant"), `${name} assesses at least one business invariant`);
    for (const id of violated[name]) assert.equal(checks.find(check => check.id === id)?.kind, "invariant", `${name} ${id}`);
  }
});

test("each lesson family shares its invariant IDs and states each invariant identically", () => {
  for (const family of families) {
    const invariantsOf = (name: typeof family[number]) => {
      const ids = new Set(commerceChecks(name).filter(check => check.kind === "invariant").map(check => check.id));
      return assertionsOf(name).filter(assertion => ids.has(String(assertion.id)));
    };
    const [first, ...rest] = family;
    for (const name of rest) {
      assert.deepEqual(invariantsOf(name), invariantsOf(first), `${name} and ${first} assert the same invariants`);
      assert.deepEqual(commerceChecks(name).filter(check => check.kind === "invariant"), commerceChecks(first).filter(check => check.kind === "invariant"));
    }
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
  assert.equal(object(metrics(unsafe, "payments")).peakActive, 10);
  assert.equal(object(metrics(safe, "payments")).peakActive, 3);
});

test("a failing Messaging Provider: unbounded retry blocks the order, bounded retry dead-letters the notification", async () => {
  const unsafe = await execute("notifications-unbounded"), safe = await execute("notifications-dlq");
  const of = (result: HarnessExport, type: string) => result.history.observations.filter(o => o.type === type);
  const orderPlaced = (result: HarnessExport) => object(object(result.state).messageBus!).records as Record<string, CanonicalValue>[];
  const order = (result: HarnessExport) => object(object(object(object(object(result.state).databases!).orders!).tables!).orders!)["order-1"];
  // Every send while the provider is unreachable is lost, times out, and NACKs the delivery.
  for (const result of [unsafe, safe]) {
    const sends = of(result, "network.request.sent").filter(o => o.source === "notifications");
    assert.equal(of(result, "network.request.timedout").filter(o => o.source === "notifications").length, Math.min(sends.length, 5));
    assert.equal(of(result, "message.nacked").length, of(result, "network.request.timedout").filter(o => o.source === "notifications").length);
  }
  // Unsafe: six attempts, success only after recovery at t=80, and Orders confirms only after that.
  assert.deepEqual(logs(unsafe, "notification.sending").map(entry => entry.attempt), [1, 2, 3, 4, 5, 6]);
  assert.equal(of(unsafe, "message.dead").length, 0);
  assert.deepEqual(orderPlaced(unsafe).filter(r => r.destination === "OrderPlaced").map(r => [r.state, r.attempt]), [["ACKED", 6]]);
  const confirmed = unsafe.history.observations.find(o => o.type === "runtime.log" && object(o.data!).message === "order.confirmed-after-notification");
  assert.ok(confirmed && confirmed.time > 80);
  assert.deepEqual({ ...object(order(unsafe)!) }, { status: "CONFIRMED" });
  assert.deepEqual(JSON.parse(JSON.stringify(object(object(object(unsafe.state).components!).messaging!).visible)), { sent: [{ orderId: "order-1" }] });
  // Safe: the order is confirmed at checkout; three attempts, then DEAD and held for inspection.
  assert.deepEqual(logs(safe, "client.result").map(entry => object(entry.result!).status), ["CONFIRMED"]);
  assert.deepEqual(logs(safe, "notification.sending").map(entry => entry.attempt), [1, 2, 3]);
  const dead = of(safe, "message.dead");
  assert.equal(dead.length, 1);
  assert.equal(dead[0]!.time, 44);
  assert.deepEqual(orderPlaced(safe).filter(r => r.destination === "OrderPlaced").map(r => [r.state, r.attempt]), [["DEAD", 3]]);
  const letters = object(object(safe.state).messageBus!).deadLetters as Record<string, CanonicalValue>[];
  assert.deepEqual(JSON.parse(JSON.stringify(letters.map(letter => [letter.destination, letter.attempts, letter.reason, object(letter.message!).body]))), [["OrderPlaced", 3, "nack", { orderId: "order-1" }]]);
  assert.equal(of(safe, "external.effect.committed").length, 0);
  assert.equal(logs(safe, "order.notified").length, 0);
  assert.deepEqual({ ...object(order(safe)!) }, { status: "CONFIRMED" });
});

test("a cached price outlives a price change unless the change invalidates it; an expired cart cannot be checked out", async () => {
  const unsafe = await execute("cache-stale-price"), safe = await execute("cache-invalidated");
  const of = (result: HarnessExport, type: string) => result.history.observations.filter(o => o.type === type);
  const tables = (result: HarnessExport, owner: string) => object(object(object(object(result.state).databases!)[owner]!).tables!);
  const order = (result: HarnessExport, key: string) => JSON.parse(JSON.stringify(object(tables(result, "orders").orders!)[key]));
  const result = (r: HarnessExport, id: string) => r.results.find(item => item.id === id)!;
  for (const r of [unsafe, safe]) {
    // The price change commits the current price and its history row together at t=11.
    assert.deepEqual(JSON.parse(JSON.stringify(tables(r, "catalog"))), {
      prices: { "sku-1": { sku: "sku-1", price: 1200, version: 2, validFrom: 11 } },
      "price-history": { "sku-1@1": { sku: "sku-1", price: 1000, version: 1, validFrom: 0 }, "sku-1@2": { sku: "sku-1", price: 1200, version: 2, validFrom: 11 } },
    });
    // Both carts expire by TTL at t=31; cart-2's checkout at t=40 finds no cart and is rejected.
    const carts = of(r, "kv.expired").filter(o => o.source === "cart");
    assert.deepEqual(carts.map(o => [o.time, object(o.data!).key]), [[31, "cart:cart-1"], [31, "cart:cart-2"]]);
    assert.deepEqual(order(r, "order-2"), { status: "REJECTED", reason: "CART_EXPIRED", cartId: "cart-2", checkedOutAt: 43 });
    assert.equal(result(r, "no-expired-cart-checkout").status, "PASS");
    assert.equal(r.status, "COMPLETED");
  }
  // Unsafe: the price cached at t=1 is still live at t=24, so order-1 is charged the old price.
  assert.deepEqual(logs(unsafe, "price.cache-hit").map(entry => entry.price), [1000]);
  assert.equal(logs(unsafe, "price.cache-invalidated").length, 0);
  assert.deepEqual([order(unsafe, "order-1").price, order(unsafe, "order-1").priceSource, order(unsafe, "order-1").checkedOutAt], [1000, "cache", 25]);
  assert.deepEqual(JSON.parse(JSON.stringify(result(unsafe, "order-priced-at-checkout").evidence)),
    [{ orderId: "order-1", sku: "sku-1", checkedOutAt: 25, charged: 1000, valid: 1200 }]);
  assert.equal(result(unsafe, "order-priced-at-checkout").status, "FAIL");
  // The stale entry stays in the store until its TTL ends at t=101.
  assert.deepEqual(of(unsafe, "kv.expired").filter(o => o.source === "catalog").map(o => [o.time, object(object(o.data!).value!).price]), [[101, 1000]]);
  // Safe: the change deletes the cached key, so checkout misses the cache and reads 1200 from the database.
  assert.deepEqual(JSON.parse(JSON.stringify(logs(safe, "price.cache-invalidated"))), [{ sku: "sku-1", removed: true }]);
  assert.equal(logs(safe, "price.cache-hit").length, 0);
  assert.deepEqual([order(safe, "order-1").price, order(safe, "order-1").priceSource], [1200, "database"]);
  assert.equal(result(safe, "order-priced-at-checkout").status, "PASS");
  // A checkout that commits after the cart's deadline violates the cart invariant, even if the cart was live when checked.
  const doc = object(commerceScenario("cache-invalidated"));
  const slow = { ...doc, faults: [fault("slow-price", "orders", "catalog", 10)] };
  const session = openHarness(engine.create(slow));
  await session.run();
  const late = session.inspect();
  assert.deepEqual([order(late, "order-1").checkedOutAt, order(late, "order-1").cartExpiresAt], [35, 31]);
  assert.equal(result(late, "no-expired-cart-checkout").status, "FAIL");
});

test("two clients reserving the last unit: check-then-act oversells, optimistic concurrency rejects the second commit", async () => {
  const unsafe = await execute("inventory-oversell"), safe = await execute("inventory-optimistic");
  const of = (result: HarnessExport, type: string) => result.history.observations.filter(o => o.type === type);
  const tables = (result: HarnessExport) => JSON.parse(JSON.stringify(object(object(object(result.state).databases!).inventory!).tables!));
  const outcome = (result: HarnessExport) => logs(result, "client.result").map(entry => [object(entry.result!).reservationId ?? null, object(entry.result!).status]);
  const result = (r: HarnessExport, id: string) => r.results.find(item => item.id === id)!;
  for (const r of [unsafe, safe]) {
    // Both clients send at t=0; both checks read the last unit before either write commits.
    assert.deepEqual(logs(r, "stock.checked").map(entry => [entry.reservationId, entry.stock, entry.version]), [["res-customer-app", 1, 1], ["res-partner-api", 1, 1]]);
    assert.deepEqual(of(r, "runtime.log").filter(o => object(o.data!).message === "stock.checked").map(o => o.time), [1, 2]);
    assert.equal(r.status, "COMPLETED");
  }
  // Unsafe: each write is a fresh transaction, so both commit (t=6, t=7) and the stock goes to -1.
  assert.deepEqual(of(unsafe, "database.transaction.committed").map(o => [o.time, object(o.data!).oldRevision, object(o.data!).newRevision]), [[6, 0, 1], [7, 1, 2]]);
  assert.equal(of(unsafe, "database.transaction.rejected").length, 0);
  assert.deepEqual(tables(unsafe).stock, { "sku-1": { sku: "sku-1", units: 1, stock: -1, version: 3 } });
  assert.deepEqual(Object.keys(tables(unsafe).reservations), ["res-customer-app", "res-partner-api"]);
  assert.deepEqual(outcome(unsafe), [["res-customer-app", "RESERVED"], ["res-partner-api", "RESERVED"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(result(unsafe, "stock-never-negative").evidence)), [{ sku: "sku-1", stock: -1, version: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result(unsafe, "one-reservation-per-unit").evidence)), [{ sku: "sku-1", units: 1, active: ["res-customer-app", "res-partner-api"] }]);
  // Safe: the partner's transaction read version 1; the customer's commit moved it to 2, so the database rejects it.
  const rejected = of(safe, "database.transaction.rejected");
  assert.deepEqual(rejected.map(o => [o.time, object(o.data!).code]), [[7, "TRANSACTION_CONFLICT"]]);
  // The rejected transaction's staged write is in history with its before/after rows; committed state never shows it.
  const staged = of(safe, "database.write.staged").filter(o => object(o.data!).transactionId === object(rejected[0]!.data!).transactionId && object(o.data!).table === "stock");
  assert.deepEqual(JSON.parse(JSON.stringify(staged.map(o => [object(o.data!).before, object(o.data!).after]))),
    [[{ present: true, value: { sku: "sku-1", units: 1, stock: 1, version: 1 } }, { present: true, value: { sku: "sku-1", units: 1, stock: 0, version: 2 } }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(logs(safe, "reservation.conflict"))), [{ reservationId: "res-partner-api", sku: "sku-1", readVersion: 1, attempt: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(logs(safe, "reservation.out-of-stock"))), [{ reservationId: "res-partner-api", sku: "sku-1", stock: 0, version: 2 }]);
  assert.deepEqual(tables(safe).stock, { "sku-1": { sku: "sku-1", units: 1, stock: 0, version: 2 } });
  assert.deepEqual(Object.keys(tables(safe).reservations), ["res-customer-app"]);
  assert.deepEqual(outcome(safe), [["res-customer-app", "RESERVED"], ["res-partner-api", "OUT_OF_STOCK"]]);
  for (const id of ["stock-never-negative", "one-reservation-per-unit"]) assert.equal(result(safe, id).status, "PASS");
});

function fault(id: string, source: string, target: string, duration: number) {
  return { id, point: "network.request", source, target, name: "GET /price", from: 15, until: 30, probability: 1, maxApplications: 1, effect: { kind: "delay", duration } };
}

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
    // Unsafe lessons violate their invariants; every lesson reproduces its setup.
    assert.deepEqual(result.results.filter(r => r.status !== "PASS").map(r => `${r.id} ${r.status}`), violated[name].map(id => `${id} FAIL`), JSON.stringify(result.results));
    // The cache and inventory pairs need no injected fault: ordinary timing tells their story.
    const faulted = result.history.observations.some(o => o.type === "fault.effect.selected" || o.type === "fault.applied");
    assert.equal(faulted, !name.startsWith("cache-") && !name.startsWith("inventory-"), name);
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
    if (name === "outbox-notifications-gap") {
      // The empty slot is subscribed to nothing: the event is published and never delivered.
      assert.equal(result.history.observations.filter(o => o.type === "message.published").length, 1);
      assert.equal(result.history.observations.filter(o => o.type === "message.delivered").length, 0);
      assert.equal(logs(result, "notification.created").length, 0);
    } else if (name.startsWith("outbox-")) {
      const delivered = result.history.observations.filter(o => o.type === "message.delivered");
      assert.equal(delivered.length, 2);
      assert.equal(object(delivered[0]!.data!).messageId, object(delivered[1]!.data!).messageId);
      assert.equal(logs(result, "notification.created").length, name === "outbox-idempotent" ? 1 : 2);
      assert.equal(logs(result, "consumer.duplicate-ignored").length, name === "outbox-idempotent" ? 1 : 0);
    }
    if (name === "dual-write") {
      assert.equal(logs(result, "notification.created").length, 0);
      assert.equal(result.history.observations.filter(o => o.type === "message.published").length, 0);
    }
    if (name === "saga-uncompensated") {
      const tables = (owner: string) => object(object(object(object(result.state).databases!)[owner]!).tables!);
      assert.deepEqual({ ...object(object(tables("orders").orders!)["order-1"]!) }, { status: "NEEDS_COMPENSATION" });
      assert.deepEqual({ ...object(object(tables("payments").state!)["order-1"]!) }, { status: "APPROVED", refunded: false });
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
