import assert from "node:assert/strict";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import type { WorkerEvent } from "@distlab/contracts";
import type { XYPosition } from "@xyflow/react";
import { Position } from "@xyflow/react";
import { handleFor, mapArchitecture } from "../src/architecture-view.ts";
import type { ArchitectureEdge, ArchitectureNode, OwnershipEdge, ResourceNode } from "../src/architecture-view.ts";
import { absoluteSectionPoints, elkLayout, SATELLITE_GAP, tierOf, TIERS } from "../src/layout/elk-layout.ts";
import type { ElkLayoutOptions, LayoutEdge, LayoutNode } from "../src/layout/elk-layout.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { GATEWAY_ID, platformMetadata, platformProjection } from "./fixtures/platform-architecture.ts";
import { metrics, nodeIntrusions, overlappingPairs, sharedRuns, smoothStepRoute } from "./layout-geometry.ts";
import type { Box, Route } from "./layout-geometry.ts";

const engine = new ELK();
/** Stand-in for the browser's text measurement: same font metrics every run. */
const measureLabel = (text: string) => ({ width: text.length * 7 + 14, height: 26 });
const options: ElkLayoutOptions = { engine, measureLabel };
const COMPONENT = { width: 215, height: 90 };
const RESOURCE = { width: 115, height: 56 };
/** Crossings ELK leaves in the platform fixture with the default options. */
const CROSSING_BUDGET = 1;

type AnyNode = ArchitectureNode | ResourceNode;
type AnyEdge = ArchitectureEdge | OwnershipEdge;

/** What `useNodesInitialized` guarantees in the browser: every node carries a measured size. */
function measured<N extends AnyNode>(node: N, size = node.type === "component" ? COMPONENT : RESOURCE): N {
  return { ...node, measured: size };
}

function graphOf(projection = platformProjection, metadata = platformMetadata, name?: string) {
  const graph = mapArchitecture(projection, metadata, name);
  assert.equal(graph.error, null);
  const nodes: AnyNode[] = [...graph.nodes, ...graph.resourceNodes].map(node => measured(node));
  const edges: AnyEdge[] = [...graph.edges, ...graph.resourceEdges];
  return { graph, nodes, edges };
}

function platformGraph() {
  const { nodes, edges } = graphOf();
  return {
    nodes: nodes.map(node => node.id === GATEWAY_ID && node.type === "component" ? { ...node, data: { ...node.data, tier: TIERS.gateway } } : node),
    edges,
  };
}

/** Absolute boxes, following `parentId` the way React Flow does. */
function boxes(nodes: readonly LayoutNode[]): Box[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const absolute = (node: LayoutNode): XYPosition => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent) return node.position;
    const origin = absolute(parent);
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  return nodes.filter(node => !nodes.some(other => other.parentId === node.id)).map(node => {
    const at = absolute(node);
    return { id: node.id, x: at.x, y: at.y, width: node.measured?.width ?? 0, height: node.measured?.height ?? 0 };
  });
}

function routes(edges: readonly LayoutEdge[]): Route[] {
  return edges.map(edge => {
    assert.ok(edge.data?.route, `edge ${edge.id} has an ELK route`);
    return { id: edge.id, source: edge.source, target: edge.target, points: edge.data.route.points };
  });
}

/** The pre-ELK picture: mapArchitecture's fixed placement plus React Flow's smooth-step paths between the old handles. */
function beforeMetrics(nodes: readonly AnyNode[], edges: readonly AnyEdge[]) {
  const all = boxes(nodes);
  const byId = new Map(all.map(box => [box.id, box]));
  const sides = (edge: AnyEdge): [Position, Position] => {
    if (edge.data && "relationship" in edge.data && edge.data.relationship === "subscription") return [Position.Bottom, Position.Top];
    if (edge.data && "resource" in edge.data) return [Position.Bottom, Position.Top];
    return [Position.Right, Position.Left];
  };
  const drawn = edges.map(edge => {
    const [from, to] = sides(edge);
    return smoothStepRoute(edge.id, byId.get(edge.source)!, from, byId.get(edge.target)!, to);
  });
  return metrics(all, drawn);
}

