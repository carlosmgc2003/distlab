import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureProjection, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { mapArchitecture } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { detached } from "../src/protocol.ts";

async function load(index = 0): Promise<RuntimeProjectionSet> {
  const events: WorkerEvent[] = [];
  await new WorkerAdapter(event => events.push(event)).receive({ version: 1, requestId: "test", type: "load", scenario: scenarios[index]!.scenario });
  const loaded = events.find(event => event.type === "loaded");
  assert.ok(loaded?.type === "loaded");
  return loaded.projection;
}

test("maps both checkout projections, all categories, requests and bus relationships without mutating inputs", async () => {
  for (const [index, choice] of scenarios.entries()) {
    const projection = await load(index);
    const metadata = packagedMetadata(choice);
    const before = JSON.stringify({ projection, metadata });
    const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name);
    assert.equal(graph.error, null);
    assert.equal(graph.nodes.length, 5);
    assert.deepEqual(graph.nodes.map(node => node.data.component.kind).sort(), ["client", "external", "infrastructure", "service", "service"]);
    assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target, edge.data?.relationship]), [
      ["customer-app", "orders", "request"], ["payments", "payment-processor", "request"],
      ["OrderCreated", "payments", "subscription"], ["orders", "OrderCreated", "publication"],
    ]);
    assert.equal(new Set(graph.edges.map(edge => edge.style?.strokeDasharray ?? "solid")).size, 3);
    for (const node of graph.nodes) {
      assert.equal(node.draggable, false); assert.equal(node.connectable, false); assert.equal(node.deletable, false);
      assert.ok(node.ariaLabel?.includes(node.data.title));
    }
    assert.equal(JSON.stringify({ projection, metadata }), before);
    assert.ok(Object.isFrozen(metadata.architecture.components[0]?.configuration));
  }
});

test("layout is deterministic, detached, and independent of input ordering", async () => {
  const { architecture } = await load();
  const first = mapArchitecture(architecture);
  const second = mapArchitecture(detached(architecture));
  assert.deepEqual(first, second);
  assert.deepEqual(first.nodes, mapArchitecture({ ...architecture, components: [...architecture.components].reverse() }).nodes);
  assert.deepEqual(first.nodes.map(node => [node.id, node.position]), [
    ["OrderCreated", { x: 310, y: 210 }], ["customer-app", { x: 0, y: 0 }],
    ["orders", { x: 310, y: 0 }], ["payment-processor", { x: 620, y: 420 }], ["payments", { x: 310, y: 420 }],
  ]);
  first.nodes[0]!.position.x = 999;
  assert.equal(second.nodes[0]!.position.x, 310);
});

test("inspector metadata comes from matching static definitions and omits business-state values", async () => {
  const projection = await load();
  const metadata = packagedMetadata(scenarios[0]);
  const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name);
  const node = (id: string) => graph.nodes.find(item => item.id === id)!;
  assert.deepEqual(node("orders").data.configuration, {});
  assert.deepEqual(node("orders").data.resources, ["Database owned by orders: orders, outbox"]);
  assert.deepEqual(node("payments").data.resources, ["Database owned by payments: payments, inbox"]);
  assert.deepEqual(node("customer-app").data.resources, ["Model-owned checkout request and outcome"]);
  assert.deepEqual(node("payment-processor").data.resources, ["Model-owned provider authorization ledger"]);
  assert.deepEqual(node("OrderCreated").data.configuration, { deliveryDelay: 0, ackTimeout: 1000, retryDelay: 0, maxAttempts: 3, capacity: 10000 });
  assert.equal(node("OrderCreated").data.component.model, undefined);
  assert.equal(node("OrderCreated").data.component.version, undefined);
  assert.ok(!JSON.stringify(graph).includes('"authorizations"'));
  const changed: ArchitectureProjection = { ...projection.architecture, components: projection.architecture.components.map(component => component.id === "orders" ? { ...component, version: "2.0.0" } : component) };
  const unsupported = mapArchitecture(changed, metadata.architecture, metadata.name);
  assert.equal(unsupported.nodes.find(item => item.id === "orders")!.data.configuration, undefined);
  assert.ok(!unsupported.edges.some(edge => edge.data?.relationship === "publication"));
  assert.ok(!mapArchitecture(projection.architecture, metadata.architecture, "another-lesson@1").edges.some(edge => edge.data?.relationship === "publication"));
});

test("empty and invalid graphs have explicit presentation states", () => {
  assert.deepEqual(mapArchitecture({ components: [], links: [] }), { nodes: [], edges: [], error: null });
  assert.match(mapArchitecture({ components: [], links: [{ source: "a", target: "b" }] }).error!, /missing components/);
  const component = { id: "a", kind: "service", label: "a" } as const;
  assert.match(mapArchitecture({ components: [component, component], links: [] }).error!, /duplicate/);
});
