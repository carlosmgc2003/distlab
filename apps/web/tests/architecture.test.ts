import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureDefinition, ArchitectureProjection, ComponentNodeProjection, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import { deriveSymbol, mapArchitecture, movementEdges, symbolLabels } from "../src/architecture-view.ts";
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

function component(id: string, kind: ComponentNodeProjection["kind"]): ComponentNodeProjection {
  return { id, kind, label: id };
}

test("maps both checkout projections, all categories, requests and bus relationships without mutating inputs", async () => {
  for (const [index, choice] of scenarios.entries()) {
    if (choice.family !== "checkout") continue; // Commerce layouts are covered by commerce-worker.test.ts.
    const projection = await load(index);
    const metadata = packagedMetadata(choice);
    const before = JSON.stringify({ projection, metadata });
    const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name);
    assert.equal(graph.error, null);
    assert.equal(graph.nodes.length, 5);
    assert.equal(graph.resourceNodes.length, 2);
    assert.equal(graph.resourceEdges.length, 2);
    assert.deepEqual(graph.nodes.map(node => node.data.component.kind).sort(), ["client", "external", "infrastructure", "service", "service"]);
    assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target, edge.data?.relationship]), [
      ["customer-app", "orders", "request"], ["payments", "payment-processor", "request"],
      ["OrderCreated", "payments", "subscription"], ["orders", "OrderCreated", "publication"],
    ]);
    assert.equal(new Set(graph.edges.map(edge => edge.style?.strokeDasharray ?? "solid")).size, 3);
    const markers = Object.fromEntries(graph.edges.map(edge => [edge.data?.relationship, edge.markerEnd]));
    assert.equal(markers.request?.type, "arrowclosed");
    assert.equal(markers.subscription?.type, "arrow");
    assert.equal(markers.publication?.type, "arrowclosed");
    assert.notDeepEqual(markers.request, markers.publication);
    assert.notDeepEqual(markers.request, markers.subscription);
    assert.notDeepEqual(markers.publication, markers.subscription);
    for (const node of graph.nodes) {
      assert.equal(node.draggable, false); assert.equal(node.connectable, false); assert.equal(node.deletable, false);
      assert.ok(node.ariaLabel?.includes(node.data.title));
      assert.equal(node.data.symbol, deriveSymbol(node.data.component, metadata.architecture.destinations.find(d => d.id === node.id)));
      assert.ok(node.className?.includes(`symbol-${node.data.symbol}`));
      assert.ok(node.ariaLabel?.includes(symbolLabels[node.data.symbol]));
    }
    assert.equal(JSON.stringify({ projection, metadata }), before);
    assert.ok(Object.isFrozen(metadata.architecture.components[0]?.configuration));
  }
});

test("deriveSymbol chooses shape by kind and infrastructure subkind", () => {
  assert.equal(deriveSymbol(component("c", "client")), "client");
  assert.equal(deriveSymbol(component("s", "service")), "service");
  assert.equal(deriveSymbol(component("e", "external")), "external");
  assert.equal(deriveSymbol(component("t", "infrastructure"), { id: "t", kind: "topic", deliveryDelay: duration(0), ackTimeout: duration(0), retryDelay: duration(0), maxAttempts: 0, capacity: 0 }), "topic");
  assert.equal(deriveSymbol(component("q", "infrastructure"), { id: "q", kind: "queue", deliveryDelay: duration(0), ackTimeout: duration(0), retryDelay: duration(0), maxAttempts: 0, capacity: 0 }), "queue");
  assert.equal(deriveSymbol(component("fallback", "infrastructure")), "topic");
});

test("infrastructure nodes extend aria labels with topic or queue", () => {
  const projection: ArchitectureProjection = { components: [component("t", "infrastructure"), component("q", "infrastructure")], links: [] };
  const metadata: ArchitectureDefinition = {
    components: [], links: [], databases: [], stores: [], subscriptions: [],
    destinations: [
      { id: "t", kind: "topic", deliveryDelay: duration(0), ackTimeout: duration(0), retryDelay: duration(0), maxAttempts: 3, capacity: 100 },
      { id: "q", kind: "queue", deliveryDelay: duration(0), ackTimeout: duration(0), retryDelay: duration(0), maxAttempts: 3, capacity: 100 },
    ],
  };
  const graph = mapArchitecture(projection, metadata);
  assert.equal(graph.error, null);
  assert.ok(graph.nodes.find(node => node.id === "t")!.ariaLabel!.includes("Message bus topic"));
  assert.ok(graph.nodes.find(node => node.id === "q")!.ariaLabel!.includes("Message bus queue"));
});