/** Route ends that do not touch the border of their own node (arrowheads must land on the node). */
function detachedEnds(edges: readonly LayoutEdge[], all: readonly Box[]): string[] {
  const byId = new Map(all.map(box => [box.id, box]));
  const onBorder = (point: XYPosition, box: Box) => {
    const inX = point.x >= box.x - 1.5 && point.x <= box.x + box.width + 1.5;
    const inY = point.y >= box.y - 1.5 && point.y <= box.y + box.height + 1.5;
    const nearX = Math.abs(point.x - box.x) <= 1.5 || Math.abs(point.x - box.x - box.width) <= 1.5;
    const nearY = Math.abs(point.y - box.y) <= 1.5 || Math.abs(point.y - box.y - box.height) <= 1.5;
    return (inX && nearY) || (inY && nearX);
  };
  return edges.flatMap(edge => {
    const points = edge.data!.route!.points;
    return [
      ...onBorder(points[0]!, byId.get(edge.source)!) ? [] : [`${edge.id} start`],
      ...onBorder(points.at(-1)!, byId.get(edge.target)!) ? [] : [`${edge.id} end`],
    ];
  });
}

async function loadPackaged(index: number) {
  const events: WorkerEvent[] = [];
  await new WorkerAdapter(event => events.push(event)).receive({ version: 1, requestId: "layout", type: "load", scenario: scenarios[index]!.scenario });
  const loaded = events.find(event => event.type === "loaded");
  assert.ok(loaded?.type === "loaded");
  return loaded.projection;
}

test("a fixed graph lays out with no overlapping nodes and no edge through a foreign node", async () => {
  const { nodes, edges } = graphOf({
    components: [
      { id: "app", kind: "client", label: "App" }, { id: "api", kind: "service", label: "API" },
      { id: "billing", kind: "service", label: "Billing" }, { id: "bank", kind: "external", label: "Bank" },
      { id: "Billed", kind: "infrastructure", label: "Billed" }, { id: "mailer", kind: "service", label: "Mailer" },
    ],
    links: [
      { source: "app", target: "api" }, { source: "api", target: "billing" }, { source: "billing", target: "bank" },
      { source: "api", target: "bank" }, { source: "billing", target: "Billed", label: "publication" },
      { source: "Billed", target: "mailer", label: "subscription" },
    ],
  }, undefined);
  const laid = await elkLayout(nodes, edges, options);
  const all = boxes(laid.nodes);
  assert.deepEqual(overlappingPairs(all), []);
  assert.deepEqual(nodeIntrusions(routes(laid.edges), all), []);
});

test("the platform fixture: before/after overlaps, crossings, and edges through nodes", async () => {
  const { nodes, edges } = platformGraph();
  assert.equal(nodes.filter(node => node.type === "component" && node.data.symbol === "service").length, 9, "gateway plus eight services");
  assert.equal(nodes.filter(node => node.type === "database").length, 5);
  assert.equal(nodes.filter(node => node.type === "component" && (node.data.symbol === "topic" || node.data.symbol === "queue")).length, 4);
  assert.equal(nodes.filter(node => node.type === "component" && node.data.symbol === "external").length, 2);
  const before = beforeMetrics(nodes, edges);
  const laid = await elkLayout(nodes, edges, options);
  const after = metrics(boxes(laid.nodes), routes(laid.edges));
  console.log(`layout metrics (platform fixture, ${nodes.length} nodes, ${edges.length} edges)`);
  console.log(`  before: overlaps=${before.overlaps} crossings=${before.crossings} edges-through-nodes=${before.intrusions} edges-drawn-over-each-other=${before.sharedRuns}`);
  console.log(`  after:  overlaps=${after.overlaps} crossings=${after.crossings} edges-through-nodes=${after.intrusions} edges-drawn-over-each-other=${after.sharedRuns}`);
  assert.equal(after.overlaps, 0);
  assert.equal(after.intrusions, 0);
  assert.equal(after.sharedRuns, 0);
  // Bus links run west to east through their destination, like requests, so ELK untangles them with
  // the rest of the flow. The budget guards against regressions; the old layout hid most of its
  // tangle as edges drawn over each other.
  assert.ok(after.crossings <= CROSSING_BUDGET, `crossings ${after.crossings} exceed the budget ${CROSSING_BUDGET}`);
  assert.ok(after.crossings + after.intrusions + after.sharedRuns < before.crossings + before.intrusions + before.sharedRuns);
});

