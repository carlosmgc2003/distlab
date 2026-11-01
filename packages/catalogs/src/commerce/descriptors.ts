import type { ModelDescriptor } from "@distlab/contracts";

/**
 * Data-only descriptors of the commerce catalog models (ADR-005). The main
 * thread may import this module; the worker's catalog builds each
 * `ScenarioModel` from these plus its `checks` and `instantiate`.
 */

const VERSION = "1.0.0";
const none = { actions: [], endpoints: [], consumers: [], operations: [], publishes: [], peers: [], storage: {}, options: [] } as const;
const tables = (...names: string[]) => ({ database: { tables: names.map(name => ({ name, unique: [], checks: [] })) } });
const flag = (key: string) => ({ key, domain: { type: "boolean", default: false } }) as const;

/** Workload-addressed: each `request` action names its own target and endpoint, so the client declares no peers. */
export const clientDescriptor: ModelDescriptor = { ...none, model: "commerce.client", version: VERSION, kind: "client", actions: ["request"] };

export const retryDescriptor: ModelDescriptor = {
  ...none, model: "commerce.payment", version: VERSION, kind: "service", endpoints: ["POST /pay"],
  storage: tables("payments", "results"), options: [flag("idempotent")],
};

export const sagaDescriptor: ModelDescriptor = {
  ...none, model: "commerce.saga", version: VERSION, kind: "service", endpoints: ["POST /checkout"],
  peers: [
    { name: "inventory", kinds: ["service"], calls: ["POST /apply", "POST /compensate"], default: "inventory" },
    { name: "payments", kinds: ["service"], calls: ["POST /apply", "POST /compensate"], default: "payments" },
    { name: "carrier", kinds: ["external"], calls: ["POST /ship"], default: "carrier" },
  ],
  storage: tables("orders"), options: [flag("compensate")],
};

/** `forward` and `compensated` are lesson data (the rows it writes), not behavior options. */
export const sagaResourceDescriptor: ModelDescriptor = {
  ...none, model: "commerce.saga-resource", version: VERSION, kind: "service", endpoints: ["POST /apply", "POST /compensate"],
  storage: tables("state"),
};

export const carrierDescriptor: ModelDescriptor = { ...none, model: "commerce.carrier", version: VERSION, kind: "external", operations: ["POST /ship"] };

export const outboxDescriptor: ModelDescriptor = {
  ...none, model: "commerce.outbox-payment", version: VERSION, kind: "service", endpoints: ["POST /pay", "POST /relay"],
  publishes: ["PaymentApproved"], storage: tables("payments", "outbox"), options: [flag("outbox")],
};

export const notificationDescriptor: ModelDescriptor = {
  ...none, model: "commerce.notifications", version: VERSION, kind: "service", consumers: ["PaymentApproved"],
  storage: tables("notifications", "inbox"), options: [flag("idempotent")],
};

export const orderWriteDescriptor: ModelDescriptor = {
  ...none, model: "commerce.order-write", version: VERSION, kind: "service", endpoints: ["POST /paid", "GET /order"],
  publishes: ["OrderUpdated"], storage: tables("orders"),
};

export const orderReadDescriptor: ModelDescriptor = {
  ...none, model: "commerce.order-read", version: VERSION, kind: "service", endpoints: ["GET /order"], consumers: ["OrderUpdated"],
  storage: tables("orders"),
};

export const dependencyDescriptor: ModelDescriptor = {
  ...none, model: "commerce.dependency", version: VERSION, kind: "service", endpoints: ["POST /check"],
  peers: [{ name: "target", kinds: ["service", "external"], calls: ["POST /check"], default: "risk" }],
  storage: { store: true }, options: [flag("breaker")],
};

export const riskDescriptor: ModelDescriptor = { ...none, model: "commerce.risk", version: VERSION, kind: "external", operations: ["POST /check"] };

/** Orders either confirms at checkout (`decoupled`) or waits for `NotificationSent`. */
export const notifyOrdersDescriptor: ModelDescriptor = {
  ...none, model: "commerce.notify-orders", version: VERSION, kind: "service", endpoints: ["POST /checkout"], consumers: ["NotificationSent"],
  publishes: ["OrderPlaced"], storage: tables("orders"), options: [flag("decoupled")],
};

/** Sends through the Messaging Provider. An uncaught send timeout NACKs; the destination bounds the retries. */
export const notifySenderDescriptor: ModelDescriptor = {
  ...none, model: "commerce.notify-sender", version: VERSION, kind: "service", consumers: ["OrderPlaced"], publishes: ["NotificationSent"],
  peers: [{ name: "provider", kinds: ["external"], calls: ["POST /send"], default: "messaging" }],
  storage: tables("notifications"),
};

export const messagingDescriptor: ModelDescriptor = { ...none, model: "commerce.messaging-provider", version: VERSION, kind: "external", operations: ["POST /send"] };

export const commerceDescriptors: readonly ModelDescriptor[] = [
  clientDescriptor, retryDescriptor, carrierDescriptor, sagaDescriptor, sagaResourceDescriptor, notificationDescriptor,
  outboxDescriptor, orderReadDescriptor, orderWriteDescriptor, dependencyDescriptor, riskDescriptor,
  notifyOrdersDescriptor, notifySenderDescriptor, messagingDescriptor,
];
