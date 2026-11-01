import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { commerceAssessment, commerceCatalog, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { mapArchitecture } from "../src/architecture-view.ts";
import { scenarios, packagedMetadata } from "../src/scenarios.ts";
import { storyMilestones } from "../src/story-timeline.ts";

for (const name of commerceLessonNames) test(`${name}: browser worker matches headless state/history, resets, and projects only authorized facts`, async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  const latest = (): RuntimeProjectionSet => {
    const event = events.filter(e => "projection" in e).at(-1);
    assert.ok(event && "projection" in event);
    return event.projection;
  };
  const scenario = commerceScenario(name);
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario });
  const initial = latest();
  await adapter.receive({ version: 1, requestId: "step", type: "step" });
  assert.equal(latest().simulation.processedEvents, 1);
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  assert.ok(!events.some(e => e.type === "error"));
  const result = latest();
  assert.equal(result.simulation.status, "COMPLETED");
  assert.equal(result.simulation.pendingEvents, 0);
  const headless = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment }).create(scenario);
  await headless.simulation.run();
  assert.deepEqual(result.history.observations, JSON.parse(JSON.stringify(headless.simulation.history.export().observations)));
  assert.equal(result.simulation.processedEvents, headless.simulation.processedEvents);
  assert.equal(result.simulation.randomDrawCount, headless.simulation.randomDrawCount);
  const client = result.components.find(c => c.componentId === "client" && c.visibility === "student")!;
  const state = client.state as Record<string, CanonicalValue>;
  assert.deepEqual(state.assertions, JSON.parse(JSON.stringify(headless.results())));
  const visible = JSON.stringify(result.components.filter(c => c.visibility === "student"));
  assert.ok(!visible.includes('"tasks"') && !visible.includes('"effectCount"'));
  const choice = scenarios.find(choice => choice.id === name)!;
  const graph = mapArchitecture(result.architecture, packagedMetadata(choice).architecture, packagedMetadata(choice).name);
  assert.equal(graph.error, null);
  assert.equal(new Set(graph.nodes.map(n => JSON.stringify(n.position))).size, graph.nodes.length);
  if (name.startsWith("outbox")) assert.ok(graph.edges.some(e => e.data?.relationship === "publication"));
  // runtime.log is not a documented milestone: commerce Story strips stay on network, message,
  // commit, and fault records, and those records keep their place in Learning and Raw.
  const milestones = storyMilestones(result.history.observations);
  assert.ok(milestones.length > 0, "commerce lesson still teaches milestones");
  assert.ok(milestones.every(m => m.observation.type !== "runtime.log"));
  assert.ok(result.history.observations.some(o => o.type === "runtime.log"));
  await adapter.receive({ version: 1, requestId: "reset", type: "reset" });
  assert.deepEqual(latest(), initial);
  await adapter.receive({ version: 1, requestId: "replay", type: "run" });
  assert.deepEqual(latest(), result);
});

test("notifications: the student projection shows delivery attempts, dead letters, and the provider's visible state", async () => {
  const finished = async (name: "notifications-unbounded" | "notifications-dlq"): Promise<RuntimeProjectionSet> => {
    const events: WorkerEvent[] = [];
    const adapter = new WorkerAdapter(event => events.push(event));
    await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: commerceScenario(name) });
    await adapter.receive({ version: 1, requestId: "run", type: "run" });
    const event = events.filter(e => "projection" in e).at(-1);
    assert.ok(event && "projection" in event);
    return event.projection;
  };
  const state = (projection: RuntimeProjectionSet, id: string) =>
    projection.components.find(c => c.componentId === id && c.visibility === "student")!.state as Record<string, CanonicalValue>;
  const safe = await finished("notifications-dlq"), unsafe = await finished("notifications-unbounded");
  const bus = state(safe, "OrderPlaced");
  assert.equal(bus.role, "bus-delivery");
  const [record] = bus.records as Record<string, CanonicalValue>[];
  assert.deepEqual([record!.state, record!.attempt, record!.consumer], ["DEAD", 3, "notifications"]);
  assert.deepEqual(bus.deadLetters, [{ messageId: record!.messageId, attempts: 3, reason: "nack", consumer: "notifications" }]);
  // The dead letter is also a recorded fact in history, at the time the bus gave up.
  const dead = safe.history.observations.filter(o => o.type === "message.dead");
  assert.deepEqual(dead.map(o => o.time), [44]);
  // The provider never accepted a send, so it has no visible effect to show.
  assert.deepEqual(state(safe, "messaging"), { role: "external-visible", availability: "AVAILABLE", visible: {} });
  assert.deepEqual(state(unsafe, "OrderPlaced").deadLetters, []);
  assert.deepEqual((state(unsafe, "OrderPlaced").records as Record<string, CanonicalValue>[]).map(r => [r.state, r.attempt]), [["ACKED", 6]]);
  assert.deepEqual(state(unsafe, "messaging").visible, { sent: [{ orderId: "order-1" }] });
  // Message bodies stay out of the delivery projection; only delivery facts reach the student.
  assert.ok(!JSON.stringify(bus).includes('"body"'));
});

test("cache: the student projection shows live KV entries with their absolute expiry and the price Orders used", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  const latest = (): RuntimeProjectionSet => {
    const event = events.filter(e => "projection" in e).at(-1);
    assert.ok(event && "projection" in event);
    return event.projection;
  };
  const state = (id: string) => latest().components.find(c => c.componentId === id && c.visibility === "student")!.state as Record<string, CanonicalValue>;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: commerceScenario("cache-stale-price") });
  for (let i = 0; i < 200 && (state("cart").store as CanonicalValue[]).length < 2; i++) await adapter.receive({ version: 1, requestId: `step-${i}`, type: "step" });
  // Each live entry carries its key, value, and absolute expiry; store generations stay host-only.
  assert.deepEqual(state("cart").store, [
    { key: "cart:cart-1", value: { cartId: "cart-1", sku: "sku-1", quantity: 1, expiresAt: 31 }, expiresAt: 31 },
    { key: "cart:cart-2", value: { cartId: "cart-2", sku: "sku-1", quantity: 1, expiresAt: 31 }, expiresAt: 31 },
  ]);
  assert.deepEqual(state("catalog").store, [{ key: "price:sku-1", value: { sku: "sku-1", price: 1000, version: 1 }, expiresAt: 101 }]);
  assert.ok(!JSON.stringify(latest().components.filter(c => c.visibility === "student")).includes("generation"));
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  assert.equal(latest().simulation.status, "COMPLETED");
  // Expired entries are absent from state; the expiry itself stays in Recorded history.
  assert.deepEqual([state("cart").store, state("catalog").store], [[], []]);
  assert.deepEqual(latest().history.observations.filter(o => o.type === "kv.expired").map(o => [o.time, o.source]), [[31, "cart"], [31, "cart"], [101, "catalog"]]);
  const order = (state("orders").committed as Record<string, Record<string, Record<string, Record<string, CanonicalValue>>>>).tables!.orders!["order-1"];
  assert.deepEqual([order!.price, order!.priceSource], [1000, "cache"]);
  // The cache pair offers only the switch that distinguishes it.
  assert.deepEqual(scenarios.find(s => s.id === "cache-stale-price")!.policy.parameters.map(p => p.key), ["cache-invalidation"]);
});
