import type { CanonicalValue, FaultEffect, FaultPoint, LessonOverlayPolicy, LessonParameter, ScheduledFault } from "@distlab/contracts";

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
  "notifications-unbounded", "notifications-dlq",
] as const;
export type CommerceLessonName = typeof commerceLessonNames[number];

/** Data-only documents; paired experiments deliberately share a seed and faults. */
export function commerceScenario(name: CommerceLessonName): CanonicalValue {
  if (name.startsWith("cascade-")) return circuitScenario(name);
  if (name.startsWith("notifications-")) return notificationScenario(name);
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
    assertions: [assertion("one-payment-per-order", 30, "payments", "payments", 1)],
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
      assertion("failed-order-cancelled", 60, "orders", "orders", 1, "order-1", { status: "CANCELLED" }),
      assertion("failed-order-releases-inventory", 60, "inventory", "state", 1, "order-1", { reserved: false }),
      assertion("failed-order-refunded", 60, "payments", "state", 1, "order-1", { status: "REFUNDED", refunded: true }),
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
      assertion("one-notification-per-payment", 50, "notifications", "notifications", 1),
      assertion("payment-event-published", 50, "payments", "outbox", 1, "payment-approved-1", { sent: true }),
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
      { id: "dependency-recovered", predicate: "commerce.metrics", mode: "at", at: 120, parameters: { owner: "payments", expected: { state: "CLOSED", active: 0, calls: breaker ? 5 : 16, failed: breaker ? 3 : 13, succeeded: breaker ? 2 : 3, rejected: breaker ? 11 : 0 } } },
      { id: "bounded-waiting", predicate: "commerce.metrics", mode: "at", at: 120, parameters: { owner: "payments", expected: { peakActive: 3 } } },
      { id: "upstream-drained", predicate: "commerce.metrics", mode: "at", at: 120, parameters: { owner: "api", expected: { active: 0, calls: 16, succeeded: breaker ? 2 : 3 } } },
    ],
  } as CanonicalValue;
}
/**
 * The Messaging Provider is unreachable until t=80: each send is lost and times
 * out, and the uncaught timeout NACKs the `OrderPlaced` delivery. The pair
 * differs in two design choices: whether Orders waits for `NotificationSent`
 * before confirming, and the destination's retry budget (50 stands in for
 * "retry until it works"; 3 sends the message to the dead-letter queue).
 */
function notificationScenario(name: CommerceLessonName): CanonicalValue {
  const safe = name === "notifications-dlq";
  return { version: 1, name: `${name}@1`, seed: "commerce-classroom-1", startTime: 0, configuration,
    architecture: {
      components: [component("client", "client", "client"), component("orders", "notify-orders", "service", { decoupled: safe }),
        component("notifications", "notify-sender"), component("messaging", "messaging-provider", "external")],
      links: [link("client", "orders"), link("notifications", "messaging", 10)],
      databases: [database("orders", ["orders"]), database("notifications", ["notifications"])], stores: [],
      destinations: [
        { id: "OrderPlaced", kind: "topic", deliveryDelay: 1, ackTimeout: 20, retryDelay: 5, maxAttempts: safe ? 3 : 50, capacity: 100 },
        { id: "NotificationSent", kind: "topic", deliveryDelay: 1, ackTimeout: 10, retryDelay: 1, maxAttempts: 3, capacity: 100 },
      ],
      subscriptions: [{ destination: "OrderPlaced", consumer: "notifications" }, { destination: "NotificationSent", consumer: "orders" }],
    }, external: [],
    faults: [{ ...fault("messaging-unreachable", "network.request", "notifications", "messaging", "POST /send", { kind: "drop" }), until: 80, maxApplications: 100 }],
    actions: [
      ...["orders", "notifications"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })),
      request("checkout", 0, "orders", "POST /checkout", { orderId: "order-1" }),
    ], assertions: [
      assertion("nothing-sent-during-outage", 60, "notifications", "notifications", 0),
      assertion("order-confirmed-despite-notification-failure", 50, "orders", "orders", 1, "order-1", { status: "CONFIRMED" }),
      { id: "failed-notification-dead-lettered", predicate: "commerce.dead-letters", mode: "at", at: 60, parameters: { destination: "OrderPlaced", attempts: 3 } },
      { id: "bounded-notification-retries", predicate: "commerce.attempts", mode: "at", at: 120, parameters: { destination: "OrderPlaced", maximum: 3 } },
    ],
  } as CanonicalValue;
}

/**
 * A lesson check is one packaged assertion, classified for students (#96).
 * A business invariant states the property that must hold whatever the design,
 * so every lesson of a family carries the identical assertion and its verdict
 * reads HOLDS (PASS) or VIOLATED (FAIL). A scenario expectation confirms that
 * the lesson reproduced its setup; it may differ between the lessons of a pair.
 */
export interface CommerceCheck {
  readonly id: string;
  readonly kind: "invariant" | "expectation";
  readonly label: string;
}

const invariant = (id: string, label: string): CommerceCheck => ({ id, kind: "invariant", label });
const expectation = (id: string, label: string): CommerceCheck => ({ id, kind: "expectation", label });

