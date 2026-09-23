import type { ArchitectureDefinition, ArchitectureProjection, CanonicalValue, ComponentNodeProjection } from "@distlab/contracts";
import { MarkerType, Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import { checkoutDisplay } from "./checkout-display.ts";

export const categoryLabels = {
  client: "Client",
  service: "Internal service",
  external: "External service",
  infrastructure: "Infrastructure",
} as const satisfies Record<ComponentNodeProjection["kind"], string>;

export type ArchitectureNode = Node<{
  component: ComponentNodeProjection;
  title: string;
  configuration: CanonicalValue | undefined;
  resources: readonly string[];
}, "component">;
export type ArchitectureEdge = Edge<{ relationship: "request" | "subscription" | "publication" }>;

const checkoutPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  "customer-app": { x: 0, y: 0 },
  orders: { x: 310, y: 0 },
  OrderCreated: { x: 310, y: 210 },
  payments: { x: 310, y: 420 },
  "payment-processor": { x: 620, y: 420 },
};

/** Copies presentation data only; never accepts a simulation projection or a mutation port. */
export function mapArchitecture(projection: ArchitectureProjection, metadata?: ArchitectureDefinition, scenarioName?: string): {
  nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; error: string | null;
} {
  const ids = new Set(projection.components.map(component => component.id));
  if (ids.size !== projection.components.length || projection.links.some(link => !ids.has(link.source) || !ids.has(link.target))) {
    return { nodes: [], edges: [], error: "Architecture contains duplicate components or connections to missing components." };
  }
  const instances = new Map(metadata?.components.map(component => [component.id, component]));
  const destinations = new Map(metadata?.destinations.map(destination => [destination.id, destination]));
  const sorted = [...projection.components].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const nodes = sorted.map((component, index): ArchitectureNode => {
    const instance = instances.get(component.id);
    const matches = instance?.kind === component.kind && instance.model === component.model && instance.version === component.version;
    const destination = component.kind === "infrastructure" ? destinations.get(component.id) : undefined;
    const copy = matches ? checkoutDisplay(scenarioName, component) : undefined;
    const title = destination ? `MessageBus · ${component.label}` : copy?.title ?? component.label;
    const resources = matches ? [
      ...(copy?.resource ? [copy.resource] : []),
      ...(metadata?.databases.filter(database => database.owner === component.id).map(database =>
        `Database owned by ${database.owner}: ${database.tables.map(table => table.name).join(", ")}`) ?? []),
      ...(metadata?.stores.filter(store => store.owner === component.id).map(store => `KeyValueStore owned by ${store.owner}`) ?? []),
    ] : destination ? [`MessageBus ${destination.kind}: ${destination.id}`] : [];
    return {
      id: component.id, type: "component", data: {
        component, title, resources,
        configuration: matches ? instance.configuration : destination ? {
          deliveryDelay: destination.deliveryDelay, ackTimeout: destination.ackTimeout,
          retryDelay: destination.retryDelay, maxAttempts: destination.maxAttempts, capacity: destination.capacity,
        } : undefined,
      },
      position: { ...(checkoutPositions[component.id] ?? { x: 930, y: index * 180 }) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
      draggable: false, connectable: false, deletable: false, focusable: true,
      ariaRole: "button", ariaLabel: `${title}, ${categoryLabels[component.kind]}`,
      className: `component-node category-${component.kind} nopan`,
    };
  });
  const edges = projection.links.map((link, index): ArchitectureEdge => {
    const subscription = metadata?.subscriptions.some(item => item.destination === link.source && item.consumer === link.target)
      || link.label === "subscription";
    const relationship = subscription ? "subscription" : "request";
    const label = subscription ? `Subscribe · ${link.source}` : `Request${link.label ? ` · ${link.label}` : ""}`;
    return {
      id: `${relationship}:${link.source}:${link.target}:${index}`, source: link.source, target: link.target,
      type: "smoothstep", label, ariaLabel: `${link.source} to ${link.target}: ${label}`, data: { relationship },
      sourceHandle: subscription ? "bottom" : "right", targetHandle: subscription ? "top" : "left",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#334155" },
      style: { stroke: "#334155", strokeWidth: 2, ...(subscription ? { strokeDasharray: "7 5" } : {}) },
      labelStyle: { fill: "#172033", fontSize: 13 }, labelBgPadding: [7, 5],
      labelBgStyle: { fill: "#fff" }, selectable: false, focusable: false, deletable: false,
    };
  });
  const publisher = nodes.find(node => node.id === "orders");
  const topic = destinations.get("OrderCreated");
  if (publisher && publisher.data.configuration !== undefined && checkoutDisplay(scenarioName, publisher.data.component) && topic?.kind === "topic"
    && nodes.some(node => node.id === topic.id && node.data.component.kind === "infrastructure")) {
    edges.push({
      id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated",
      sourceHandle: "bottom", targetHandle: "top", type: "smoothstep",
      label: "Publish · OrderCreated", ariaLabel: "Orders to MessageBus OrderCreated: publication", data: { relationship: "publication" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#334155" },
      style: { stroke: "#334155", strokeWidth: 2, strokeDasharray: "2 5" },
      labelStyle: { fill: "#172033", fontSize: 13 }, labelBgPadding: [7, 5], labelBgStyle: { fill: "#fff" },
      selectable: false, focusable: false, deletable: false,
    });
  }
  return { nodes, edges, error: null };
}
