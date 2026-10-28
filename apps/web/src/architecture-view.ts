import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, ComponentNodeProjection, DatabaseDefinition, KeyValueDefinition, ComponentId } from "@distlab/contracts";
import { MarkerType, Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import { checkoutDisplay } from "./checkout-display.ts";
import { flightStop } from "./flight.ts";
import type { FlightPace, FlightStep } from "./flight.ts";
import type { MovementEdge } from "./records.ts";

export const categoryLabels = {
  client: "Client",
  service: "Internal service",
  external: "External service",
  infrastructure: "Infrastructure",
} as const satisfies Record<ComponentNodeProjection["kind"], string>;

/** Derived presentation symbol: one shape plus glyph per value. */
export type NodeSymbol = "client" | "service" | "external" | "topic" | "queue";

export const symbolLabels: Record<NodeSymbol, string> = {
  client: "Client",
  service: "Internal service",
  external: "External service",
  topic: "Message bus topic",
  queue: "Message bus queue",
};

export type ArchitectureNode = Node<{
  component: ComponentNodeProjection;
  symbol: NodeSymbol;
  title: string;
  configuration: CanonicalValue | undefined;
  resources: readonly string[];
  /** Set while a recorded movement is painted on the graph. */
  role?: "sending" | "receiving";
  roleLabel?: string;
}, "component">;
export type ArchitectureEdge = Edge<{
  relationship: "request" | "subscription" | "publication";
  /** The recorded movement currently painted on this link, if any. */
  flight?: FlightStep;
  /** The chosen playback pace, so the token paints over the same interval the cursor waits. */
  pace?: FlightPace;
}>;

export type ResourceKind = "database" | "kvstore";

export const resourceLabels = {
  database: "Database",
  kvstore: "KeyValueStore",
} as const satisfies Record<ResourceKind, string>;

export interface ResourceNodeData {
  readonly [key: string]: unknown;
  readonly kind: ResourceKind;
  readonly owner: ComponentId;
  /** Verbatim packaged definition, copied by reference and never mutated. */
  readonly definition: DatabaseDefinition | KeyValueDefinition;
}

export type ResourceNode = Node<ResourceNodeData, ResourceKind>;

export interface OwnershipEdgeData {
  readonly [key: string]: unknown;
  readonly owner: ComponentId;
  readonly resource: ResourceKind;
}

export type OwnershipEdge = Edge<OwnershipEdgeData>;

const checkoutPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  "customer-app": { x: 0, y: 0 },
  orders: { x: 310, y: 0 },
  OrderCreated: { x: 310, y: 210 },
  payments: { x: 310, y: 420 },
  "payment-processor": { x: 620, y: 420 },
};

/** Derive the presentation symbol from the component kind and, for infrastructure, the destination kind. */
export function deriveSymbol(component: ComponentNodeProjection, destination?: unknown): NodeSymbol {
  if (component.kind !== "infrastructure") return component.kind;
  const kind = typeof destination === "object" && destination !== null ? (destination as { readonly kind?: unknown }).kind : undefined;
  return kind === "queue" ? "queue" : "topic";
}

