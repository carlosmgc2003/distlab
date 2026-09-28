import type { CanonicalValue } from "@distlab/contracts";

const component = (id: string, model: string, kind = "service", configuration = {}) => ({ id, model: `commerce.${model}`, kind, version: "1.0.0", configuration });
const link = (source: string, target: string, timeout = 20) => ({ source, target, policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout, failureRate: 0 } });
const database = (owner: string, names: string[], initial = {}) => ({
  owner, tables: names.map(name => ({ name, unique: [], checks: [] })),
  initial: Object.keys(initial).length ? initial : Object.fromEntries(names.map(name => [name, {}])),
});
const request = (id: string, at: number, target: string, endpoint: string, body = {}, retry = false) => ({ id, at, kind: "client", target: "client", action: "request", data: { target, endpoint, body, retry, label: id } });
const assertion = (id: string, at: number, owner: string, table: string, count: number, key = "", expected = {}) => ({ id, predicate: "commerce.rows", mode: "at", at, parameters: { owner, table, count, key, expected } });
const fault = (id: string, point: string, source: string, target: string, name: string, effect: object) => ({ id, point, source, target, name, from: 0, probability: 1, maxApplications: 1, effect });
const configuration = { startTime: 0, historyLimit: 100000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} };

export const commerceLessonNames = [
  "retry-unsafe", "retry-idempotent",
  "saga-uncompensated", "saga-compensated",
  "dual-write", "outbox-unsafe-consumer", "outbox-idempotent",
  "cqrs-delayed", "cascade-unprotected", "cascade-breaker",
] as const;
export type CommerceLessonName = typeof commerceLessonNames[number];

/** Data-only documents; paired experiments deliberately share a seed and faults. */
export function commerceScenario(name: CommerceLessonName): CanonicalValue {
  if (name.startsWith("cascade-")) return circuitScenario(name);
  if (name === "cqrs-delayed") return cqrsScenario(name);
  if (name.startsWith("saga-")) return sagaScenario(name);
  if (name === "dual-write" || name.startsWith("outbox-")) return outboxScenario(name);
  const safe = name === "retry-idempotent";
  const components = [component("client", "client", "client"), component("payments", "payment", "service", { idempotent: safe })];
  return {
    version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: { components, links: [link("client", "payments")], databases: [database("payments", ["payments", "results"])], stores: [], destinations: [], subscriptions: [] },
    external: [], faults: [fault("lost-payment-response", "network.response", "payments", "client", "POST /pay", { kind: "drop" })],
    actions: [{ id: "start-payments", at: 0, kind: "service", target: "payments", state: "RUNNING" }, request("pay", 0, "payments", "POST /pay", { idempotencyKey: "order-1" }, true)],
    assertions: [assertion("processed-payments", 30, "payments", "payments", safe ? 1 : 2)],
  } as CanonicalValue;
}

function sagaScenario(name: CommerceLessonName): CanonicalValue {
  const compensate = name === "saga-compensated";
  const components = [component("client", "client", "client"), component("orders", "saga", "service", { compensate }),
    component("inventory", "saga-resource", "service", { forward: { reserved: true }, compensated: { reserved: false } }),
    component("payments", "saga-resource", "service", { forward: { status: "APPROVED", refunded: false }, compensated: { status: "REFUNDED", refunded: true } }),
    component("carrier", "carrier", "external")];
  return { version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: { components, links: [link("client", "orders", 100), link("orders", "inventory"), link("orders", "payments"), link("orders", "carrier")],
      databases: [database("orders", ["orders"]), database("inventory", ["state"]), database("payments", ["state"])], stores: [], destinations: [], subscriptions: [] },
    external: [], faults: [fault("shipment-request-lost", "network.request", "orders", "carrier", "POST /ship", { kind: "drop" })],
    actions: [...["orders", "inventory", "payments"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })), request("checkout", 0, "orders", "POST /checkout")],
    assertions: [
      assertion("inconsistent-order", 30, "orders", "orders", 1, "order-1", { status: "NEEDS_COMPENSATION" }),
      assertion("inventory-still-reserved", 30, "inventory", "state", 1, "order-1", { reserved: true }),
      assertion("payment-still-approved", 30, "payments", "state", 1, "order-1", { status: "APPROVED", refunded: false }),
      assertion("final-order", 60, "orders", "orders", 1, "order-1", { status: compensate ? "CANCELLED" : "NEEDS_COMPENSATION" }),
      assertion("final-inventory", 60, "inventory", "state", 1, "order-1", { reserved: !compensate }),
      assertion("final-payment", 60, "payments", "state", 1, "order-1", { refunded: compensate }),
    ],
  } as CanonicalValue;
}