test("every packaged lesson lays out without overlaps or edges through foreign nodes", async () => {
  for (const [index, choice] of scenarios.entries()) {
    const projection = await loadPackaged(index);
    const metadata = packagedMetadata(choice);
    const { nodes, edges } = graphOf(projection.architecture, metadata.architecture, metadata.name);
    for (const asyncEdges of ["layout", "route-after"] as const) {
      const laid = await elkLayout(nodes, edges, { ...options, asyncEdges });
      const all = boxes(laid.nodes);
      assert.deepEqual(overlappingPairs(all), [], `${metadata.name} ${asyncEdges}`);
      assert.deepEqual(nodeIntrusions(routes(laid.edges), all), [], `${metadata.name} ${asyncEdges}`);
      assert.deepEqual(detachedEnds(laid.edges, all), [], `${metadata.name} ${asyncEdges}`);
      assert.equal(sharedRuns(routes(laid.edges)), 0, `${metadata.name} ${asyncEdges}: no two edges drawn over each other`);
    }
  }
});

test("layout reads measured sizes and refuses an unmeasured node", async () => {
  const { nodes, edges } = platformGraph();
  const tall = nodes.map(node => node.id === "orders" ? measured(node, { width: 215, height: 180 }) : node);
  const laid = await elkLayout(tall, edges, options);
  const all = boxes(laid.nodes);
  assert.equal(all.find(box => box.id === "orders")!.height, 180);
  assert.deepEqual(overlappingPairs(all), []);
  assert.deepEqual(nodeIntrusions(routes(laid.edges), all), []);
  const unmeasured = nodes.map(node => {
    if (node.id !== "orders") return node;
    const { measured: _size, ...rest } = node;
    return rest;
  });
  await assert.rejects(elkLayout(unmeasured, edges, options), /orders has no measured size/);
});

test("tiers fix the columns: ingress, gateway, services with their bus destinations, external", async () => {
  const { nodes, edges } = platformGraph();
  const laid = await elkLayout(nodes, edges, options);
  const columns = new Map<number, { min: number; max: number }>();
  for (const node of laid.nodes) {
    if (node.type !== "component") continue;
    const tier = tierOf(node);
    const span = columns.get(tier) ?? { min: Infinity, max: -Infinity };
    columns.set(tier, { min: Math.min(span.min, node.position.x), max: Math.max(span.max, node.position.x + 215) });
  }
  // A destination shares the service band, so it can sit between its publishers and subscribers.
  assert.equal(TIERS.bus, TIERS.service);
  const order = [TIERS.ingress, TIERS.gateway, TIERS.service, TIERS.external];
  for (let i = 1; i < order.length; i++) {
    assert.ok(columns.get(order[i - 1]!)!.max <= columns.get(order[i]!)!.min, `tier ${order[i - 1]} ends before tier ${order[i]} starts`);
  }
  assert.equal(tierOf(nodes.find(node => node.id === "web")!), TIERS.ingress);
  assert.equal(tierOf(nodes.find(node => node.id === "resource:db:orders")!), TIERS.persistence);
});

test("ports sit on the fixed side per link kind and match the React Flow handles", async () => {
  const { nodes, edges } = platformGraph();
  const laid = await elkLayout(nodes, edges, options);
  const byId = new Map(boxes(laid.nodes).map(box => [box.id, box]));
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  for (const edge of laid.edges) {
    const points = edge.data!.route!.points;
    const start = points[0]!, end = points.at(-1)!;
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    if (edge.data!.link === "sync") {
      assert.ok(near(start.x, source.x + source.width) && near(end.x, target.x), `${edge.id} leaves east, enters west`);
      assert.equal(edge.sourceHandle, "east"); assert.equal(edge.targetHandle, "west");
    } else if (edge.data!.link === "async") {
      assert.ok(near(start.x, source.x + source.width) && near(end.x, target.x), `${edge.id} leaves its source's east side, enters its target's west side`);
      assert.equal(edge.sourceHandle, "east"); assert.equal(edge.targetHandle, "west");
    } else {
      assert.ok(near(start.y, source.y + source.height) && near(end.y, target.y), `${edge.id} leaves south, enters north`);
      assert.equal(edge.sourceHandle, handleFor.ownership.source); assert.equal(edge.targetHandle, handleFor.ownership.target);
    }
  }
});