test("mapArchitecture never mutates its inputs", async () => {
  const projection = await load();
  const metadata = packagedMetadata(scenarios[0]);
  const beforeProjection = JSON.stringify(projection.architecture);
  const beforeMetadata = JSON.stringify(metadata.architecture);
  const beforeComponents = [...projection.architecture.components];
  mapArchitecture(projection.architecture, metadata.architecture, metadata.name);
  assert.equal(JSON.stringify(projection.architecture), beforeProjection);
  assert.equal(JSON.stringify(metadata.architecture), beforeMetadata);
  assert.deepEqual(projection.architecture.components, beforeComponents);
  assert.ok(Object.isFrozen(metadata.architecture.components[0]?.configuration));
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
  const destination = metadata.architecture.destinations.find(item => item.id === "OrderCreated");
  assert.ok(destination);
  assert.deepEqual(node("OrderCreated").data.configuration, {
    deliveryDelay: destination.deliveryDelay,
    ackTimeout: destination.ackTimeout,
    retryDelay: destination.retryDelay,
    maxAttempts: destination.maxAttempts,
    capacity: destination.capacity,
  });
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
  assert.deepEqual(mapArchitecture({ components: [], links: [] }), { nodes: [], edges: [], resourceNodes: [], resourceEdges: [], error: null });
  const missing = mapArchitecture({ components: [], links: [{ source: "a", target: "b" }] });
  assert.match(missing.error!, /missing components/);
  assert.deepEqual([missing.nodes, missing.edges, missing.resourceNodes, missing.resourceEdges], [[], [], [], []]);
  const component = { id: "a", kind: "service", label: "a" } as const;
  const duplicate = mapArchitecture({ components: [component, component], links: [] });
  assert.match(duplicate.error!, /duplicate/);
  assert.deepEqual([duplicate.nodes, duplicate.edges, duplicate.resourceNodes, duplicate.resourceEdges], [[], [], [], []]);
});

test("emits packaged owned resources as presentation-only satellite nodes and ownership edges", async () => {
  const expected: Record<string, [number, number]> = {
    normal: [2, 2], "response-lost": [2, 2], "retry-unsafe": [1, 1], "retry-idempotent": [1, 1],
    "saga-uncompensated": [3, 3], "saga-compensated": [3, 3], "dual-write": [2, 2], "outbox-unsafe-consumer": [2, 2], "outbox-idempotent": [2, 2],
    "cqrs-delayed": [2, 2], "cascade-unprotected": [3, 3], "cascade-breaker": [3, 3],
  };
  for (const [index, choice] of scenarios.entries()) {
    const projection = await load(index);
    const metadata = packagedMetadata(choice).architecture;
    const graph = mapArchitecture(projection.architecture, metadata, choice.id);
    const [nodeCount, edgeCount] = expected[choice.id]!;
    assert.equal(graph.resourceNodes.length, nodeCount, choice.id);
    assert.equal(graph.resourceEdges.length, edgeCount, choice.id);
    assert.ok(!projection.architecture.components.some(component => component.id.startsWith("resource:")), choice.id);
    assert.ok(!metadata.components.some(component => component.id.startsWith("resource:")), choice.id);
    assert.deepEqual(graph.resourceNodes.map(node => node.id).sort(), [
      ...metadata.databases.map(database => `resource:db:${database.owner}`),
      ...metadata.stores.map(store => `resource:kv:${store.owner}`),
    ].sort(), choice.id);
    assert.equal(graph.resourceNodes.some(node => node.id.startsWith("resource:") && node.id.includes(":undefined")), false);
    for (const edge of graph.resourceEdges) {
      assert.equal(edge.source, edge.data!.owner);
      assert.equal(edge.target, `resource:${edge.data!.resource === "database" ? "db" : "kv"}:${edge.data!.owner}`);
      assert.equal(edge.id, `ownership:${edge.data!.owner}:${edge.target}`);
      assert.equal(edge.sourceHandle, "bottom"); assert.equal(edge.targetHandle, "top");
      assert.equal(edge.style?.strokeWidth, 1); assert.equal(edge.markerEnd, undefined);
      assert.equal(edge.selectable, false); assert.equal(edge.focusable, false); assert.equal(edge.deletable, false);
    }
    for (const node of graph.resourceNodes) {
      assert.equal(node.draggable, false); assert.equal(node.connectable, false); assert.equal(node.deletable, false);
      assert.equal(node.selectable, true); assert.equal(node.focusable, true); assert.equal(node.ariaRole, "button");
      assert.equal(node.ariaLabel, `${node.data.kind === "database" ? "Database" : "KeyValueStore"} owned by ${node.data.owner}`);
      assert.equal(node.className, `resource-node resource-${node.data.kind} nopan`);
      assert.deepEqual(node.handles, [{ id: "top", type: "target", position: "top", x: 57.5, y: 0 }]);
      assert.equal("role" in node.data, false);
      assert.equal("roleLabel" in node.data, false);
      assert.equal("flight" in node.data, false);
    }
    assert.equal(graph.nodes.some(node => node.id.startsWith("resource:")), false);
    assert.equal(graph.edges.some(edge => edge.id.startsWith("ownership:")), false);
    assert.equal(movementEdges(graph.edges).some(edge => edge.id.startsWith("ownership:")), false);
    assert.ok(movementEdges(graph.edges).every(edge => ["request", "subscription", "publication"].includes(edge.relationship)));
    assert.ok(!Object.keys(Object.fromEntries(graph.nodes.map(node => [node.id, node.data.title]))).some(id => id.startsWith("resource:")));
    assert.ok(graph.resourceNodes.every(node => !graph.nodes.some(component => component.id === node.id)));
    assert.ok(!projection.architecture.components.some(component => component.id.startsWith("resource:")));
  }
});

