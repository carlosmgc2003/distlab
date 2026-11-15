import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, ComponentNodeProjection, DatabaseDefinition, KeyValueDefinition, ComponentId } from "@distlab/contracts";
import { MarkerType, Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import { checkoutDisplay } from "./checkout-display.ts";
import { isEmptySlot } from "./design-step.ts";
import { componentNames, displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";
import { kvServerDescriptor } from "../../../packages/catalogs/src/commerce/descriptors.ts";
import type { ComponentActivity } from "./activity.ts";
import type { FlightPace, FlightStep, FlightTransitGroup } from "./flight.ts";
import type { MovementEdge } from "./records.ts";
import type { Messages } from "./i18n/catalog.ts";
import type { EdgeRoute, LinkKind } from "./layout/elk-layout.ts";
import { elementKey } from "./design-preview.ts";
import type { DesignMarks, DesignProblem, SlotMark } from "./design-preview.ts";

/** The category of a component, in the active language. */
export function categoryLabel(kind: ComponentNodeProjection["kind"], m: Messages): string {
  return m.architecture.category[kind];
}

/** Derived presentation symbol: one shape plus glyph per value. */
export type NodeSymbol = "client" | "service" | "external" | "topic" | "queue" | "kvstore";

/** The caption of a node symbol, in the active language. */
export function symbolLabel(symbol: NodeSymbol, m: Messages): string {
  return m.architecture.symbol[symbol];
}

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
  /** The activity sentence, with display names (#103), rendered where the names are known. */
  activityText?: string;
  /** Set while the playback cursor is on a record: idle, processing, or waiting, read from records at or before it. */
  activity?: ComponentActivity;
  /** Applied student faults that target this component. */
  faults?: readonly string[];
  /** Presentation-only layout tier override (see `TIERS` in layout/elk-layout.ts). */
  tier?: number;
  /** The component's declared model is a placeholder: the slot is empty (#164). */
  emptySlot?: boolean;
  /** An applied design fills this slot (#203): its model, version, and option values. */
  slot?: SlotMark;
  /** The draft fills this slot with another model (#203). Presentation only, never sent. */
  draft?: SlotMark;
  /** Messages of a rejected design's diagnostics that point to this node (#203). */
  problems?: readonly string[];
}, "component">;
export type ArchitectureEdge = Edge<{
  relationship: "request" | "subscription" | "publication";
  /** Layout link kind: requests are sync, bus relationships async. Data links are ownership edges only. */
  link: Exclude<LinkKind, "data">;
  /** ELK route in canvas coordinates, once the graph is laid out. */
  route?: EdgeRoute;
  /** The recorded movement currently painted on this link, if any. */
  flight?: FlightStep;
  /** Hops still waiting on this link at the cursor, one group per kind and direction. */
  transit?: readonly FlightTransitGroup[];
  /** The chosen playback pace, so the token paints over the same interval the cursor waits. */
  pace?: FlightPace;
  /** Changes on every Restart, so the token of a movement painted again starts its leg anew. */
  paint?: number;
  /** A draft mark (#203): a connection the draft adds, or one it removes. Draft links never carry movement. */
  draft?: DraftChange;
  /** Messages of a rejected design's diagnostics that point to this link (#203). */
  problems?: readonly string[];
}>;

/** How a draft mark changes the drawn design: an element it adds, or one of the applied design it removes. */
export type DraftChange = "added" | "removed";

export type ResourceKind = "database" | "kvstore";

/** The kernel name of a resource kind, in the active language's catalog. */
export function resourceLabel(kind: ResourceKind, m: Messages): string {
  return m.architecture.resourceKind[kind];
}

/** "Database owned by orders": the title of a resource node and of the break-fault target that names it. */
export function resourceTitle(kind: ResourceKind, owner: string, m: Messages): string {
  return kind === "database" ? m.architecture.databaseOwnedBy(owner) : m.architecture.storeOwnedBy(owner);
}

export interface ResourceNodeData {
  readonly [key: string]: unknown;
  readonly kind: ResourceKind;
  readonly owner: ComponentId;
  /** The owner's display name (#103); the owner's ID stays in `owner`. */
  readonly ownerName: string;
  /** Verbatim packaged definition, or one built from the owner's model descriptor for a designed resource (#203). */
  readonly definition: DatabaseDefinition | KeyValueDefinition;
  /** A draft mark (#203): a resource the draft attaches, or one it detaches. */
  readonly draft?: DraftChange;
  /** Messages of a rejected design's diagnostics that point to this resource (#203). */
  readonly problems?: readonly string[];
}

export type ResourceNode = Node<ResourceNodeData, ResourceKind>;

export interface OwnershipEdgeData {
  readonly [key: string]: unknown;
  readonly owner: ComponentId;
  readonly resource: ResourceKind;
  readonly link: "data";
  readonly route?: EdgeRoute;
  readonly draft?: DraftChange;
}

export type OwnershipEdge = Edge<OwnershipEdgeData>;

const checkoutPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  "customer-app": { x: 0, y: 0 },
  orders: { x: 400, y: 0 },
  OrderCreated: { x: 400, y: 210 },
  payments: { x: 400, y: 420 },
  "payment-processor": { x: 800, y: 420 },
};

