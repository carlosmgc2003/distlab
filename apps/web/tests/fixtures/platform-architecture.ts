import type { ArchitectureDefinition, ArchitectureProjection } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";

/**
 * Layout fixture only: a larger shop platform than any packaged lesson, built
 * to stress placement. One web client enters through one gateway, eight
 * services, one MessageBus with four destinations (three topics, one queue),
 * five owned databases, and two external providers. It is presentation input,
 * never run by the simulation.
 */
const services = ["orders", "payments", "inventory", "catalog", "cart", "accounts", "notifications", "shipping"] as const;
const externals = ["payment-provider", "email-provider"] as const;
const destinations = [
  { id: "OrderPlaced", kind: "topic" }, { id: "PaymentCaptured", kind: "topic" },
  { id: "StockReserved", kind: "queue" }, { id: "UserRegistered", kind: "topic" },
] as const;
const requests: readonly (readonly [string, string])[] = [
  ["web", "gateway"],
  ["gateway", "orders"], ["gateway", "catalog"], ["gateway", "cart"], ["gateway", "accounts"],
  ["orders", "payments"], ["orders", "inventory"], ["cart", "catalog"],
  ["payments", "payment-provider"], ["notifications", "email-provider"],
];
const publications: readonly (readonly [string, string])[] = [
  ["orders", "OrderPlaced"], ["payments", "PaymentCaptured"], ["inventory", "StockReserved"], ["accounts", "UserRegistered"],
];
const subscriptions: readonly (readonly [string, string])[] = [
  ["OrderPlaced", "inventory"], ["OrderPlaced", "notifications"], ["PaymentCaptured", "shipping"],
  ["PaymentCaptured", "notifications"], ["StockReserved", "shipping"], ["UserRegistered", "notifications"],
];
const owners = ["orders", "payments", "inventory", "catalog", "accounts"] as const;

/** The gateway is a service the view lifts into its own tier through `data.tier`. */
export const GATEWAY_ID = "gateway";

export const platformProjection: ArchitectureProjection = {
  components: [
    { id: "web", kind: "client", label: "Web shop", model: "commerce.client", version: "1.0.0" },
    { id: GATEWAY_ID, kind: "service", label: "API gateway", model: "commerce.gateway", version: "1.0.0" },
    ...services.map(id => ({ id, kind: "service" as const, label: id[0]!.toUpperCase() + id.slice(1), model: `commerce.${id}`, version: "1.0.0" })),
    ...externals.map(id => ({ id, kind: "external" as const, label: id, model: `commerce.${id}`, version: "1.0.0" })),
    ...destinations.map(({ id }) => ({ id, kind: "infrastructure" as const, label: id })),
  ],
  links: [
    ...requests.map(([source, target]) => ({ source, target })),
    ...publications.map(([source, target]) => ({ source, target, label: "publication" })),
    ...subscriptions.map(([source, target]) => ({ source, target, label: "subscription" })),
  ],
};

const policy = { requestLatency: duration(1), responseLatency: duration(1), jitter: duration(0), timeout: duration(20), failureRate: 0 };

export const platformMetadata: ArchitectureDefinition = {
  components: platformProjection.components.flatMap(component => component.kind === "infrastructure" ? [] : [{
    id: component.id, kind: component.kind, model: component.model!, version: component.version!, configuration: {},
  }]),
  links: requests.map(([source, target]) => ({ source, target, policy })),
  databases: owners.map(owner => ({ owner, tables: [{ name: `${owner}_rows`, unique: [], checks: [] }], initial: {} })),
  stores: [],
  destinations: destinations.map(({ id, kind }) => ({
    id, kind, deliveryDelay: duration(1), ackTimeout: duration(10), retryDelay: duration(5), maxAttempts: 3, capacity: 100,
  })),
  subscriptions: subscriptions.map(([destination, consumer]) => ({ destination, consumer })),
};