/** Data-only classification of every packaged assertion, in document order. */
export function commerceChecks(name: CommerceLessonName): readonly CommerceCheck[] {
  switch (name.split("-")[0]) {
    case "retry":
      return [invariant("one-payment-per-order", "A retried payment request charges the order once")];
    case "saga":
      return [
        expectation("inconsistent-order", "The shipment failed after the order was placed, so it needs compensation (t=30)"),
        expectation("inventory-still-reserved", "Inventory was reserved when the shipment failed (t=30)"),
        expectation("payment-still-approved", "Payment was approved when the shipment failed (t=30)"),
        invariant("failed-order-cancelled", "A failed order is cancelled"),
        invariant("failed-order-releases-inventory", "A failed order does not keep inventory reserved"),
        invariant("failed-order-refunded", "A failed order keeps no approved payment"),
      ];
    case "dual":
    case "outbox":
      return [
        expectation("committed-before-crash", "The payment committed before Payments crashed (t=6)"),
        expectation("nothing-published-yet", "No notification existed when Payments crashed (t=6)"),
        expectation("durable-outbox", name === "dual-write" ? "No outbox row recorded the event (t=6)" : "The outbox recorded the unsent event with the payment (t=6)"),
        invariant("payment-survives-restart", "An approved payment survives a crash and restart"),
        invariant("one-notification-per-payment", "An approved payment produces exactly one notification"),
        invariant("payment-event-published", "An approved payment's event is recorded and published"),
      ];
    case "cqrs":
      return [
        expectation("write-paid", "Orders recorded the payment (t=10)"),
        expectation("read-stale", "Reporting still showed PENDING while the update was delayed (t=10)"),
        invariant("write-remains-paid", "The write model keeps the payment"),
        invariant("read-converged", "The read model converges to the write model"),
      ];
    case "notifications":
      return [
        expectation("nothing-sent-during-outage", "No notification reached the unreachable Messaging Provider (t=60)"),
        invariant("order-confirmed-despite-notification-failure", "An order is confirmed while its notification is failing"),
        invariant("failed-notification-dead-lettered", "A notification that used all 3 attempts is held in the dead-letter queue"),
        invariant("bounded-notification-retries", "No notification is attempted more than 3 times"),
      ];
    default:
      return [
        expectation("dependency-recovered", name === "cascade-breaker"
          ? "Payments' dependency recovered: 5 risk calls, 3 failures, 2 successes, 11 rejections (t=120)"
          : "Payments' dependency recovered: 16 risk calls, 13 failures, 3 successes (t=120)"),
        invariant("bounded-waiting", "Payment requests waiting on the slow risk provider peak at 3"),
        expectation("upstream-drained", "All 16 checks reached the API and drained (t=120)"),
      ];
  }
}

const network: { point: FaultPoint; effects: FaultEffect["kind"][] }[] = [
  { point: "network.request", effects: ["delay", "drop", "disconnect"] },
  { point: "network.response", effects: ["delay", "drop"] },
];
const delivery = { point: "message.delivery" as const, effects: ["delay", "drop", "duplicate"] as FaultEffect["kind"][] };
const commit = { point: "database.commit" as const, effects: ["fail"] as FaultEffect["kind"][] };

/**
 * Lesson overlay policies (ADR-004). Each lesson offers only fault points its
 * architecture has, and only scheduled faults its models survive: saga
 * resources and the outbox payment service already script their own crash and
 * restart, so a student crash there would end the run instead of telling a story.
 */
export function commerceOverlayPolicy(name: CommerceLessonName): LessonOverlayPolicy {
  const family = name.split("-")[0];
  const rules = family === "cascade" ? network
    : family === "cqrs" || family === "outbox" || family === "dual" || family === "notifications" ? [...network, delivery, commit]
    : [...network, commit];
  const scheduled: ScheduledFault["kind"][] = family === "cascade" ? ["crash", "external-availability"]
    : family === "saga" ? ["external-availability"]
    : family === "retry" || family === "cqrs" || family === "notifications" ? ["crash"] : [];
  return { version: 1, lesson: `${name}@1`, faults: { rules, scheduled, maxEntries: 4 }, parameters: commerceParameters(name) };
}

const flag = (key: string, value: boolean, component: string, field: string): LessonParameter =>
  ({ key, domain: { type: "boolean", default: value }, targets: [{ kind: "component", component, field }] });

/**
 * Design choices (#95): the parameters a student may override, as ADR-004
 * declares them. Each default is the lesson's packaged value, so the empty
 * overlay is the packaged lesson. Every pair exposes the switch that
 * distinguishes it; setting that switch to the paired lesson's value gives the
 * paired architecture, while the packaged assertions stay this lesson's.
 */
function commerceParameters(name: CommerceLessonName): readonly LessonParameter[] {
  switch (name) {
    case "retry-unsafe":
    case "retry-idempotent":
      return [
        flag("idempotency", name === "retry-idempotent", "payments", "idempotent"),
        { key: "timeout", domain: { type: "integer", default: 20, minimum: 1, maximum: 60 }, targets: [{ kind: "link", source: "client", target: "payments", field: "timeout" }] },
      ];
    case "saga-uncompensated":
    case "saga-compensated":
      return [flag("compensation", name === "saga-compensated", "orders", "compensate")];
    case "dual-write":
    case "outbox-unsafe-consumer":
    case "outbox-idempotent":
      return [flag("outbox", name !== "dual-write", "payments", "outbox"), flag("consumer-idempotency", name === "outbox-idempotent", "notifications", "idempotent")];
    case "cqrs-delayed":
      return [];
    case "cascade-unprotected":
    case "cascade-breaker":
      return [flag("circuit-breaker", name === "cascade-breaker", "payments", "breaker")];
    case "notifications-unbounded":
    case "notifications-dlq":
      return [
        flag("decoupled-confirmation", name === "notifications-dlq", "orders", "decoupled"),
        { key: "max-attempts", domain: { type: "integer", default: name === "notifications-dlq" ? 3 : 50, minimum: 1, maximum: 50 },
          targets: [{ kind: "destination", destination: "OrderPlaced", field: "maxAttempts" }] },
      ];
  }
}
