import type { CanonicalValue } from "@distlab/contracts";

// Illustrative logical milliseconds: expose async boundaries while keeping
// success quick; the lost-response case still hits the 1000 ms network timeout.
const clientNetworkLatency = 20;
const messageDeliveryDelay = 5;
const processorLatency = 30;
const assertionDeadline = 2000;

const architecture = {
  components: [
    { id: "customer-app", kind: "client", model: "distlab.customer-app", version: "1.0.0", configuration: {} },
    { id: "orders", kind: "service", model: "distlab.orders", version: "1.0.0", configuration: {} },
    { id: "payments", kind: "service", model: "distlab.payments", version: "1.0.0", configuration: {} },
    { id: "payment-processor", kind: "external", model: "distlab.payment-processor", version: "1.0.0", configuration: {} },
  ],
  links: [
    { source: "customer-app", target: "orders", policy: { requestLatency: clientNetworkLatency, responseLatency: clientNetworkLatency, jitter: 0, timeout: 1000, failureRate: 0 } },
    { source: "payments", target: "payment-processor", policy: { requestLatency: 0, responseLatency: 0, jitter: 0, timeout: 1000, failureRate: 0 } },
  ],
  databases: [
    { owner: "orders", tables: [{ name: "orders", unique: [["orderId"]], checks: [] }, { name: "outbox", unique: [["messageId"]], checks: [] }], initial: { orders: {}, outbox: {} } },
    { owner: "payments", tables: [{ name: "payments", unique: [["paymentId"]], checks: [] }, { name: "inbox", unique: [["messageId"]], checks: [] }], initial: { payments: {}, inbox: {} } },
  ],
  stores: [],
  destinations: [{ id: "OrderCreated", kind: "topic", deliveryDelay: messageDeliveryDelay, ackTimeout: 1000, retryDelay: 0, maxAttempts: 3, capacity: 10000 }],
  subscriptions: [{ destination: "OrderCreated", consumer: "payments" }],
};

const behavior = [{ target: "payment-processor", operation: "POST /authorize", behavior: { latency: processorLatency, degradedExtraLatency: 0, dropResponse: false, parameters: {} } }] as const;
const actions = [
  { id: "start-orders", at: 0, kind: "service", target: "orders", state: "RUNNING" },
  { id: "start-payments", at: 0, kind: "service", target: "payments", state: "RUNNING" },
  { id: "checkout-cart-1", at: 0, kind: "client", target: "customer-app", action: "checkout", data: { cartId: "cart-1", customerId: "customer-1", amount: 5000 } },
] as const;
const commonAssertions = [
  { id: "order-created-once", predicate: "mvp.order-created-once", parameters: { orderId: "order-1" }, mode: "eventually", deadline: assertionDeadline },
  { id: "order-created-published-once", predicate: "mvp.order-created-published-once", parameters: { orderId: "order-1", destination: "OrderCreated" }, mode: "eventually", deadline: assertionDeadline },
  { id: "processor-authorized-once", predicate: "mvp.processor-authorized-once", parameters: { orderId: "order-1", amount: 5000 }, mode: "eventually", deadline: assertionDeadline },
] as const;
const configuration = { startTime: 0, historyLimit: 100000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} };

/** The two lessons differ only in recorded scenario inputs, never runtime code. */
export function checkoutScenario(variant: "normal" | "response-lost"): CanonicalValue {
  const lost = variant === "response-lost";
  return {
    version: 1,
    name: lost ? "checkout-processor-response-lost@1" : "checkout-normal@1",
    seed: lost ? "mvp-response-lost-001" : "mvp-normal-001",
    startTime: 0, architecture, external: behavior,
    faults: lost ? [{ id: "drop-first-processor-authorize-response", point: "network.response", source: "payment-processor", target: "payments", name: "POST /authorize", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } }] : [],
    actions,
    assertions: [
      ...commonAssertions,
      ...(lost ? [
        { id: "payments-unknown-after-timeout", predicate: "mvp.payments-unknown", parameters: { orderId: "order-1" }, mode: "eventually" as const, deadline: assertionDeadline },
        { id: "disagreement-inspectable", predicate: "mvp.authorization-disagreement-visible", parameters: { orderId: "order-1" }, mode: "eventually" as const, deadline: assertionDeadline },
      ] : [
        { id: "payments-authorized", predicate: "mvp.payments-authorized", parameters: { orderId: "order-1" }, mode: "eventually" as const, deadline: assertionDeadline },
      ]),
    ], configuration,
  } as CanonicalValue;
}

export const normalCheckout: CanonicalValue = checkoutScenario("normal");
export const responseLostCheckout: CanonicalValue = checkoutScenario("response-lost");

/** Read-only lesson copy; scenario inputs remain the sole source of behavior. */
export const checkoutLesson = {
  normal: {
    title: "Checkout with processor response",
    explanation: "Orders creates the order and publishes OrderCreated. Payments receives the approval and records AUTHORIZED.",
  },
  "response-lost": {
    title: "Checkout with lost processor response",
    explanation: "The processor commits one authorization, but its response is dropped. Payments observes NETWORK_TIMEOUT and records UNKNOWN without an authorization ID.",
  },
} as const;
