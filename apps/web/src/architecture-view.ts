import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, ComponentNodeProjection, DatabaseDefinition, KeyValueDefinition, ComponentId } from "@distlab/contracts";
import { MarkerType, Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import { checkoutDisplay } from "./checkout-display.ts";
import { componentNames, displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";
import { EMPTY_SLOT_LABEL, isEmptySlot } from "./design-step.ts";
import { kvServerDescriptor } from "../../../packages/catalogs/src/commerce/descriptors.ts";
import type { ComponentActivity } from "./activity.ts";
import type { FlightPace, FlightStep } from "./flight.ts";
import type { MovementEdge } from "./records.ts";
import type { EdgeRoute, LinkKind } from "./layout/elk-layout.ts";

export const categoryLabels = {
  client: "Client",
  service: "Internal service",
  external: "External service",
  infrastructure: "Infrastructure",
} as const satisfies Record<ComponentNodeProjection["kind"], string>;

/** Derived presentation symbol: one shape plus glyph per value. */
export type NodeSymbol = "client" | "service" | "external" | "topic" | "queue" | "kvstore";

export const symbolLabels: Record<NodeSymbol, string> = {
  client: "Client",
  service: "Internal service",
  external: "External service",
  topic: "Message bus topic",
  queue: "Message bus queue",
  kvstore: "Shared key-value store",
};

/**
 * Whether a component is a key-value node: its model is the catalog's data-only descriptor of a
 * service that owns a KeyValueStore and exposes only that store's operations. The graph draws it
 * as the store its callers share, not as a service with a store beside it. Read from the declared
 * model, never from a component ID.
 */
export function isSharedStore(model: string | undefined, version: string | undefined): boolean {
  return model === kvServerDescriptor.model && version === kvServerDescriptor.version;
}

export type ArchitectureNode = Node<{
  component: ComponentNodeProjection;
  symbol: NodeSymbol;
  title: string;
  configuration: CanonicalValue | undefined;
  resources: readonly string[];
  /** Set while a recorded movement is painted on the graph. */
  role?: "sending" | "receiving";
  roleLabel?: string;
  /** Set while the playback cursor is on a record: idle, processing, or waiting, read from records at or before it. */
  activity?: ComponentActivity;
  /** Applied student faults that target this component. */
  faults?: readonly string[];
  /** Presentation-only layout tier override (see `TIERS` in layout/elk-layout.ts). */
  tier?: number;
  /** The component's declared model is a placeholder: the slot is empty (#164). */
  emptySlot?: boolean;
}, "component">;
export type ArchitectureEdge = Edge<{
  relationship: "request" | "subscription" | "publication";
  /** Layout link kind: requests are sync, bus relationships async. Data links are ownership edges only. */
  link: Exclude<LinkKind, "data">;
  /** ELK route in canvas coordinates, once the graph is laid out. */
  route?: EdgeRoute;
  /** The recorded movement currently painted on this link, if any. */
  flight?: FlightStep;
  /** The chosen playback pace, so the token paints over the same interval the cursor waits. */
  pace?: FlightPace;
  /** Changes on every Restart, so the token of a movement painted again starts its leg anew. */
  paint?: number;
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
  /** The owner's display name (#103); the owner's ID stays in `owner`. */
  readonly ownerName: string;
  /** Verbatim packaged definition, copied by reference and never mutated. */
  readonly definition: DatabaseDefinition | KeyValueDefinition;
}

export type ResourceNode = Node<ResourceNodeData, ResourceKind>;

export interface OwnershipEdgeData {
  readonly [key: string]: unknown;
  readonly owner: ComponentId;
  readonly resource: ResourceKind;
  readonly link: "data";
  readonly route?: EdgeRoute;
}

export type OwnershipEdge = Edge<OwnershipEdgeData>;

const checkoutPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  "customer-app": { x: 0, y: 0 },
  orders: { x: 400, y: 0 },
  OrderCreated: { x: 400, y: 210 },
  payments: { x: 400, y: 420 },
  "payment-processor": { x: 800, y: 420 },
};

/** Data links (owner to its database or store) get their own color, apart from the slate request links. */
export const DATA_STROKE = "#b45309";
/** MessageBus links share the destinations' purple (`--category-infrastructure`), apart from slate requests. */
export const BUS_STROKE = "#6b21a8";

/** Horizontal distance between layout columns: long enough that a token visibly travels a short link. */
const COLUMN_GAP = 380;

const relationshipMarkers = {
  request: { type: MarkerType.ArrowClosed, color: "#334155", width: 20, height: 20 },
  subscription: { type: MarkerType.Arrow, color: BUS_STROKE, width: 20, height: 20 },
  publication: { type: MarkerType.ArrowClosed, color: BUS_STROKE, width: 14, height: 14 },
} as const;

/** Line pattern per relationship; the legend draws the same patterns. Pattern, not color, carries the meaning. */
const relationshipStyles = {
  request: { stroke: "#334155", strokeWidth: 2 },
  subscription: { stroke: BUS_STROKE, strokeWidth: 2, strokeDasharray: "8 5" },
  publication: { stroke: BUS_STROKE, strokeWidth: 2, strokeDasharray: "2 5", strokeLinecap: "round" },
} as const;

/**
 * Handle per side, matching the ELK port sides: requests and bus links leave
 * east and enter west (a destination is entered on its inlet and left from its
 * outlet), data links leave by the south.
 */
export const handleFor = {
  request: { source: "east", target: "west" },
  subscription: { source: "east", target: "west" },
  publication: { source: "east", target: "west" },
  ownership: { source: "south", target: "north" },
} as const;

/** Bus link label: the relationship alone, since the destination already names itself on the graph. */
const busLabels = { subscription: "Subscription", publication: "Publication" } as const;

/** Derive the presentation symbol from the component kind, its model for a key-value node, and, for infrastructure, the destination kind. */
export function deriveSymbol(component: ComponentNodeProjection, destination?: unknown): NodeSymbol {
  if (component.kind === "service" && isSharedStore(component.model, component.version)) return "kvstore";
  if (component.kind !== "infrastructure") return component.kind;
  const kind = typeof destination === "object" && destination !== null ? (destination as { readonly kind?: unknown }).kind : undefined;
  return kind === "queue" ? "queue" : "topic";
}

/** Label text and chip per relationship: bus labels take the bus purple on a pale lilac chip. */
function labelLook(relationship: keyof typeof relationshipStyles) {
  const bus = relationship !== "request";
  return {
    labelStyle: { fill: bus ? BUS_STROKE : "#172033", fontSize: 13, ...(bus ? { fontWeight: 600 } : {}) },
    labelBgPadding: [7, 5] as [number, number], labelBgBorderRadius: bus ? 10 : 2,
    labelBgStyle: bus ? { fill: "#faf5ff", stroke: "#d8b4fe", strokeWidth: 1 } : { fill: "#fff" },
  };
}

/**
 * Copies presentation data only; never accepts a simulation projection or a mutation port.
 * `names` are the session's component display names (#103); without them, only the checkout
 * lessons' names apply, as `scenarioName` selects them.
 */
export function mapArchitecture(projection: ArchitectureProjection, metadata?: ArchitectureDefinition, scenarioName?: string,
  names: ComponentNames = componentNames({ source: "checkout", scenarioName }, projection.components)): {
  nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; resourceNodes: ResourceNode[]; resourceEdges: OwnershipEdge[]; names: ComponentNames; error: string | null;
} {
  const ids = new Set(projection.components.map(component => component.id));
  if (ids.size !== projection.components.length || projection.links.some(link => !ids.has(link.source) || !ids.has(link.target))) {
    return { nodes: [], edges: [], resourceNodes: [], resourceEdges: [], names, error: "Architecture contains duplicate components or connections to missing components." };
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
    const emptySlot = matches && isEmptySlot(instance.model, instance.version);
    // The channel symbol and its "MessageBus topic" caption say what a destination is; the name says which.
    const title = destination ? component.label : names.get(component.id) ?? component.label;
    const resources = matches ? [
      ...(copy?.resource ? [copy.resource] : []),
      ...(metadata?.databases.filter(database => database.owner === component.id).map(database =>
        `Database owned by ${displayName(names, database.owner)}: ${database.tables.map(table => table.name).join(", ")}`) ?? []),
      ...(metadata?.stores.filter(store => store.owner === component.id).map(store => `KeyValueStore owned by ${displayName(names, store.owner)}`) ?? []),
    ].sort() : destination ? [`MessageBus ${destination.kind}: ${destination.id}`] : [];
    const column = depth.get(component.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: component.id, type: "component", data: {
        component, symbol, title, resources, ...(emptySlot ? { emptySlot } : {}),
        configuration: matches ? instance.configuration : destination ? {
          deliveryDelay: destination.deliveryDelay, ackTimeout: destination.ackTimeout,
          retryDelay: destination.retryDelay, maxAttempts: destination.maxAttempts, capacity: destination.capacity,
        } : undefined,
      },
      position: commerce ? { x: column * COLUMN_GAP, y: row * 210 } : { ...(checkoutPositions[component.id] ?? { x: 930, y: index * 180 }) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
      draggable: false, connectable: false, deletable: false, focusable: true,
      ariaRole: "button", ariaLabel: `${title}, ${symbolLabels[symbol]}${emptySlot ? `, ${EMPTY_SLOT_LABEL.toLowerCase()}` : ""}`,
      className: `component-node category-${component.kind} symbol-${symbol}${emptySlot ? " is-empty-slot" : ""} nopan`,
    };
  });
  const edges = projection.links.map((link, index): ArchitectureEdge => {
    const subscription = metadata?.subscriptions.some(item => item.destination === link.source && item.consumer === link.target)
      || link.label === "subscription";
    const publication = link.label === "publication";
    const relationship = subscription ? "subscription" : publication ? "publication" : "request";
    const label = subscription ? busLabels.subscription : publication ? busLabels.publication : `Request${link.label ? ` · ${link.label}` : ""}`;
    return {
      id: `${relationship}:${link.source}:${link.target}:${index}`, source: link.source, target: link.target,
      type: "elk", label, ariaLabel: `${displayName(names, link.source)} to ${displayName(names, link.target)}: ${label}`, data: { relationship, link: relationship === "request" ? "sync" : "async" },
      sourceHandle: handleFor[relationship].source, targetHandle: handleFor[relationship].target,
      markerEnd: relationshipMarkers[relationship],
      style: { ...relationshipStyles[relationship] },
      ...labelLook(relationship), selectable: false, focusable: false, deletable: false,
    };
  });
  const projectedById = new Map(projection.components.map(component => [component.id, component]));
  const resourceDefinitions = new Map<string, { kind: ResourceKind; definition: DatabaseDefinition | KeyValueDefinition }>();
  for (const [kind, definitions] of [["database", metadata?.databases ?? []], ["kvstore", metadata?.stores ?? []]] as const) {
    for (const definition of definitions) {
      const owner = projectedById.get(definition.owner);
      const instance = instances.get(definition.owner);
      if (!owner || instance?.kind !== owner.kind || instance.model !== owner.model || instance.version !== owner.version) continue;
      // A key-value node is drawn as its store, so the store gets no satellite of its own.
      if (kind === "kvstore" && isSharedStore(instance.model, instance.version)) continue;
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
    const ownerName = displayName(names, owner);
    const title = `${resourceLabels[kind]} owned by ${ownerName}`;
    return {
      id, type: kind, data: { kind, owner, ownerName, definition },
      position: { x: ownerNode.position.x + offsetX, y: ownerNode.position.y + 120 },
      handles: [{ id: handleFor.ownership.target, type: "target", position: Position.Top, x: 57.5, y: 0 }],
      draggable: false, connectable: false, deletable: false, selectable: true, focusable: true,
      ariaRole: "button", ariaLabel: title,
      className: `resource-node resource-${kind} nopan`,
    };
  });
  const resourceEdges: OwnershipEdge[] = resourceNodes.map(node => ({
    id: `ownership:${node.data.owner}:${node.id}`,
    source: node.data.owner, target: node.id, sourceHandle: handleFor.ownership.source, targetHandle: handleFor.ownership.target,
    type: "elk", data: { owner: node.data.owner, resource: node.data.kind, link: "data" },
    style: { stroke: DATA_STROKE, strokeWidth: 1.5 },
    selectable: false, focusable: false, deletable: false,
  }));
  const publisher = nodes.find(node => node.id === "orders");
  const topic = destinations.get("OrderCreated");
  if (publisher && publisher.data.configuration !== undefined && checkoutDisplay(scenarioName, publisher.data.component) && topic?.kind === "topic"
    && nodes.some(node => node.id === topic.id && node.data.component.kind === "infrastructure")) {
    edges.push({
      id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated",
      sourceHandle: handleFor.publication.source, targetHandle: handleFor.publication.target, type: "elk",
      label: busLabels.publication, ariaLabel: "Orders to MessageBus OrderCreated: publication", data: { relationship: "publication", link: "async" },
      markerEnd: relationshipMarkers.publication,
      style: { ...relationshipStyles.publication },
      ...labelLook("publication"), selectable: false, focusable: false, deletable: false,
    });
  }
  return { nodes, edges, resourceNodes, resourceEdges, names, error: null };
}

/** Read-only link identity for observation movement. Relationship comes from the presentation edge. */
export function movementEdges(edges: readonly ArchitectureEdge[]): MovementEdge[] {
  return edges.flatMap(edge => edge.data ? [{
    id: edge.id, source: edge.source, target: edge.target, relationship: edge.data.relationship,
  }] : []);
}

/**
 * Inline custom properties for one token. The token follows the same measured
 * path as the link it belongs to. The SVG path always runs from the link's
 * source to its target, so a movement that runs against the link (a response, an
 * acknowledgement) animates from the far end back: start and stop are mirrored,
 * and the heading mark turns 180° from the path's own tangent. Presentation
 * only: it reads stored record fields and never state.
 */
export function flightTokenStyle(step: FlightStep, path: string, durationMs: number): Record<string, string> {
  const along = (share: number) => `${step.reversed ? 100 - share : share}%`;
  return {
    "--flight-path": `path("${path}")`,
    "--flight-start": along(step.span.start),
    "--flight-end": along(step.span.end),
    "--flight-rotate": step.reversed ? "auto 180deg" : "auto",
    "--flight-duration": `${Math.max(durationMs, 1)}ms`,
  };
}
