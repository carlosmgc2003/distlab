import type { CanonicalValue, ClientDefinition, ComponentInstance, DatabaseRow, ExternalDefinition, NetworkReply, ServiceDefinition } from "@distlab/contracts";
import { ErrorCodes } from "@distlab/contracts/kernel";
import type { ScenarioCatalog, ScenarioModel } from "@distlab/scenario";

const VERSION = "1.0.0";

function object(value: CanonicalValue): Record<string, CanonicalValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid checkout payload");
  return value as Record<string, CanonicalValue>;
}
function field(record: Record<string, CanonicalValue>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${name}`);
  return value;
}
function amount(record: Record<string, CanonicalValue>): number {
  const value = record.amount;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid amount");
  return value;
}
function dbRow(value: DatabaseRow | undefined): Record<string, CanonicalValue> {
  if (!value) throw new Error("Missing checkout row");
  return value as Record<string, CanonicalValue>;
}

function customerApp(instance: ComponentInstance): ClientDefinition {
  return { id: instance.id, version: instance.version, callbacks: {}, initialState: { request: null, outcome: null }, actions: {
    checkout: function* (data, ctx) {
      const request = object(data);
      const body = { cartId: field(request, "cartId"), customerId: field(request, "customerId"), amount: amount(request) };
      ctx.state.set("request", body);
      const reply = (yield ctx.http.request({ target: "orders", endpoint: "POST /orders", body })) as unknown as NetworkReply;
      ctx.state.set("outcome", reply.body);
      return reply.body;
    },
  } };
}

function orders(instance: ComponentInstance): ServiceDefinition {
  let nextOrder = 0;
  return { id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
    "POST /orders": function* (body, ctx) {
      const request = object(body);
      const cartId = field(request, "cartId");
      const customerId = field(request, "customerId");
      const total = amount(request);
      const orderId = `order-${++nextOrder}`;
      const messageId = `order-created-${nextOrder}`;
      const tx = ctx.db!.begin();
      tx.insert("orders", orderId, { orderId, cartId, customerId, amount: total, state: "CREATED" });
      tx.insert("outbox", messageId, { messageId, orderId, destination: "OrderCreated" });
      yield tx.commit();
      yield ctx.events.publish("OrderCreated", { type: "OrderCreated", body: { orderId, customerId, amount: total } });
      return { status: "ok" as const, body: { orderId, state: "CREATED" } };
    },
  } };
}

function payments(instance: ComponentInstance): ServiceDefinition {
  let nextPayment = 0;
  return { id: instance.id, version: instance.version, endpoints: {}, background: {}, consumers: {
    OrderCreated: function* (delivery, ctx) {
      const message = object(delivery.message.body);
      const orderId = field(message, "orderId");
      const customerId = field(message, "customerId");
      const total = amount(message);
      const tx = ctx.db!.begin();
      if (tx.get("inbox", delivery.messageId)) { tx.rollback(); return; }
      const paymentId = `payment-${++nextPayment}`;
      tx.insert("inbox", delivery.messageId, { messageId: delivery.messageId, orderId });
      tx.insert("payments", paymentId, { paymentId, orderId, customerId, amount: total, state: "AUTHORIZING", authorizationId: null, outcome: null });
      yield tx.commit();
      let nextState: "AUTHORIZED" | "UNKNOWN";
      let authorizationId: string | null = null;
      let outcome: string;
      try {
        const reply = (yield ctx.http.request({ target: "payment-processor", endpoint: "POST /authorize", body: { paymentId, orderId, amount: total } })) as unknown as NetworkReply;
        if (reply.status !== "ok") throw new Error("Processor rejected authorization");
        const response = object(reply.body);
        if (response.status !== "APPROVED") throw new Error("Processor did not approve");
        authorizationId = field(response, "authorizationId");
        nextState = "AUTHORIZED";
        outcome = "APPROVED";
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === ErrorCodes.NETWORK_TIMEOUT)) throw error;
        nextState = "UNKNOWN";
        outcome = ErrorCodes.NETWORK_TIMEOUT;
      }
      const update = ctx.db!.begin();
      update.update("payments", paymentId, { ...dbRow(update.get("payments", paymentId)), state: nextState, authorizationId, outcome });
      yield update.commit();
    },
  } };
}

function processor(instance: ComponentInstance): ExternalDefinition {
  return { id: instance.id, version: instance.version, initialState: { authorizations: [] }, operations: {
    "POST /authorize": { apply(body, state) {
      const request = object(body);
      const paymentId = field(request, "paymentId");
      const orderId = field(request, "orderId");
      const total = amount(request);
      const entries = (object(state).authorizations as readonly CanonicalValue[]);
      const authorizationId = `authorization-${entries.length + 1}`;
      const authorization = { authorizationId, paymentId, orderId, amount: total, status: "APPROVED" };
      const authorizations = [...entries, authorization];
      return { nextState: { authorizations }, reply: { status: "ok", body: { authorizationId, status: "APPROVED" } },
        visibleChanges: { authorizations }, callbacks: [] };
    } },
  } };
}

const models: readonly ScenarioModel[] = [
  { model: "distlab.customer-app", version: VERSION, kind: "client", actions: ["checkout"], endpoints: [], consumers: [], operations: [], checks: {}, instantiate: customerApp },
  { model: "distlab.orders", version: VERSION, kind: "service", actions: [], endpoints: ["POST /orders"], consumers: [], operations: [], checks: {}, instantiate: orders },
  { model: "distlab.payments", version: VERSION, kind: "service", actions: [], endpoints: [], consumers: ["OrderCreated"], operations: [], checks: {}, instantiate: payments },
  { model: "distlab.payment-processor", version: VERSION, kind: "external", actions: [], endpoints: [], consumers: [], operations: ["POST /authorize"], checks: {}, instantiate: processor },
];

export const checkoutCatalog: ScenarioCatalog = {
  id: "mvp.checkout", version: VERSION,
  find: (name, version) => models.find(model => model.model === name && model.version === version),
  versions: name => models.filter(model => model.model === name).map(model => model.version),
};
