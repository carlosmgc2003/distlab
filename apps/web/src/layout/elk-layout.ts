import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { ElkEdgeSection, ElkExtendedEdge, ElkLabel, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api.js";

/**
 * Presentation layout for the architecture graph, computed by ELK's layered
 * algorithm. Pure and async: it reads node sizes and link kinds and returns new
 * node positions and edge routes. It never reads or changes simulation state;
 * positions stay UI-owned (application boundary).
 */

/** How two drawn elements are related, which decides the side a link leaves and enters by. */
export type LinkKind = "sync" | "async" | "data";

/** Fixed left-to-right layers. A node's tier comes from its type unless `data.tier` overrides it. */
export const TIERS = { ingress: 0, gateway: 1, service: 2, bus: 3, persistence: 4, external: 5 } as const;

/** Ports per link kind: requests run west to east, events use the north side, data leaves by the south. */
export const LINK_SIDES = {
  sync: { source: "EAST", target: "WEST" },
  async: { source: "NORTH", target: "NORTH" },
  data: { source: "SOUTH", target: "NORTH" },
} as const satisfies Record<LinkKind, { readonly source: PortSide; readonly target: PortSide }>;
export type PortSide = "NORTH" | "EAST" | "SOUTH" | "WEST";

/** The one ELK call this module makes, so tests inject the bundled engine and the browser a worker-backed one. */
export interface ElkEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}

/** An ELK route in canvas coordinates: the start point, the bend points, and the end point. */
export interface EdgeRoute {
  readonly points: readonly XYPosition[];
  /** Center of the edge label ELK reserved space for, when the label was measured. */
  readonly label?: XYPosition;
}

export interface LayoutNodeData {
  readonly [key: string]: unknown;
  /** Presentation override of the derived tier. */
  readonly tier?: number;
  readonly symbol?: unknown;
}

export interface LayoutEdgeData {
  readonly [key: string]: unknown;
  readonly link: LinkKind;
  readonly route?: EdgeRoute;
}

export type LayoutNode = Node<LayoutNodeData, string | undefined>;
export type LayoutEdge = Edge<LayoutEdgeData>;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ElkLayoutOptions {
  readonly engine: ElkEngine;
  /**
   * "layout" (default): event links take part in placement. "route-after":
   * nodes are placed from request and data links only, and a second pass routes
   * the event links without moving any node across another, so a busy topic
   * cannot pull services toward it. The MessageBus is already one node per
   * destination; on the platform fixture "layout" leaves fewer crossings.
   */
  readonly asyncEdges?: "layout" | "route-after";
  /** Measured size of an edge label's text box; labels without a size get no reserved space. */
  readonly measureLabel?: (text: string) => Size | undefined;
  /** Extra root ELK options, applied over `BASE_OPTIONS` (tuning and experiments). */
  readonly layoutOptions?: LayoutOptions;
}

export interface ElkLayoutResult<N extends LayoutNode, E extends LayoutEdge> {
  readonly nodes: N[];
  readonly edges: E[];
}

/** Gap between an owner and the satellite row under it, and between two satellites. */
export const SATELLITE_GAP = 30;
export const SATELLITE_SPACING = 8;
const GROUP_PADDING = "[top=36,left=24,bottom=24,right=24]";

/** Generous spacing: nodes, layers, edge to node, and edge to edge. */
export const BASE_OPTIONS: Readonly<LayoutOptions> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.partitioning.activate": "true",
  "elk.separateConnectedComponents": "false",
  "elk.randomSeed": "1",
  "elk.spacing.nodeNode": "60",
  // Edge labels get layers of their own, which already widen the gap between two node layers.
  "elk.layered.spacing.nodeNodeBetweenLayers": "70",
  "elk.spacing.edgeNode": "30",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.spacing.edgeEdge": "18",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
  "elk.spacing.portPort": "18",
  "elk.spacing.edgeLabel": "6",
  // More crossing-minimization sweeps; the graphs are small, so the extra work is cheap.
  "elk.layered.thoroughness": "100",
};

/**
 * Second pass of "route-after". Each first-pass column becomes a partition and
 * interactive layering keeps nodes in the column their x puts them in, so no
 * node changes sides; semi-interactive crossing minimization keeps each layer's
 * order from `elk.position` while it untangles the event edges. ELK may still
 * split a column into neighboring layers to make room for those edges.
 */
const ROUTE_AFTER_OPTIONS: Readonly<LayoutOptions> = {
  "elk.layered.layering.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.crossingMinimization.semiInteractive": "true",
};

