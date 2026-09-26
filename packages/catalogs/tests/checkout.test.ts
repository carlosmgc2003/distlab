import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutAssessment, checkoutCatalog, checkoutScenario } from "@distlab/catalogs";
import { compareExports, DeterministicScenarioEngine, openHarness } from "@distlab/scenario";

const engine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });

test("the checkout catalog exposes only the approved versioned models", () => {
  for (const name of ["customer-app", "orders", "payments", "payment-processor"]) {
    assert.deepEqual(checkoutCatalog.versions(`distlab.${name}`), ["1.0.0"]);
  }
  assert.deepEqual(checkoutCatalog.versions("distlab.inventory"), []);
  assert.deepEqual(engine.validate(checkoutScenario("normal")), []);
  assert.deepEqual(engine.validate(checkoutScenario("response-lost")), []);
  const normal = checkoutScenario("normal") as { architecture: unknown; faults: unknown[] };
  const lost = checkoutScenario("response-lost") as { architecture: unknown; faults: unknown[] };
  assert.deepEqual(normal.architecture, lost.architecture);
  assert.deepEqual(normal.faults, []);
  assert.equal(lost.faults.length, 1);
});

for (const variant of ["normal", "response-lost"] as const) {
  test(`${variant} checkout completes and reproduces across fresh, reset, and stepped runs`, async () => {
    const scenario = checkoutScenario(variant);
    const first = openHarness(engine.create(scenario));
    await first.run();
    const exportOne = first.inspect();
    assert.equal(exportOne.status, "COMPLETED");
    assert.ok(exportOne.time > 0, `checkout should demonstrate virtual-time progression; got ${exportOne.time}`);
    assert.ok(exportOne.time < 2000, `checkout should finish before its assertion deadline; got ${exportOne.time}`);
    if (variant === "response-lost") assert.ok(exportOne.time > 1000, `lost response should reach the 1000 ms network timeout; got ${exportOne.time}`);
    assert.equal(exportOne.results.every(result => result.status === "PASS"), true, JSON.stringify(exportOne.results));
    const second = openHarness(engine.create(scenario));
    await second.run();
    assert.equal(compareExports(exportOne, second.inspect()), true);
    const stepped = openHarness(engine.create(scenario));
    while (stepped.inspect().status !== "COMPLETED") await stepped.step();
    assert.equal(compareExports(exportOne, stepped.inspect()), true);
    await first.reset();
    await first.run();
    assert.equal(compareExports(exportOne, first.inspect()), true);

    const state = exportOne.state as {
      databases: { orders: { tables: { orders: Record<string, { state: string }>; outbox: Record<string, unknown> } }; payments: { tables: { payments: Record<string, { state: string; outcome: string; authorizationId: string | null }>; inbox: Record<string, unknown> } } };
      components: { "payment-processor": { visible: { authorizations: unknown[] }; effectCount: number } };
    };
    assert.equal(state.databases.orders.tables.orders["order-1"]?.state, "CREATED");
    assert.equal(Object.keys(state.databases.orders.tables.outbox).length, 1);
    assert.equal(Object.keys(state.databases.payments.tables.inbox).length, 1);
    assert.equal(state.components["payment-processor"].visible.authorizations.length, 1);
    assert.equal(state.components["payment-processor"].effectCount, 1);
    const payment = state.databases.payments.tables.payments["payment-1"];
    assert.equal(payment?.state, variant === "normal" ? "AUTHORIZED" : "UNKNOWN");
    assert.equal(payment?.outcome, variant === "normal" ? "APPROVED" : "NETWORK_TIMEOUT");
    assert.equal(payment?.authorizationId, variant === "normal" ? "authorization-1" : null);
    const events = exportOne.history.observations;
    assert.equal(events.filter(event => event.type === "message.published").length, 1);
    assert.equal(events.filter(event => event.type === "external.effect.committed").length, 1);
    if (variant === "response-lost") {
      const commit = events.findIndex(event => event.type === "external.effect.committed");
      const drop = events.findIndex(event => event.type === "network.response.dropped");
      const timeout = events.findIndex(event => event.type === "network.request.timedout");
      assert.ok(commit >= 0 && commit < drop && drop < timeout);
      assert.equal(events.some(event => event.type === "fault.effect.selected"), true);
      assert.equal(events.filter(event => event.type === "network.request.timedout").length, 1);
    } else {
      assert.equal(events.some(event => event.type === "network.response.dropped"), false);
      assert.equal(events.some(event => event.type === "network.request.timedout"), false);
    }
  });
}