/** Copies presentation data only; never accepts a simulation projection or a mutation port. */
export function mapArchitecture(projection: ArchitectureProjection, metadata?: ArchitectureDefinition, scenarioName?: string): {
  nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; resourceNodes: ResourceNode[]; resourceEdges: OwnershipEdge[]; error: string | null;
} {
  const ids = new Set(projection.components.map(component => component.id));
  if (ids.size !== projection.components.length || projection.links.some(link => !ids.has(link.source) || !ids.has(link.target))) {
    return { nodes: [], edges: [], resourceNodes: [], resourceEdges: [], error: "Architecture contains duplicate components or connections to missing components." };
  }
  const instances = new Map(metadata?.components.map(component => [component.id, component]));
  const destinations = new Map(metadata?.destinations.map(destination => [destination.id, destination]));
  const sorted = [...projection.components].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const commerce = metadata?.components.some(component => component.model.startsWith("commerce."));
  const depth = new Map<string, number>();
  const queue = sorted.filter(component => component.kind === "client").map(component => component.id);
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    for (const link of projection.links.filter(link => link.source === queue[i])) {
      if (!depth.has(link.target)) { depth.set(link.target, depth.get(link.source)! + 1); queue.push(link.target); }
    }
  }
  const rows = new Map<number, number>();
  const nodes = sorted.map((component, index): ArchitectureNode => {
    const instance = instances.get(component.id);
    const matches = instance?.kind === component.kind && instance.model === component.model && instance.version === component.version;
    const destination = component.kind === "infrastructure" ? destinations.get(component.id) : undefined;
    const symbol = deriveSymbol(component, destination);
    const copy = matches ? checkoutDisplay(scenarioName, component) : undefined;
    const title = destination ? `MessageBus · ${component.label}` : copy?.title ?? component.label;
    const resources = matches ? [
      ...(copy?.resource ? [copy.resource] : []),
      ...(metadata?.databases.filter(database => database.owner === component.id).map(database =>
        `Database owned by ${database.owner}: ${database.tables.map(table => table.name).join(", ")}`) ?? []),
      ...(metadata?.stores.filter(store => store.owner === component.id).map(store => `KeyValueStore owned by ${store.owner}`) ?? []),
    ].sort() : destination ? [`MessageBus ${destination.kind}: ${destination.id}`] : [];
    const column = depth.get(component.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: component.id, type: "component", data: {
        component, symbol, title, resources,
        configuration: matches ? instance.configuration : destination ? {
          deliveryDelay: destination.deliveryDelay, ackTimeout: destination.ackTimeout,
          retryDelay: destination.retryDelay, maxAttempts: destination.maxAttempts, capacity: destination.capacity,
        } : undefined,
      },
      position: commerce ? { x: column * 310, y: row * 210 } : { ...(checkoutPositions[component.id] ?? { x: 930, y: index * 180 }) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
      draggable: false, connectable: false, deletable: false, focusable: true,
      ariaRole: "button", ariaLabel: `${title}, ${symbolLabels[symbol]}`,
      className: `component-node category-${component.kind} symbol-${symbol} nopan`,
    };
  });
  const edges = projection.links.map((link, index): ArchitectureEdge => {
    const subscription = metadata?.subscriptions.some(item => item.destination === link.source && item.consumer === link.target)
      || link.label === "subscription";
    const publication = link.label === "publication";
    const relationship = subscription ? "subscription" : publication ? "publication" : "request";
    const label = subscription ? `Subscribe · ${link.source}` : publication ? `Publish · ${link.target}` : `Request${link.label ? ` · ${link.label}` : ""}`;
    return {
      id: `${relationship}:${link.source}:${link.target}:${index}`, source: link.source, target: link.target,
      type: "link", label, ariaLabel: `${link.source} to ${link.target}: ${label}`, data: { relationship },
      sourceHandle: subscription ? "bottom" : "right", targetHandle: subscription ? "top" : "left",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#334155" },
      style: { stroke: "#334155", strokeWidth: 2, ...(subscription ? { strokeDasharray: "7 5" } : publication ? { strokeDasharray: "2 5" } : {}) },
      labelStyle: { fill: "#172033", fontSize: 13 }, labelBgPadding: [7, 5],
      labelBgStyle: { fill: "#fff" }, selectable: false, focusable: false, deletable: false,
    };
  });
  const projectedById = new Map(projection.components.map(component => [component.id, component]));
  const resourceDefinitions = new Map<string, { kind: ResourceKind; definition: DatabaseDefinition | KeyValueDefinition }>();
  for (const [kind, definitions] of [["database", metadata?.databases ?? []], ["kvstore", metadata?.stores ?? []]] as const) {
    for (const definition of definitions) {
      const owner = projectedById.get(definition.owner);
      const instance = instances.get(definition.owner);
      if (!owner || instance?.kind !== owner.kind || instance.model !== owner.model || instance.version !== owner.version) continue;
      resourceDefinitions.set(`${kind}:${definition.owner}`, { kind, definition });
    }
  }
  const resourceNodes: ResourceNode[] = [...resourceDefinitions.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, { kind, definition }]) => {
    const owner = definition.owner;
    const ownerNode = nodes.find(node => node.id === owner)!;
    const companionKind: ResourceKind = kind === "database" ? "kvstore" : "database";
    const companion = resourceDefinitions.has(`${companionKind}:${owner}`);
    const offsetX = kind === "kvstore" && companion ? 173 : 50;
    const id = `resource:${kind === "database" ? "db" : "kv"}:${owner}`;
    const title = `${resourceLabels[kind]} owned by ${owner}`;
    return {
      id, type: kind, data: { kind, owner, definition },
      position: { x: ownerNode.position.x + offsetX, y: ownerNode.position.y + 120 },
      handles: [{ id: "top", type: "target", position: Position.Top, x: 57.5, y: 0 }],
      draggable: false, connectable: false, deletable: false, selectable: true, focusable: true,
      ariaRole: "button", ariaLabel: title,
      className: `resource-node resource-${kind} nopan`,
    };
  });
  const resourceEdges: OwnershipEdge[] = resourceNodes.map(node => ({
    id: `ownership:${node.data.owner}:${node.id}`,
    source: node.data.owner, target: node.id, sourceHandle: "bottom", targetHandle: "top",
    data: { owner: node.data.owner, resource: node.data.kind },
    style: { stroke: "#94a3b8", strokeWidth: 1 },
    selectable: false, focusable: false, deletable: false,
  }));
  const publisher = nodes.find(node => node.id === "orders");
  const topic = destinations.get("OrderCreated");
  if (publisher && publisher.data.configuration !== undefined && checkoutDisplay(scenarioName, publisher.data.component) && topic?.kind === "topic"
    && nodes.some(node => node.id === topic.id && node.data.component.kind === "infrastructure")) {
    edges.push({
      id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated",
      sourceHandle: "bottom", targetHandle: "top", type: "link",
      label: "Publish · OrderCreated", ariaLabel: "Orders to MessageBus OrderCreated: publication", data: { relationship: "publication" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#334155" },
      style: { stroke: "#334155", strokeWidth: 2, strokeDasharray: "2 5" },
      labelStyle: { fill: "#172033", fontSize: 13 }, labelBgPadding: [7, 5], labelBgStyle: { fill: "#fff" },
      selectable: false, focusable: false, deletable: false,
    });
  }
  return { nodes, edges, resourceNodes, resourceEdges, error: null };
}

/** Read-only link identity for observation movement. Relationship comes from the presentation edge. */
export function movementEdges(edges: readonly ArchitectureEdge[]): MovementEdge[] {
  return edges.flatMap(edge => edge.data ? [{
    id: edge.id, source: edge.source, target: edge.target, relationship: edge.data.relationship,
  }] : []);
}

/**
 * Inline custom properties for one token. The token follows the same measured
 * path as the link it belongs to, and stops on the link for a recorded drop or
 * timeout. Presentation only: it reads stored record fields and never state.
 */
export function flightTokenStyle(step: FlightStep, path: string, durationMs: number): Record<string, string> {
  return {
    "--flight-path": `path("${path}")`,
    "--flight-end": flightStop(step),
    "--flight-duration": `${Math.max(durationMs, 1)}ms`,
  };
}
