import type { ModelDescriptor } from "@distlab/contracts";

/**
 * Data-only descriptors of the checkout catalog models (ADR-005). The main
 * thread may import this module; the worker's catalog builds each
 * `ScenarioModel` from these plus its `checks` and `instantiate`.
 */

const VERSION = "1.0.0";
const none = { actions: [], endpoints: [], consumers: [], operations: [], publishes: [], peers: [], storage: {}, options: [] } as const;

export const customerAppDescriptor: ModelDescriptor = {
  ...none, model: "distlab.customer-app", version: VERSION, kind: "client", actions: ["checkout"],
  peers: [{ name: "orders", kinds: ["service"], calls: ["POST /orders"], default: "orders" }],
};

export const ordersDescriptor: ModelDescriptor = {
  ...none, model: "distlab.orders", version: VERSION, kind: "service", endpoints: ["POST /orders"], publishes: ["OrderCreated"],
  storage: { database: { tables: [{ name: "orders", unique: [["orderId"]], checks: [] }, { name: "outbox", unique: [["messageId"]], checks: [] }] } },
};

export const paymentsDescriptor: ModelDescriptor = {
  ...none, model: "distlab.payments", version: VERSION, kind: "service", consumers: ["OrderCreated"],
  peers: [{ name: "processor", kinds: ["external"], calls: ["POST /authorize"], default: "payment-processor" }],
  storage: { database: { tables: [{ name: "payments", unique: [["paymentId"]], checks: [] }, { name: "inbox", unique: [["messageId"]], checks: [] }] } },
};

export const paymentProcessorDescriptor: ModelDescriptor = {
  ...none, model: "distlab.payment-processor", version: VERSION, kind: "external", operations: ["POST /authorize"],
};

export const checkoutDescriptors: readonly ModelDescriptor[] = [customerAppDescriptor, ordersDescriptor, paymentsDescriptor, paymentProcessorDescriptor];