const symbolTiers: Readonly<Record<string, number>> = {
  client: TIERS.ingress, gateway: TIERS.gateway, service: TIERS.service,
  topic: TIERS.bus, queue: TIERS.bus, external: TIERS.external,
};

/** `data.tier` wins; otherwise resources are persistence and components follow their symbol. */
export function tierOf(node: LayoutNode): number {
  const override = node.data.tier;
  if (typeof override === "number" && Number.isInteger(override) && override >= 0) return override;
  if (node.type === "database" || node.type === "kvstore") return TIERS.persistence;
  return typeof node.data.symbol === "string" ? symbolTiers[node.data.symbol] ?? TIERS.service : TIERS.service;
}

/** The measured size React Flow reported; layout never guesses a size. */
export function measuredSize(node: LayoutNode): Size {
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0)) {
    throw new Error(`Node ${node.id} has no measured size yet.`);
  }
  return { width, height };
}

/**
 * Persistence nodes whose only link is the data link from their owner hang in a
 * row under that owner instead of taking a layer of their own, so ownership
 * links stay short and vertical. ELK sees the owner and its row as one block
 * (the owner's cluster), so edges route around the whole block.
 */
function findSatellites<N extends LayoutNode>(nodes: readonly N[], edges: readonly LayoutEdge[], parents: ReadonlySet<string>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const degree = new Map<string, number>();
  for (const edge of edges) for (const end of [edge.source, edge.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const ownerOf = new Map<string, string>();
  const satellites = new Map<string, N[]>();
  for (const edge of edges) {
    const owner = byId.get(edge.source);
    const resource = byId.get(edge.target);
    if (edge.data?.link !== "data" || !owner || !resource || parents.has(resource.id) || parents.has(owner.id)) continue;
    if (tierOf(resource) !== TIERS.persistence || degree.get(resource.id) !== 1 || owner.parentId !== resource.parentId) continue;
    if (ownerOf.has(owner.id)) continue; // A satellite does not own satellites.
    ownerOf.set(resource.id, owner.id);
    satellites.set(owner.id, [...satellites.get(owner.id) ?? [], resource]);
  }
  // Input order decides the row order (databases before key-value stores in the architecture view).
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  for (const row of satellites.values()) row.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { ownerOf, satellites };
}

/**
 * The block ELK places for an owner and its satellite row: as wide as the wider
 * of the two, owner centered on top, row centered under it. Offsets are from
 * the block's top-left corner.
 */
function cluster(owner: Size, row: readonly LayoutNode[]) {
  const sizes = row.map(measuredSize);
  const rowWidth = sizes.reduce((sum, size) => sum + size.width, 0) + SATELLITE_SPACING * Math.max(row.length - 1, 0);
  const rowHeight = Math.max(0, ...sizes.map(size => size.height));
  const width = Math.max(owner.width, rowWidth);
  let x = (width - rowWidth) / 2;
  const satellites = sizes.map(size => {
    const offset = { x, y: owner.height + SATELLITE_GAP };
    x += size.width + SATELLITE_SPACING;
    return offset;
  });
  return { width, height: owner.height + SATELLITE_GAP + rowHeight, owner: { x: (width - owner.width) / 2, y: 0 }, satellites };
}

/** Port order per side of each cluster, as ELK chose it in the first pass. */
type PortPins = ReadonlyMap<string, ReadonlyMap<PortSide, readonly string[]>>;

/**
 * Pin a cluster's ports, in ELK's order, evenly along the owner's part of each
 * side. A free FIXED_SIDE port could otherwise land beside the satellite row.
 */
function pinnedPosition(side: PortSide, index: number, count: number, block: { width: number }, owner: Size, ownerAt: XYPosition): XYPosition {
  const share = (index + 1) / (count + 1);
  switch (side) {
    case "EAST": return { x: block.width, y: ownerAt.y + owner.height * share };
    case "WEST": return { x: 0, y: ownerAt.y + owner.height * share };
    case "NORTH": return { x: ownerAt.x + owner.width * share, y: 0 };
    case "SOUTH": return { x: ownerAt.x + owner.width * share, y: owner.height };
  }
}

interface Port {
  readonly id: string;
  readonly side: PortSide;
}

/** Where an earlier pass put a node: its position and its column (layer) among its siblings. */
interface Placement {
  readonly position: XYPosition;
  readonly column: number;
}

interface Pass {
  readonly included: (edge: LayoutEdge) => boolean;
  /** Placement from an earlier pass: fixes layers and in-layer order, so only routing changes. */
  readonly previous?: ReadonlyMap<string, Placement> | undefined;
  readonly pins?: PortPins | undefined;
}

function buildGraph<N extends LayoutNode>(nodes: readonly N[], edges: readonly LayoutEdge[], options: ElkLayoutOptions, pass: Pass): ElkNode {
  const { included, previous, pins } = pass;
  const parents = new Set(nodes.flatMap(node => node.parentId ? [node.parentId] : []));
  const { ownerOf, satellites } = findSatellites(nodes, edges, parents);
  const ports = new Map<string, Port[]>();
  const elkEdges: ElkExtendedEdge[] = [];
  for (const edge of edges) {
    if (ownerOf.get(edge.target) === edge.source || !included(edge)) continue;
    const link = edge.data?.link ?? "sync";
    const source = { id: `${edge.id}:source`, side: LINK_SIDES[link].source };
    const target = { id: `${edge.id}:target`, side: LINK_SIDES[link].target };
    ports.set(edge.source, [...ports.get(edge.source) ?? [], source]);
    ports.set(edge.target, [...ports.get(edge.target) ?? [], target]);
    const text = typeof edge.label === "string" ? edge.label : undefined;
    const size = text !== undefined ? options.measureLabel?.(text) : undefined;
    const labels: ElkLabel[] = text !== undefined && size
      ? [{ id: `${edge.id}:label`, text, ...size, layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }]
      : [];
    elkEdges.push({ id: edge.id, sources: [source.id], targets: [target.id], ...(labels.length ? { labels } : {}) });
  }
  const childrenOf = new Map<string | undefined, N[]>();
  for (const node of nodes) {
    if (ownerOf.has(node.id)) continue;
    childrenOf.set(node.parentId, [...childrenOf.get(node.parentId) ?? [], node]);
  }
  const toElk = (node: N): ElkNode => {
    const earlier = previous?.get(node.id);
    const partition = earlier ? earlier.column : parents.has(node.id)
      ? Math.min(tierOf(node), ...(childrenOf.get(node.id) ?? []).map(tierOf))
      : tierOf(node);
    const position = earlier ? { x: earlier.position.x, y: earlier.position.y } : {};
    const pinned: LayoutOptions = earlier ? {
      "elk.position": `(${earlier.position.x}, ${earlier.position.y})`,
    } : {};
    if (parents.has(node.id)) {
      return {
        id: node.id, ...position,
        layoutOptions: { ...pinned, "elk.padding": GROUP_PADDING, "elk.partitioning.activate": "true", "elk.partitioning.partition": String(partition) },
        children: (childrenOf.get(node.id) ?? []).map(toElk),
      };
    }
    const size = measuredSize(node);
    const row = satellites.get(node.id);
    const block = row ? cluster(size, row) : { width: size.width, height: size.height, owner: { x: 0, y: 0 } };
    const order = row ? pins?.get(node.id) : undefined;
    const layoutOptions: LayoutOptions = {
      ...pinned,
      "elk.portConstraints": order ? "FIXED_POS" : "FIXED_SIDE",
      "elk.partitioning.partition": String(partition),
    };
    const elkPorts: ElkPort[] = (ports.get(node.id) ?? []).map(port => {
      const sideOrder = order?.get(port.side) ?? [];
      const index = sideOrder.indexOf(port.id);
      const at = order && index >= 0 ? pinnedPosition(port.side, index, sideOrder.length, block, size, block.owner) : undefined;
      return { id: port.id, width: 0, height: 0, ...(at ?? {}), layoutOptions: { "elk.port.side": port.side } };
    });
    return { id: node.id, ...position, width: block.width, height: block.height, ports: elkPorts, layoutOptions };
  };
  const hierarchy = parents.size > 0;
  return {
    id: "root",
    layoutOptions: {
      ...BASE_OPTIONS,
      ...(hierarchy ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
      ...(previous ? ROUTE_AFTER_OPTIONS : {}),
      ...options.layoutOptions,
    },
    children: (childrenOf.get(undefined) ?? []).map(toElk),
    edges: elkEdges,
  };
}

const portSides: readonly string[] = ["NORTH", "EAST", "SOUTH", "WEST"] satisfies PortSide[];
function isPortSide(value: string | undefined): value is PortSide {
  return value !== undefined && portSides.includes(value);
}

/** ELK's port order on each side of every cluster, read from a FIXED_SIDE pass. */
function portOrder(root: ElkNode, clusters: ReadonlySet<string>): PortPins {
  const pins = new Map<string, Map<PortSide, string[]>>();
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      if (clusters.has(child.id)) {
        const sides = new Map<PortSide, { id: string; at: number }[]>();
        for (const port of child.ports ?? []) {
          const side = port.layoutOptions?.["elk.port.side"];
          if (!isPortSide(side)) continue;
          const at = side === "NORTH" || side === "SOUTH" ? port.x ?? 0 : port.y ?? 0;
          sides.set(side, [...sides.get(side) ?? [], { id: port.id, at }]);
        }
        pins.set(child.id, new Map([...sides].map(([side, list]) => [side, list.sort((a, b) => a.at - b.at).map(item => item.id)])));
      }
      visit(child);
    }
  };
  visit(root);
  return pins;
}

/**
 * One layout: a FIXED_SIDE pass lets ELK pick the port order, then, when any
 * owner carries satellites, a second pass pins those clusters' ports to the
 * owner's part of each side, in that order.
 */
async function layoutPass<N extends LayoutNode>(nodes: readonly N[], edges: readonly LayoutEdge[], options: ElkLayoutOptions, pass: Pass): Promise<ElkNode> {
  const free = await options.engine.layout(buildGraph(nodes, edges, options, pass));
  const parents = new Set(nodes.flatMap(node => node.parentId ? [node.parentId] : []));
  const clusters = new Set(findSatellites(nodes, edges, parents).satellites.keys());
  if (clusters.size === 0) return free;
  return options.engine.layout(buildGraph(nodes, edges, options, { ...pass, pins: portOrder(free, clusters) }));
}

/** Every laid-out ELK node by id with its parent-relative and absolute position. */
function placements(root: ElkNode) {
  const relative = new Map<string, XYPosition>();
  const absolute = new Map<string, XYPosition>([["root", { x: 0, y: 0 }]]);
  const sizes = new Map<string, Size>();
  const edges: ElkExtendedEdge[] = [];
  const visit = (node: ElkNode, origin: XYPosition) => {
    edges.push(...node.edges ?? []);
    for (const child of node.children ?? []) {
      const at = { x: child.x ?? 0, y: child.y ?? 0 };
      const abs = { x: origin.x + at.x, y: origin.y + at.y };
      relative.set(child.id, at);
      absolute.set(child.id, abs);
      sizes.set(child.id, { width: child.width ?? 0, height: child.height ?? 0 });
      visit(child, abs);
    }
  };
  visit(root, { x: 0, y: 0 });
  return { relative, absolute, sizes, edges };
}

/** Each node's parent-relative position and its column: the rank of its x among its siblings. */
function columnsOf(root: ElkNode): Map<string, Placement> {
  const result = new Map<string, Placement>();
  const visit = (node: ElkNode) => {
    const children = node.children ?? [];
    const xs = [...new Set(children.map(child => child.x ?? 0))].sort((a, b) => a - b);
    for (const child of children) {
      result.set(child.id, { position: { x: child.x ?? 0, y: child.y ?? 0 }, column: xs.indexOf(child.x ?? 0) });
      visit(child);
    }
  };
  visit(root);
  return result;
}

/**
 * ELK reports a section's points relative to the edge's container (the lowest
 * common ancestor of its ends), not to the canvas. Node positions stay relative
 * to their parent, as React Flow's `parentId` expects; edge points become absolute.
 */
export function absoluteSectionPoints(section: ElkEdgeSection, containerOrigin: XYPosition): XYPosition[] {
  return [section.startPoint, ...section.bendPoints ?? [], section.endPoint]
    .map(point => ({ x: point.x + containerOrigin.x, y: point.y + containerOrigin.y }));
}

/**
 * A cluster wider than its owner puts east and west ports on the block's side,
 * a few pixels out from the owner. The first and last horizontal runs are
 * extended to the owner's own side.
 */
function reachOwner(points: XYPosition[], edge: LayoutEdge | undefined, inset: ReadonlyMap<string, number>): XYPosition[] {
  const result = points.map(point => ({ ...point }));
  const ends: [string | undefined, XYPosition | undefined, XYPosition | undefined][] = [
    [edge?.source, result[0], result[1]], [edge?.target, result.at(-1), result.at(-2)],
  ];
  for (const [owner, end, next] of ends) {
    const dx = owner ? inset.get(owner) ?? 0 : 0;
    if (!end || !next || dx === 0 || Math.abs(end.y - next.y) > 1e-6) continue;
    // Step away from the neighboring point, toward the owner inside the block.
    end.x += next.x < end.x ? dx : -dx;
  }
  return result;
}

/**
 * A data link drops straight from the owner's bottom side, right above its
 * satellite, so two satellites of one owner never share a run.
 */
function satelliteRoute(owner: XYPosition, ownerSize: Size, satellite: XYPosition, satelliteSize: Size): XYPosition[] {
  const end = { x: satellite.x + satelliteSize.width / 2, y: satellite.y };
  const inset = Math.min(8, ownerSize.width / 2);
  const start = { x: Math.min(Math.max(end.x, owner.x + inset), owner.x + ownerSize.width - inset), y: owner.y + ownerSize.height };
  if (Math.abs(start.x - end.x) < 0.5) return [start, { x: start.x, y: end.y }];
  const middle = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

/**
 * Lay out a React Flow graph with ELK. Nodes must carry their measured size
 * (after `useNodesInitialized`). Returns the same nodes with new positions
 * (parent-relative, like `parentId`) and the same edges with `data.route` in
 * canvas coordinates.
 */
export async function elkLayout<N extends LayoutNode, E extends LayoutEdge>(
  nodes: readonly N[], edges: readonly E[], options: ElkLayoutOptions,
): Promise<ElkLayoutResult<N, E>> {
  const routeAfter = options.asyncEdges === "route-after";
  const everything = () => true;
  const laid = routeAfter
    ? await layoutPass(nodes, edges, options, {
      included: everything,
      previous: columnsOf(await layoutPass(nodes, edges, options, { included: edge => edge.data?.link !== "async" })),
    })
    : await layoutPass(nodes, edges, options, { included: everything });
  const { relative, absolute, sizes, edges: laidEdges } = placements(laid);
  const parents = new Set(nodes.flatMap(node => node.parentId ? [node.parentId] : []));
  const { ownerOf, satellites } = findSatellites(nodes, edges, parents);
  const byId = new Map(nodes.map(node => [node.id, node]));
  // ELK placed each cluster as one block: the owner sits on top, its satellites in the row below.
  const inset = new Map<string, number>();
  for (const [ownerId, row] of satellites) {
    const blockAt = relative.get(ownerId);
    const blockAbs = absolute.get(ownerId);
    if (!blockAt || !blockAbs) continue;
    const ownerSize = measuredSize(byId.get(ownerId)!);
    const block = cluster(ownerSize, row);
    const place = (id: string, offset: XYPosition, size: Size) => {
      relative.set(id, { x: blockAt.x + offset.x, y: blockAt.y + offset.y });
      absolute.set(id, { x: blockAbs.x + offset.x, y: blockAbs.y + offset.y });
      sizes.set(id, size);
    };
    inset.set(ownerId, block.owner.x);
    place(ownerId, block.owner, ownerSize);
    row.forEach((satellite, index) => place(satellite.id, block.satellites[index]!, measuredSize(satellite)));
  }
  const laidNodes = nodes.map((node): N => {
    const position = relative.get(node.id);
    if (!position) throw new Error(`ELK returned no position for ${node.id}.`);
    const size = sizes.get(node.id)!;
    return parents.has(node.id) ? { ...node, position, width: size.width, height: size.height } : { ...node, position };
  });
  const routes = new Map<string, EdgeRoute>();
  const edgeById = new Map<string, LayoutEdge>(edges.map(edge => [edge.id, edge]));
  for (const edge of laidEdges) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const origin = absolute.get(edge.container ?? "root") ?? { x: 0, y: 0 };
    const label = edge.labels?.[0];
    routes.set(edge.id, {
      points: reachOwner(absoluteSectionPoints(section, origin), edgeById.get(edge.id), inset),
      ...(label?.x !== undefined && label.y !== undefined
        ? { label: { x: origin.x + label.x + (label.width ?? 0) / 2, y: origin.y + label.y + (label.height ?? 0) / 2 } }
        : {}),
    });
  }
  const laidEdgesOut = edges.map((edge): E => {
    const owner = ownerOf.get(edge.target) === edge.source ? edge.source : undefined;
    const route = owner
      ? { points: satelliteRoute(absolute.get(owner)!, sizes.get(owner)!, absolute.get(edge.target)!, sizes.get(edge.target)!) }
      : routes.get(edge.id);
    if (!route || !edge.data) return edge;
    return { ...edge, data: { ...edge.data, route } };
  });
  return { nodes: laidNodes, edges: laidEdgesOut };
}