test("resource grouping is last-wins, stable, owner-gated, and placed in the reserved sub-row", async () => {
  const choice = scenarios[0];
  const { architecture } = await load(0);
  const source = packagedMetadata(choice).architecture;
  const original = source.databases.find(database => database.owner === "orders")!;
  const last = { ...original, tables: [...original.tables, { name: "last", unique: [], checks: [] }] };
  const storeDefinition = packagedMetadata(scenarios.find(item => item.id === "cascade-breaker")!).architecture.stores[0]!;
  const store = { ...storeDefinition, owner: "orders" };
  const fixture: ArchitectureDefinition = { ...source, databases: [original, last], stores: [store] };
  const first = mapArchitecture(architecture, fixture);
  assert.equal(first.resourceNodes.filter(node => node.data.owner === "orders" && node.data.kind === "database").length, 1);
  const db = first.resourceNodes.find(node => node.data.owner === "orders" && node.data.kind === "database")!;
  const kv = first.resourceNodes.find(node => node.data.owner === "orders" && node.data.kind === "kvstore")!;
  assert.equal(db.data.definition, last);
  assert.deepEqual(db.position, { x: 360, y: 120 });
  assert.deepEqual(kv.position, { x: 483, y: 120 });
  const ordinary = mapArchitecture(architecture, source);
  const reversed = mapArchitecture({ ...architecture, components: [...architecture.components].reverse() }, {
    ...source, databases: [...source.databases].reverse(), stores: [...source.stores].reverse(),
  });
  assert.deepEqual(ordinary, reversed);
  const detachedFixture = detached({ architecture, metadata: source });
  assert.deepEqual(mapArchitecture(detachedFixture.architecture, detachedFixture.metadata), ordinary);
  const withoutMetadata = mapArchitecture(architecture);
  assert.equal(withoutMetadata.nodes.length, architecture.components.length);
  assert.deepEqual(withoutMetadata.resourceNodes, []);
  assert.deepEqual(withoutMetadata.resourceEdges, []);
  assert.ok(scenarios.every((item, index) => {
    const meta = packagedMetadata(item).architecture;
    const owners = new Set(meta.databases.map(value => value.owner));
    return meta.stores.every(value => !owners.has(value.owner));
  }));

  const mismatch = { ...architecture, components: architecture.components.map(item => item.id === "orders" ? { ...item, version: "2.0.0" } : item) };
  const gated = mapArchitecture(mismatch, source);
  assert.equal(gated.resourceNodes.some(node => node.id === "resource:db:orders"), false);
  const dangling = mapArchitecture(architecture, { ...source, databases: [...source.databases, { ...original, owner: "absent" }] });
  assert.equal(dangling.resourceNodes.some(node => node.id === "resource:db:absent"), false);
  assert.equal(dangling.error, null);
  assert.deepEqual(mapArchitecture(architecture).resourceNodes, []);
  assert.deepEqual(mapArchitecture(architecture).resourceEdges, []);
});

test("resource placement matches checkout and commerce layout cells, and inputs remain unchanged", async () => {
  const checkout = mapArchitecture((await load(0)).architecture, packagedMetadata(scenarios[0]).architecture, scenarios[0].id);
  assert.deepEqual(checkout.resourceNodes.map(node => [node.id, node.position]), [
    ["resource:db:orders", { x: 360, y: 120 }], ["resource:db:payments", { x: 360, y: 540 }],
  ]);
  for (const [id, owner, expectedPosition] of [
    ["saga-compensated", "inventory", { x: 670, y: 330 }],
    ["cqrs-delayed", "reporting", { x: 360, y: 330 }],
    ["cascade-breaker", "payments", { x: 980, y: 120 }],
  ] as const) {
    const choice = scenarios.find(item => item.id === id)!;
    const graph = mapArchitecture((await load(scenarios.indexOf(choice))).architecture, packagedMetadata(choice).architecture, id);
    assert.deepEqual(graph.resourceNodes.find(node => node.data.owner === owner)!.position, expectedPosition);
  }
  const projection = await load(0);
  const metadata = packagedMetadata(scenarios[0]);
  const before = JSON.stringify({ projection, metadata });
  const graph = mapArchitecture(projection.architecture, metadata.architecture, scenarios[0].id);
  assert.equal(JSON.stringify({ projection, metadata }), before);
  assert.ok(Object.isFrozen(graph.resourceNodes[0]!.data.definition));
  assert.ok(!before.includes('"resource:'));
});