/** Bus links whose route does not run from the west to the east: the source must end left of the target. */
function backwardBusLinks(edges: readonly LayoutEdge[], all: readonly Box[]): string[] {
  const byId = new Map(all.map(box => [box.id, box]));
  return edges.flatMap(edge => {
    if (edge.data?.link !== "async") return [];
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    return source.x + source.width <= target.x ? [] : [edge.id];
  });
}

test("a message reads left to right: publisher, then its destination, then the subscriber", async () => {
  const platform = platformGraph();
  const laid = await elkLayout(platform.nodes, platform.edges, options);
  assert.deepEqual(backwardBusLinks(laid.edges, boxes(laid.nodes)), [], "platform fixture");
  for (const [index, choice] of scenarios.entries()) {
    const projection = await loadPackaged(index);
    const metadata = packagedMetadata(choice);
    const { nodes, edges } = graphOf(projection.architecture, metadata.architecture, metadata.name);
    const lesson = await elkLayout(nodes, edges, options);
    assert.deepEqual(backwardBusLinks(lesson.edges, boxes(lesson.nodes)), [], metadata.name);
  }
});

test("each database hangs right under its owner with a short vertical data link", async () => {
  const { nodes, edges } = platformGraph();
  const laid = await elkLayout(nodes, edges, options);
  const byId = new Map(boxes(laid.nodes).map(box => [box.id, box]));
  for (const node of laid.nodes) {
    if (node.type !== "database") continue;
    const db = byId.get(node.id)!, owner = byId.get(node.data.owner)!;
    assert.equal(db.y, owner.y + owner.height + SATELLITE_GAP, node.id);
    assert.equal(db.x + db.width / 2, owner.x + owner.width / 2, node.id);
    const route = laid.edges.find(edge => edge.target === node.id)!.data!.route!.points;
    assert.equal(route.length, 2);
    assert.equal(route[0]!.x, route[1]!.x);
  }
});

test("with groups, child positions stay parent-relative and edge points become absolute", async () => {
  const leaf = (id: string, symbol: string, parentId?: string): LayoutNode => ({
    id, type: "component", position: { x: 0, y: 0 }, data: { symbol }, measured: COMPONENT, ...(parentId ? { parentId } : {}),
  });
  const nodes: LayoutNode[] = [
    { id: "zone", type: "group", position: { x: 0, y: 0 }, data: {} },
    leaf("app", "client"), leaf("api", "service", "zone"), leaf("worker", "service", "zone"), leaf("bank", "external"),
  ];
  const edge = (id: string, source: string, target: string): LayoutEdge => ({ id, source, target, data: { link: "sync" } });
  const edges = [edge("a", "app", "api"), edge("b", "api", "worker"), edge("c", "worker", "bank")];
  const laid = await elkLayout(nodes, edges, options);
  const zone = laid.nodes.find(node => node.id === "zone")!;
  assert.ok(zone.width! > 0 && zone.height! > 0, "the group gets ELK's size");
  const byId = new Map(boxes(laid.nodes).map(box => [box.id, box]));
  const zoneBox = { x: zone.position.x, y: zone.position.y, width: zone.width!, height: zone.height! };
  for (const id of ["api", "worker"]) {
    const child = byId.get(id)!;
    assert.ok(child.x >= zoneBox.x && child.x + child.width <= zoneBox.x + zoneBox.width, `${id} inside the group`);
  }
  // Edge "b" lives inside the group: ELK reports it relative to the group, the route is absolute.
  for (const laidEdge of laid.edges) {
    const points = laidEdge.data!.route!.points;
    const source = byId.get(laidEdge.source)!, target = byId.get(laidEdge.target)!;
    assert.ok(Math.abs(points[0]!.x - (source.x + source.width)) <= 1.5, `${laidEdge.id} starts on its source`);
    assert.ok(Math.abs(points.at(-1)!.x - target.x) <= 1.5, `${laidEdge.id} ends on its target`);
  }
  assert.deepEqual(absoluteSectionPoints({ id: "s", startPoint: { x: 1, y: 2 }, bendPoints: [{ x: 3, y: 4 }], endPoint: { x: 5, y: 6 } }, { x: 10, y: 20 }),
    [{ x: 11, y: 22 }, { x: 13, y: 24 }, { x: 15, y: 26 }]);
});