function outboxScenario(name: CommerceLessonName): CanonicalValue {
  const outbox = name !== "dual-write";
  const idempotent = name === "outbox-idempotent";
  return { version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: {
      components: [component("client", "client", "client"), component("payments", "outbox-payment", "service", { outbox }), component("notifications", "notifications", "service", { idempotent })],
      links: [link("client", "payments", 40)], databases: [database("payments", ["payments", "outbox"]), database("notifications", ["notifications", "inbox"])], stores: [],
      destinations: [{ id: "PaymentApproved", kind: "topic", deliveryDelay: 1, ackTimeout: 10, retryDelay: 1, maxAttempts: 3, capacity: 100 }],
      subscriptions: [{ destination: "PaymentApproved", consumer: "notifications" }],
    }, external: [],
    faults: [fault("duplicate-approved", "message.delivery", "payments", "notifications", "PaymentApproved", { kind: "duplicate", additionalCopies: 1, spacing: 3 })],
    actions: [
      ...["payments", "notifications"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })),
      request("pay", 0, "payments", "POST /pay"),
      { id: "crash-after-commit", at: 5, kind: "fault", fault: { id: "payment-crash", kind: "crash", target: "payments" } },
      { id: "restart", at: 15, kind: "service", target: "payments", state: "STARTING" },
      { id: "ready", at: 16, kind: "service", target: "payments", state: "RUNNING" },
      request("relay", 17, "payments", "POST /relay"),
    ], assertions: [
      assertion("committed-before-crash", 6, "payments", "payments", 1, "order-1", { status: "APPROVED" }),
      assertion("nothing-published-yet", 6, "notifications", "notifications", 0),
      assertion("durable-outbox", 6, "payments", "outbox", outbox ? 1 : 0, outbox ? "payment-approved-1" : "", outbox ? { sent: false } : {}),
      assertion("payment-survives-restart", 50, "payments", "payments", 1, "order-1", { status: "APPROVED" }),
      assertion("notification-effects", 50, "notifications", "notifications", outbox ? (idempotent ? 1 : 2) : 0),
      assertion("outbox-published", 50, "payments", "outbox", outbox ? 1 : 0, outbox ? "payment-approved-1" : "", outbox ? { sent: true } : {}),
    ],
  } as CanonicalValue;
}

function cqrsScenario(name: CommerceLessonName): CanonicalValue {
  const initial = { orders: { "order-1": { status: "PENDING", version: 0 } } };
  return { version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: {
      components: [component("client", "client", "client"), component("orders", "order-write"), component("reporting", "order-read")],
      links: [link("client", "orders"), link("client", "reporting")], databases: [database("orders", ["orders"], initial), database("reporting", ["orders"], initial)], stores: [],
      destinations: [{ id: "OrderUpdated", kind: "topic", deliveryDelay: 1, ackTimeout: 10, retryDelay: 1, maxAttempts: 3, capacity: 100 }],
      subscriptions: [{ destination: "OrderUpdated", consumer: "reporting" }],
    }, external: [], faults: [fault("delayed-order-update", "message.delivery", "orders", "reporting", "OrderUpdated", { kind: "delay", duration: 40 })],
    actions: [
      ...["orders", "reporting"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })),
      request("mark-paid", 0, "orders", "POST /paid"),
      request("early-write", 10, "orders", "GET /order"), request("early-read", 10, "reporting", "GET /order"),
      request("late-write", 50, "orders", "GET /order"), request("late-read", 50, "reporting", "GET /order"),
    ], assertions: [
      assertion("write-paid", 10, "orders", "orders", 1, "order-1", { status: "PAID" }),
      assertion("read-stale", 10, "reporting", "orders", 1, "order-1", { status: "PENDING" }),
      assertion("write-remains-paid", 60, "orders", "orders", 1, "order-1", { status: "PAID" }),
      assertion("read-converged", 60, "reporting", "orders", 1, "order-1", { status: "PAID" }),
    ],
  } as CanonicalValue;
}

function circuitScenario(name: CommerceLessonName): CanonicalValue {
  const breaker = name === "cascade-breaker";
  return { version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: {
      components: [component("client", "client", "client"),
        component("api", "dependency", "service", { target: "orders", breaker: false }),
        component("orders", "dependency", "service", { target: "payments", breaker: false }),
        component("payments", "dependency", "service", { target: "risk", breaker }), component("risk", "risk", "external")],
      links: [link("client", "api", 100), link("api", "orders", 80), link("orders", "payments", 60), link("payments", "risk", 20)],
      databases: [], stores: ["api", "orders", "payments"].map(owner => ({ owner, initial: [] })), destinations: [], subscriptions: [],
    }, external: [], faults: [{ ...fault("slow-risk-provider", "network.request", "payments", "risk", "POST /check", { kind: "delay", duration: 60 }), until: 60, maxApplications: 100 }],
    actions: [
      ...["api", "orders", "payments"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })),
      ...[0, 1, 2, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 65, 65, 90].map((at, i) => request(`check-${i}`, at, "api", "POST /check")),
    ], assertions: [
      { id: "dependency-recovered", predicate: "commerce.metrics", mode: "at", at: 120, parameters: { owner: "payments", expected: { state: "CLOSED", active: 0, calls: breaker ? 5 : 16, failed: breaker ? 3 : 13, succeeded: breaker ? 2 : 3, rejected: breaker ? 11 : 0, peakActive: breaker ? 3 : 10 } } },
      { id: "upstream-drained", predicate: "commerce.metrics", mode: "at", at: 120, parameters: { owner: "api", expected: { active: 0, calls: 16, succeeded: breaker ? 2 : 3 } } },
    ],
  } as CanonicalValue;
}