/**
 * Graph colors are theme tokens from `architecture.css`, so links follow the light and dark themes.
 * Data links (owner to its database or store) get their own color, apart from the slate request links.
 */
export const DATA_STROKE = "var(--data-stroke)";
/** MessageBus links share the destinations' purple (`--category-infrastructure`), apart from slate requests. */
export const BUS_STROKE = "var(--bus-stroke)";
const REQUEST_STROKE = "var(--edge-request)";
/** The line pattern of a draft mark (#203). The visible word Draft carries the meaning; the pattern repeats it. */
const DRAFT_DASH = "3 4";

/** Horizontal distance between layout columns: long enough that a token visibly travels a short link. */
const COLUMN_GAP = 380;

const relationshipMarkers = {
  request: { type: MarkerType.ArrowClosed, color: REQUEST_STROKE, width: 20, height: 20 },
  subscription: { type: MarkerType.Arrow, color: BUS_STROKE, width: 20, height: 20 },
  publication: { type: MarkerType.ArrowClosed, color: BUS_STROKE, width: 14, height: 14 },
} as const;

/** Line pattern per relationship; the legend draws the same patterns. Pattern, not color, carries the meaning. */
const relationshipStyles = {
  request: { stroke: REQUEST_STROKE, strokeWidth: 2 },
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
    labelStyle: { fill: bus ? BUS_STROKE : "var(--text-primary)", fontSize: 13, ...(bus ? { fontWeight: 600 } : {}) },
    labelBgPadding: [7, 5] as [number, number], labelBgBorderRadius: bus ? 10 : 2,
    labelBgStyle: bus ? { fill: "var(--bus-label-bg)", stroke: "var(--bus-label-border)", strokeWidth: 1 } : { fill: "var(--surface-panel)" },
  };
}

/**
 * A design drawn on the graph (#203). Every field is presentation derived on the main thread from
 * the packaged architecture, the data-only descriptors, and architecture edits (`design-preview.ts`).
 */
export interface GraphDesign {
  /** Marks of the applied edits the worker published: filled slots and attached or detached resources. */
  readonly applied?: DesignMarks;
  /** The draft preview: only where the draft differs from the applied design. */
  readonly preview?: DesignMarks;
  /** A rejected design's diagnostics, grouped by the element each concerns. */
  readonly problems?: readonly DesignProblem[];
}

/** Where a design element is drawn: a node or an edge of the graph, by its id. */
export type DesignTarget = { readonly kind: "node" | "edge"; readonly id: string };

/** "commerce.notifications 1.0.0", or the Empty slot label for a placeholder. */
export function slotModelLabel(slot: Pick<SlotMark, "model" | "version" | "placeholder">, m: Messages): string {
  return slot.placeholder ? m.designChoices.emptySlot.label : m.architecture.design.model({ model: slot.model, version: slot.version });
}

/**
 * Copies presentation data only; never accepts a simulation projection or a mutation port.
 * `names` are the session's component display names (#103); without them, only the checkout
 * lessons' names apply, as `scenarioName` selects them. `design` draws the applied design's
 * filled slots and resources, the draft preview, and a rejected design's problems (#203); without
 * it, or with empty marks, the graph is exactly the packaged one.
 */