test("layout is deterministic and leaves its inputs untouched", async () => {
  const { nodes, edges } = platformGraph();
  const before = JSON.stringify({ nodes, edges });
  const first = await elkLayout(nodes, edges, options);
  const second = await elkLayout(nodes, edges, options);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ nodes, edges }), before);
});

/**
 * Pairs of component nodes whose left-to-right order differs between two
 * layouts: one strictly left of the other in `reference` but strictly right of
 * it in `laid`, or two nodes of one reference column whose vertical order flips.
 */
function orderChanges(reference: readonly LayoutNode[], laid: readonly LayoutNode[]): string[] {
  const at = new Map(laid.map(node => [node.id, node.position]));
  const components = reference.filter(node => node.type === "component");
  const changes: string[] = [];
  for (const a of components) {
    for (const b of components) {
      if (a.id >= b.id) continue;
      const [ra, rb, la, lb] = [a.position, b.position, at.get(a.id)!, at.get(b.id)!];
      if ((ra.x < rb.x && la.x > lb.x) || (ra.x > rb.x && la.x < lb.x)) changes.push(`${a.id}|${b.id} swap columns`);
      if (ra.x === rb.x && la.x === lb.x && Math.sign(ra.y - rb.y) !== Math.sign(la.y - lb.y)) changes.push(`${a.id}|${b.id} swap rows`);
    }
  }
  return changes;
}

test("the MessageBus is already split: one node per topic or queue, each bus link ends on its own destination", () => {
  const { nodes, edges } = platformGraph();
  const destinations = nodes.filter(node => node.type === "component" && (node.data.symbol === "topic" || node.data.symbol === "queue")).map(node => node.id).sort();
  assert.deepEqual(destinations, ["OrderPlaced", "PaymentCaptured", "StockReserved", "UserRegistered"]);
  for (const edge of edges) {
    if (edge.data?.link !== "async") continue;
    assert.ok(destinations.includes(edge.source) !== destinations.includes(edge.target), `${edge.id} joins a service and one destination`);
  }
});

test("route-after places nodes from request and data links only, then routes the bus links", async () => {
  const { nodes, edges } = platformGraph();
  const withoutBus = await elkLayout(nodes, edges.filter(edge => edge.data?.link !== "async"), options);
  const routeAfter = await elkLayout(nodes, edges, { ...options, asyncEdges: "route-after" });
  // The placement a layout without bus links chose survives: no node changes sides, and nodes that
  // share a layer keep their vertical order. ELK may still split a column into neighboring layers
  // to make room for the bus links it routes in the second pass.
  assert.deepEqual(orderChanges(withoutBus.nodes, routeAfter.nodes), []);
  const all = boxes(routeAfter.nodes);
  assert.deepEqual(overlappingPairs(all), []);
  assert.deepEqual(nodeIntrusions(routes(routeAfter.edges), all), []);
  const inLayout = await elkLayout(nodes, edges, options);
  const compare = (name: string, laid: typeof inLayout) => {
    const result = metrics(boxes(laid.nodes), routes(laid.edges));
    console.log(`  ${name}: overlaps=${result.overlaps} crossings=${result.crossings} edges-through-nodes=${result.intrusions} edges-drawn-over-each-other=${result.sharedRuns}`);
    return result;
  };
  console.log("async edge strategies (platform fixture)");
  compare("layout     ", inLayout);
  const after = compare("route-after", routeAfter);
  assert.equal(after.sharedRuns, 0);
});
