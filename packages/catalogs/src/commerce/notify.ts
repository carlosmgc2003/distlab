import type { CanonicalValue, NetworkReply, ServiceDefinition } from "@distlab/contracts";
import { throwSimulationError } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { messagingDescriptor, notifyOrdersDescriptor, notifySenderDescriptor } from "./descriptors.js";
import { ok, record, save, text } from "./common.js";

/**
 * Orders publishes `OrderPlaced` for every checkout. A decoupled Orders
 * confirms the order in the same commit; a coupled one leaves it PENDING and
 * confirms only when `NotificationSent` arrives, so a failing provider blocks it.
 */
export const notifyOrdersModel: ScenarioModel = {
  ...notifyOrdersDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const decoupled = record(instance.configuration).decoupled === true;
    return { id: instance.id, version: instance.version, background: {}, endpoints: {
      "POST /checkout": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        const status = decoupled ? "CONFIRMED" : "PENDING";
        yield* save(ctx, "orders", orderId, { status });
        ctx.log.write("info", "order.placed", { orderId, status });
        yield ctx.events.publish("OrderPlaced", { type: "OrderPlaced", body: { orderId } });
        return ok({ orderId, status });
      },
    }, consumers: {
      NotificationSent: function* (delivery, ctx) {
        const orderId = text(record(delivery.message.body).orderId);
        if (decoupled) {
          ctx.log.write("info", "order.notified", { orderId });
          return;
        }
        yield* save(ctx, "orders", orderId, { status: "CONFIRMED" });
        ctx.log.write("info", "order.confirmed-after-notification", { orderId });
      },
    } };
  },
};

/**
 * The send does not catch a timeout: the uncaught modeled failure NACKs the
 * delivery, and the destination's `maxAttempts` decides when it goes to DEAD.
 * A provider that answers with an error reply (UNAVAILABLE or RATE_LIMITED)
 * rejected the send: the sender rethrows the reply's code, which NACKs the
 * delivery the same way (service-runtime.md, #126).
 */
export const notifySenderModel: ScenarioModel = {
  ...notifySenderDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const provider = peer(notifySenderDescriptor, instance, "provider");
    return { id: instance.id, version: instance.version, endpoints: {}, background: {}, consumers: {
      OrderPlaced: function* (delivery, ctx) {
        const orderId = text(record(delivery.message.body).orderId);
        ctx.log.write("info", "notification.sending", { orderId, attempt: delivery.attempt });
        const reply = (yield ctx.http.request({ target: provider, endpoint: "POST /send", body: { orderId } })) as unknown as NetworkReply;
        if (reply.status !== "ok") {
          const code = text(record(reply.body).code);
          ctx.log.write("warn", "notification.rejected", { orderId, attempt: delivery.attempt, code });
          throwSimulationError(code);
        }
        yield* save(ctx, "notifications", orderId, { orderId, status: "SENT", attempt: delivery.attempt });
        yield ctx.events.publish("NotificationSent", { type: "NotificationSent", body: { orderId } });
        ctx.log.write("info", "notification.sent", { orderId, attempt: delivery.attempt });
      },
    } };
  },
};

/** The provider's declared visible state is the list of messages it accepted. */
export const messagingModel: ScenarioModel = {
  ...messagingDescriptor, checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, initialState: { sent: [] }, operations: {
    "POST /send": { apply(body, state) {
      const sent = [...(record(state).sent as CanonicalValue[]), { orderId: text(record(body).orderId) }];
      return { nextState: { sent }, visibleChanges: { sent }, reply: ok({ status: "SENT" }), callbacks: [] };
    } },
  } }),
};