export function mapArchitecture(projection: ArchitectureProjection, metadata: ArchitectureDefinition | undefined, scenarioName: string | undefined, m: Messages,
  names: ComponentNames = componentNames({ source: "checkout", scenarioName }, projection.components, m), design: GraphDesign = {}): {
  nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; resourceNodes: ResourceNode[]; resourceEdges: OwnershipEdge[]; names: ComponentNames; error: string | null;
  /** Where each element with a design problem is drawn, by `elementKey`. */
  designTargets: ReadonlyMap<string, DesignTarget>;
} {
  const designTargets = new Map<string, DesignTarget>();
  const ids = new Set(projection.components.map(component => component.id));
  if (ids.size !== projection.components.length || projection.links.some(link => !ids.has(link.source) || !ids.has(link.target))) {
    return { nodes: [], edges: [], resourceNodes: [], resourceEdges: [], names, error: m.architecture.invalid, designTargets };
  }
  const applied = design.applied;
  const preview = design.preview;
  const problems = new Map((design.problems ?? []).map(problem => [problem.key, problem]));
  const instances = new Map(metadata?.components.map(component => [component.id, component]));
  const destinations = new Map(metadata?.destinations.map(destination => [destination.id, destination]));
  // The applied design's resources: the packaged ones it keeps, then the ones it attaches (ADR-005 application order).
  const detached = (owner: string, resource: "database" | "store") => applied?.resources.some(item => item.owner === owner && item.resource === resource && item.change === "detach") === true;
  const attached = (resource: "database" | "store") => applied?.resources.filter(item => item.resource === resource && item.change === "attach") ?? [];
  const databases: readonly DatabaseDefinition[] = [
    ...(metadata?.databases ?? []).filter(database => !detached(database.owner, "database")),
    ...attached("database").map(item => ({ owner: item.owner, tables: item.tables, initial: {} })),
  ];
  const stores: readonly KeyValueDefinition[] = [
    ...(metadata?.stores ?? []).filter(store => !detached(store.owner, "store")),
    ...attached("store").map(item => ({ owner: item.owner, initial: [] })),
  ];
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
  /** The projected component is the packaged instance, or the model an applied slot edit put in its place. */
  const instanceOf = (component: ComponentNodeProjection) => {
    const instance = instances.get(component.id);
    if (instance?.kind !== component.kind) return undefined;
    if (instance.model === component.model && instance.version === component.version) return { instance, slot: undefined };
    const slot = applied?.slots.find(item => item.component === component.id);
    return slot && slot.model === component.model && slot.version === component.version ? { instance, slot } : undefined;
  };
  const rows = new Map<number, number>();
  const nodes = sorted.map((component, index): ArchitectureNode => {
    const matched = instanceOf(component);
    const instance = matched?.instance;
    const slot = matched?.slot;
    const matches = matched !== undefined;
    const destination = component.kind === "infrastructure" ? destinations.get(component.id) : undefined;
    const symbol = deriveSymbol(component, destination);
    const copy = matches && !slot ? checkoutDisplay(scenarioName, component, m) : undefined;
    const drafted = preview?.slots.find(item => item.component === component.id);
    const packagedEmpty = matches && (slot ? slot.placeholder : isEmptySlot(instance!.model, instance!.version));
    // The preview shows the drafted model instead: its Empty slot mark goes while a real model is drafted.
    const emptySlot = drafted ? drafted.placeholder : packagedEmpty;
    // The channel symbol and its "MessageBus topic" caption say what a destination is; the name says which.
    const title = destination ? component.label : names.get(component.id) ?? component.label;
    // Ordered by kind and then by definition order, never by rendered text, so the order does not depend on the language.
    const resources = matches ? [
      ...databases.filter(database => database.owner === component.id).map(database =>
        m.architecture.databaseResource({ owner: displayName(names, database.owner), tables: database.tables.map(table => table.name) })),
      ...stores.filter(store => store.owner === component.id).map(store => m.architecture.storeResource(displayName(names, store.owner))),
      ...(copy?.resource ? [copy.resource] : []),
    ] : destination ? [destinationResource(destination.kind, destination.id, m)] : [];
    const column = depth.get(component.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    const nodeProblems = problems.get(elementKey({ kind: "component", component: component.id }));
    if (nodeProblems) designTargets.set(nodeProblems.key, { kind: "node", id: component.id });
    const aria = { title, symbol: symbolLabel(symbol, m) };
    return {
      id: component.id, type: "component", data: {
        component, symbol, title, resources, ...(emptySlot ? { emptySlot } : {}),
        ...(slot ? { slot } : {}), ...(drafted ? { draft: drafted } : {}), ...(nodeProblems ? { problems: nodeProblems.messages } : {}),
        configuration: slot ? Object.fromEntries(slot.options.map(option => [option.key, option.value])) as CanonicalValue
          : matches ? instance!.configuration : destination ? {
            deliveryDelay: destination.deliveryDelay, ackTimeout: destination.ackTimeout,
            retryDelay: destination.retryDelay, maxAttempts: destination.maxAttempts, capacity: destination.capacity,
          } : undefined,
      },
      position: commerce ? { x: column * COLUMN_GAP, y: row * 210 } : { ...(checkoutPositions[component.id] ?? { x: 930, y: index * 180 }) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
      draggable: false, connectable: false, deletable: false, focusable: true,
      ariaRole: "button", ariaLabel: drafted ? m.architecture.design.nodeAria({ ...aria, model: slotModelLabel(drafted, m) })
        : (emptySlot ? m.architecture.nodeAriaEmptySlot : m.architecture.nodeAria)(aria),
      className: `component-node category-${component.kind} symbol-${symbol}${emptySlot ? " is-empty-slot" : ""}${drafted ? " is-draft" : ""}${nodeProblems ? " has-problem" : ""} nopan`,
    };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = projection.links.map((link, index): ArchitectureEdge => {
    const subscription = metadata?.subscriptions.some(item => item.destination === link.source && item.consumer === link.target)
      || link.label === "subscription";
    const publication = link.label === "publication";
    const relationship = subscription ? "subscription" : publication ? "publication" : "request";
    const label = subscription ? m.architecture.link.subscription : publication ? m.architecture.link.publication
      : link.label ? m.architecture.link.requestNamed(link.label) : m.architecture.link.request;
    return {
      id: `${relationship}:${link.source}:${link.target}:${index}`, source: link.source, target: link.target,
      type: "elk", label, ariaLabel: m.architecture.link.aria({ source: displayName(names, link.source), target: displayName(names, link.target), label }), data: { relationship, link: relationship === "request" ? "sync" : "async" },
      sourceHandle: handleFor[relationship].source, targetHandle: handleFor[relationship].target,
      markerEnd: relationshipMarkers[relationship],
      style: { ...relationshipStyles[relationship] },
      ...labelLook(relationship), selectable: false, focusable: false, deletable: false,
    };
  });
  const projectedById = new Map(projection.components.map(component => [component.id, component]));
  const resourceDefinitions = new Map<string, { kind: ResourceKind; definition: DatabaseDefinition | KeyValueDefinition; draft?: DraftChange }>();
  const gated = (owner: string) => {
    const projected = projectedById.get(owner);
    return projected ? instanceOf(projected) : undefined;
  };
  for (const [kind, definitions] of [["database", databases], ["kvstore", stores]] as const) {
    for (const definition of definitions) {
      const matched = gated(definition.owner);
      if (!matched) continue;
      // A key-value node is drawn as its store, so the store gets no satellite of its own.
      if (kind === "kvstore" && !matched.slot && isSharedStore(matched.instance.model, matched.instance.version)) continue;
      resourceDefinitions.set(`${kind}:${definition.owner}`, { kind, definition });
    }
  }
  // The draft preview: a resource the draft attaches is an outlined satellite; one it detaches stays, marked as removed.
  for (const item of preview?.resources ?? []) {
    const kind: ResourceKind = item.resource === "database" ? "database" : "kvstore";
    const key = `${kind}:${item.owner}`;
    if (!nodeIds.has(item.owner)) continue;
    const existing = resourceDefinitions.get(key);
    if (item.change === "detach") { if (existing) resourceDefinitions.set(key, { ...existing, draft: "removed" }); continue; }
    if (existing) continue;
    resourceDefinitions.set(key, { kind, draft: "added",
      definition: kind === "database" ? { owner: item.owner, tables: item.tables, initial: {} } : { owner: item.owner, initial: [] } });
  }
  const resourceNodes: ResourceNode[] = [...resourceDefinitions.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, { kind, definition, draft }]) => {
    const owner = definition.owner;
    const ownerNode = nodes.find(node => node.id === owner)!;
    const companionKind: ResourceKind = kind === "database" ? "kvstore" : "database";
    const companion = resourceDefinitions.has(`${companionKind}:${owner}`);
    const offsetX = kind === "kvstore" && companion ? 173 : 50;
    const id = `resource:${kind === "database" ? "db" : "kv"}:${owner}`;
    const ownerName = displayName(names, owner);
    const title = resourceTitle(kind, ownerName, m);
    const resourceProblems = problems.get(elementKey({ kind: "resource", owner, resource: kind === "database" ? "database" : "store" }));
    if (resourceProblems) designTargets.set(resourceProblems.key, { kind: "node", id });
    return {
      id, type: kind, data: { kind, owner, ownerName, definition, ...(draft ? { draft } : {}), ...(resourceProblems ? { problems: resourceProblems.messages } : {}) },
      position: { x: ownerNode.position.x + offsetX, y: ownerNode.position.y + 120 },
      handles: [{ id: handleFor.ownership.target, type: "target", position: Position.Top, x: 57.5, y: 0 }],
      draggable: false, connectable: false, deletable: false, selectable: true, focusable: true,
      ariaRole: "button", ariaLabel: draft === "added" ? m.architecture.design.drafted(title) : draft === "removed" ? m.architecture.design.removed(title) : title,
      className: `resource-node resource-${kind}${draft ? ` is-draft draft-${draft}` : ""}${resourceProblems ? " has-problem" : ""} nopan`,
    };
  });
  const resourceEdges: OwnershipEdge[] = resourceNodes.map(node => {
    const resource = resourceTitle(node.data.kind, node.data.ownerName, m);
    const name = m.architecture.ownershipLink({ owner: node.data.ownerName, resource });
    const draft = node.data.draft;
    return {
      id: `ownership:${node.data.owner}:${node.id}`,
      source: node.data.owner, target: node.id, sourceHandle: handleFor.ownership.source, targetHandle: handleFor.ownership.target,
      type: "elk", data: { owner: node.data.owner, resource: node.data.kind, link: "data", ...(draft ? { draft } : {}) },
      style: { stroke: DATA_STROKE, strokeWidth: 1.5, ...(draft ? { strokeDasharray: DRAFT_DASH } : {}) },
      ...(draft ? { className: `is-draft draft-${draft}` } : {}),
      selectable: false, focusable: false, deletable: false,
      // Without a label React Flow names the link in English ("Edge from a to b").
      ariaLabel: draft === "added" ? m.architecture.design.drafted(name) : draft === "removed" ? m.architecture.design.removed(name) : name,
    };
  });
  const publisher = nodes.find(node => node.id === "orders");
  const topic = destinations.get("OrderCreated");
  if (publisher && publisher.data.configuration !== undefined && checkoutDisplay(scenarioName, publisher.data.component, m) && topic?.kind === "topic"
    && nodes.some(node => node.id === topic.id && node.data.component.kind === "infrastructure")) {
    edges.push({
      id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated",
      sourceHandle: handleFor.publication.source, targetHandle: handleFor.publication.target, type: "elk",
      label: m.architecture.link.publication, ariaLabel: m.architecture.link.publicationAria, data: { relationship: "publication", link: "async" },
      markerEnd: relationshipMarkers.publication,
      style: { ...relationshipStyles.publication },
      ...labelLook("publication"), selectable: false, focusable: false, deletable: false,
    });
  }
  // The draft preview's connections: a drafted subscription or binding is a dashed link marked Draft; an
  // unsubscribe keeps the link and marks it as removed. Draft links are not in the projection, so playback never moves on them.
  const draftEdge = (id: string, source: string, target: string, relationship: "request" | "subscription", label: string): ArchitectureEdge => ({
    id, source, target, type: "elk",
    label: m.architecture.design.draftLabel(label),
    ariaLabel: m.architecture.design.drafted(m.architecture.link.aria({ source: displayName(names, source), target: displayName(names, target), label })),
    data: { relationship, link: relationship === "request" ? "sync" : "async", draft: "added" },
    sourceHandle: handleFor[relationship].source, targetHandle: handleFor[relationship].target,
    markerEnd: relationshipMarkers[relationship],
    style: { ...relationshipStyles[relationship], strokeDasharray: DRAFT_DASH },
    ...labelLook(relationship), className: "is-draft draft-added", selectable: false, focusable: false, deletable: false,
  });
  for (const item of preview?.subscriptions ?? []) {
    if (!nodeIds.has(item.destination) || !nodeIds.has(item.consumer)) continue;
    if (item.change === "subscribe") {
      edges.push(draftEdge(`draft:subscription:${item.destination}:${item.consumer}`, item.destination, item.consumer, "subscription", m.architecture.link.subscription));
      continue;
    }
    const index = edges.findIndex(edge => edge.data?.relationship === "subscription" && edge.source === item.destination && edge.target === item.consumer);
    if (index < 0) continue;
    const edge = edges[index]!;
    edges[index] = {
      ...edge, label: m.architecture.design.removedLabel(String(edge.label)), ariaLabel: m.architecture.design.removed(edge.ariaLabel ?? ""),
      data: { ...edge.data!, draft: "removed" }, className: "is-draft draft-removed",
      style: { ...edge.style, strokeDasharray: DRAFT_DASH },
    };
  }
  // The element each drafted connection draws, so a binding's problem finds its link.
  const connectionKeys = new Map<string, string>();
  for (const item of preview?.connections ?? []) {
    if (!nodeIds.has(item.component) || !nodeIds.has(item.target)) continue;
    const id = `draft:binding:${item.component}:${item.peer}`;
    connectionKeys.set(id, elementKey({ kind: "connection", ...item }));
    edges.push(draftEdge(id, item.component, item.target, "request", m.architecture.design.binding(item.peer)));
  }
  // A rejected design's problems on links: the drafted connection, or the subscription link it concerns.
  for (const [index, edge] of edges.entries()) {
    const key = connectionKeys.get(edge.id)
      ?? (edge.data?.relationship === "subscription" ? elementKey({ kind: "subscription", consumer: edge.target, destination: edge.source }) : undefined);
    const linkProblems = key !== undefined ? problems.get(key) : undefined;
    if (!linkProblems || designTargets.has(linkProblems.key)) continue;
    designTargets.set(linkProblems.key, { kind: "edge", id: edge.id });
    edges[index] = {
      ...edge, label: `⚠ ${String(edge.label)}`, data: { ...edge.data!, problems: linkProblems.messages },
      className: `${edge.className ?? ""} has-problem`.trim(), focusable: true,
      style: { ...edge.style, stroke: "var(--status-error)" },
    };
  }
  return { nodes, edges, resourceNodes, resourceEdges, names, error: null, designTargets };
}

/** A MessageBus destination as a resource line. A kind this build does not know shows its raw code. */
function destinationResource(kind: string, id: string, m: Messages): string {
  return kind === "topic" ? m.architecture.destinationResource.topic(id)
    : kind === "queue" ? m.architecture.destinationResource.queue(id)
      : m.architecture.destinationResourceOther({ kind, id });
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

/** Where a hop still in transit rests, as a share of its link from its origin: just behind mid-link, where a departure stops. */
export const TRANSIT_REST = 42;

/** CSS for a token that rests on its link without travelling. It reads the departure's direction and nothing else. */
export function transitTokenStyle(step: Pick<FlightStep, "reversed">, path: string): Record<string, string> {
  return {
    "--flight-path": `path("${path}")`,
    "--flight-end": `${step.reversed ? 100 - TRANSIT_REST : TRANSIT_REST}%`,
  };
}
