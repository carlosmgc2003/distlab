import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import { commerceAssessment, commerceCatalog, commerceOverlayPolicy, commerceScenario } from "@distlab/catalogs";
import { DeterministicScenarioEngine, compareExports, composeOverlay, openHarness, type HarnessExport } from "@distlab/scenario";

/**
 * #126: a notifications sender NACKs a send the Messaging Provider rejected.
 * The packaged lesson drops sends until t=80; the student then keeps the
 * provider RATE_LIMITED until t=110, so the sends between are rejected replies.
 */
const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const outage = (state: string, at: number, id: string) =>
  ({ id: `student-${id}`, at, kind: "fault", fault: { id: `student-${id}-fault`, kind: "external-availability", target: "messaging", state } });
const rateLimited = { version: 1, faults: [], parameters: [],
  scheduledFaults: [outage("RATE_LIMITED", 80, "rate-limited"), outage("AVAILABLE", 110, "recovered")] };

function compose(name: "notifications-unbounded" | "notifications-dlq") {
  const result = composeOverlay(commerceScenario(name), commerceOverlayPolicy(name), rateLimited as unknown as CanonicalValue, value => engine.validate(value), commerceCatalog);
  assert.ok(result.ok, JSON.stringify(result));
  return result.document;
}
async function execute(document: CanonicalValue): Promise<HarnessExport> {
  const session = openHarness(engine.create(document));
  await session.run();
  return session.inspect();
}
const of = (result: HarnessExport, type: string) => result.history.observations.filter(item => item.type === type);
const data = (item: { readonly data?: unknown }) => item.data as Record<string, CanonicalValue>;

test("#126: the notifications policy lets a student change Messaging's availability", () => {
  for (const name of ["notifications-unbounded", "notifications-dlq"] as const) {
    assert.ok(commerceOverlayPolicy(name).faults.scheduled.includes("external-availability"), name);
  }
});

test("#126: a RATE_LIMITED provider's rejections NACK the delivery, and the run completes", async () => {
  const result = await execute(compose("notifications-unbounded"));
  assert.equal(result.status, "COMPLETED");
  const failed = of(result, "service.handler.failed").filter(item => item.source === "notifications").map(data);
  const rejected = failed.filter(item => item.code === "EXTERNAL_RATE_LIMITED");
  assert.ok(rejected.length > 0, "at least one send was rejected while the provider was RATE_LIMITED");
  assert.ok(failed.every(item => item.kind === "consumer" && (item.code === "EXTERNAL_RATE_LIMITED" || item.code === "NETWORK_TIMEOUT")));
  // Every rejection and every timeout NACKed its delivery; nothing else did.
  assert.equal(of(result, "message.nacked").length, failed.length);
  // The rejections happened during the outage, after the packaged drop window.
  for (const item of of(result, "service.handler.failed").filter(entry => data(entry).code === "EXTERNAL_RATE_LIMITED")) {
    assert.ok(item.time >= 80 && item.time < 110, `rejected at ${item.time}`);
  }
  // Once the provider recovers, the redelivered send goes through once.
  const provider = (result.state as { components: Record<string, { availability: string; visible: { sent: unknown[] } }> }).components.messaging!;
  assert.equal(provider.availability, "AVAILABLE");
  assert.equal(JSON.stringify(provider.visible.sent), JSON.stringify([{ orderId: "order-1" }]));
  assert.deepEqual(of(result, "external.availability.changed").map(item => [item.time, data(item).after]), [[80, "RATE_LIMITED"], [110, "AVAILABLE"]]);
});

test("#126: a run with a rejecting provider replays identically, fresh and after reset", async () => {
  for (const name of ["notifications-unbounded", "notifications-dlq"] as const) {
    const document = compose(name);
    const first = await execute(document);
    assert.equal(first.status, "COMPLETED", name);
    assert.ok(compareExports(first, await execute(document)), name);
    const session = openHarness(engine.create(document));
    await session.run();
    await session.reset();
    await session.run();
    assert.ok(compareExports(first, session.inspect()), `${name} after reset`);
  }
});
