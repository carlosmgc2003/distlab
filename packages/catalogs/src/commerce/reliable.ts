import type { CanonicalValue, NetworkReply, ServiceDefinition } from "@distlab/contracts";
import { duration, throwSimulationError } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import {
  reliableInventoryDescriptor, reliableNotificationsDescriptor, reliableOrdersDescriptor, reliablePaymentsDescriptor, reliableProcessorDescriptor,
} from "./descriptors.js";
import { ok, record, save, text, timeout } from "./common.js";

/**
 * Reliable Checkout (docs/spec/assessment.md, #97). The assessment's base lesson
 * packages no fault: each suite row adds its own. Every design choice is a
 * behavior option of one model, and its default is the unsafe design.
 */

/** Rethrows a peer's error reply as this handler's own modeled failure (#126). */
function rejected(reply: NetworkReply): never {
  return throwSimulationError(text(record(reply.body).code));
}

/**
 * Orders runs the checkout as an orchestrated saga: reserve, authorize, then
 * confirm. A step that fails or times out leaves the order NEEDS_COMPENSATION,
 * or, with `compensate`, undoes the steps already attempted in reverse order
 * (void, release) and cancels the order. Confirmation commits, waits, and then
 * publishes `OrderConfirmed`; with `outbox` the confirming commit records the
 * event instead, and only `POST /relay` publishes it.
 */
export const reliableOrdersModel: ScenarioModel = {
  ...reliableOrdersDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const configuration = record(instance.configuration);
    const compensate = configuration.compensate === true;
    const useOutbox = configuration.outbox === true;
    const inventory = peer(reliableOrdersDescriptor, instance, "inventory");
    const payments = peer(reliableOrdersDescriptor, instance, "payments");
    const steps = [
      { name: "inventory", target: inventory, forward: "POST /reserve", undo: "POST /release" },
      { name: "payment", target: payments, forward: "POST /authorize", undo: "POST /void" },
    ] as const;
    return { id: instance.id, version: instance.version, consumers: {}, endpoints: {
      "POST /checkout": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        yield* save(ctx, "orders", orderId, { orderId, status: "PENDING" });
        const attempted: (typeof steps)[number][] = [];
        let failure: string | undefined;
        for (const step of steps) {
          attempted.push(step);
          try {
            const reply = (yield ctx.http.request({ target: step.target, endpoint: step.forward, body: { orderId } })) as unknown as NetworkReply;
            if (reply.status !== "ok") failure = `${step.name}-rejected`;
          } catch (error) {
            if (!timeout(error)) throw error;
            // A timeout is ambiguous: the step may have happened, so it is undone like one that did.
            failure = `${step.name}-timeout`;
          }
          if (failure) break;
        }
        if (failure) {
          if (!compensate) {
            yield* save(ctx, "orders", orderId, { orderId, status: "NEEDS_COMPENSATION", failure });
            ctx.log.write("warn", "checkout.needs-compensation", { orderId, failure });
            return ok({ orderId, status: "NEEDS_COMPENSATION" });
          }
          for (const step of [...attempted].reverse()) {
            try {
              yield ctx.http.request({ target: step.target, endpoint: step.undo, body: { orderId } });
            } catch (error) {
              if (!timeout(error)) throw error;
              ctx.log.write("warn", "checkout.compensation-timeout", { orderId, step: step.name });
            }
          }
          yield* save(ctx, "orders", orderId, { orderId, status: "CANCELLED", failure });
          ctx.log.write("info", "checkout.compensated", { orderId, failure });
          return ok({ orderId, status: "CANCELLED" });
        }
        const eventId = `order-confirmed-${orderId}`;
        const confirm = ctx.db!.begin();
        confirm.update("orders", orderId, { orderId, status: "CONFIRMED" });
        if (useOutbox) confirm.insert("outbox", eventId, { eventId, orderId, sent: false });
        yield confirm.commit();
        ctx.log.write("info", "checkout.confirmed", { orderId, outbox: useOutbox });
        // Exposes the real boundary between the local commit and broker publication.
        yield ctx.clock.sleep(duration(10));
        if (!useOutbox) yield ctx.events.publish("OrderConfirmed", { type: "OrderConfirmed", body: { eventId, orderId } });
        return ok({ orderId, status: "CONFIRMED" });
      },
      "POST /relay": (_body, ctx) => {
        // One finite relay pass keeps the lesson runnable to completion.
        ctx.clock.schedule(duration(1), `service.${instance.id}.background`, { name: "relay", data: null });
        return ok({ status: "RELAY_SCHEDULED" });
      },
    }, background: {
      relay: function* (_data, ctx) {
        const read = ctx.db!.begin();
        const pending = read.scan("outbox").filter(entry => entry.row.sent === false);
        read.rollback();
        for (const { key, row } of pending) {
          yield ctx.events.publish("OrderConfirmed", { type: "OrderConfirmed", body: { eventId: text(row.eventId), orderId: text(row.orderId) } });
          const mark = ctx.db!.begin();
          mark.update("outbox", key, { ...row, sent: true });
          yield mark.commit();
          ctx.log.write("info", "outbox.published", { eventId: key });
        }
      },
    } };
  },
};

export const reliableInventoryModel: ScenarioModel = {
  ...reliableInventoryDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    return { id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
      "POST /reserve": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        yield* save(ctx, "reservations", orderId, { orderId, status: "RESERVED" });
        return ok({ orderId, status: "RESERVED" });
      },
      "POST /release": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        const read = ctx.db!.begin();
        const held = read.get("reservations", orderId);
        read.rollback();
        if (held?.status !== "RESERVED") return ok({ orderId, status: "NONE" });
        yield* save(ctx, "reservations", orderId, { orderId, status: "RELEASED" });
        return ok({ orderId, status: "RELEASED" });
      },
    } };
  },
};

/**
 * Payments authorizes through the processor. A timeout is ambiguous: without
 * `retries` Payments gives up at once; with them it sends the authorization
 * again, with the same idempotency key when `idempotent` sends one. Without a
 * key, every retry is a new charge.
 */
export const reliablePaymentsModel: ScenarioModel = {
  ...reliablePaymentsDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const configuration = record(instance.configuration);
    const retries = typeof configuration.retries === "number" ? configuration.retries : 0;
    const idempotent = configuration.idempotent === true;
    const processor = peer(reliablePaymentsDescriptor, instance, "processor");
    return { id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
      "POST /authorize": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        const request = { orderId, ...(idempotent ? { idempotencyKey: orderId } : {}) };
        for (let attempt = 1; ; attempt++) {
          try {
            const reply = (yield ctx.http.request({ target: processor, endpoint: "POST /authorize", body: request })) as unknown as NetworkReply;
            if (reply.status !== "ok") rejected(reply);
            const authorizationId = text(record(reply.body).authorizationId);
            yield* save(ctx, "payments", orderId, { orderId, authorizationId, status: "AUTHORIZED", attempts: attempt });
            return ok({ orderId, authorizationId, status: "AUTHORIZED" });
          } catch (error) {
            if (!timeout(error)) throw error;
            ctx.log.write("warn", "payment.ambiguous-timeout", { orderId, attempt });
            if (attempt > retries) {
              yield* save(ctx, "payments", orderId, { orderId, authorizationId: null, status: "UNKNOWN", attempts: attempt });
              throw error;
            }
          }
        }
      },
      "POST /void": function* (body, ctx) {
        const orderId = text(record(body).orderId);
        const reply = (yield ctx.http.request({ target: processor, endpoint: "POST /void", body: { orderId } })) as unknown as NetworkReply;
        if (reply.status !== "ok") rejected(reply);
        const read = ctx.db!.begin();
        const payment = read.get("payments", orderId);
        read.rollback();
        yield* save(ctx, "payments", orderId, { ...(payment ?? { orderId, authorizationId: null, attempts: 0 }), status: "VOIDED" });
        return ok({ orderId, status: "VOIDED" });
      },
    } };
  },
};

/**
 * The processor's visible state is every authorization it holds. A request
 * with an idempotency key that already has an authorization gets that one back
 * and charges nothing new.
 */
export const reliableProcessorModel: ScenarioModel = {
  ...reliableProcessorDescriptor, checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, initialState: { authorizations: [] }, operations: {
    "POST /authorize": { apply(body, state) {
      const request = record(body);
      const orderId = text(request.orderId);
      const key = typeof request.idempotencyKey === "string" ? request.idempotencyKey : null;
      const entries = record(state).authorizations as readonly CanonicalValue[];
      const previous = key === null ? undefined : entries.map(record).find(entry => entry.idempotencyKey === key);
      if (previous) {
        return { nextState: { authorizations: entries }, visibleChanges: { authorizations: entries },
          reply: ok({ authorizationId: previous.authorizationId!, status: previous.status!, replayed: true }), callbacks: [] };
      }
      const authorizationId = `authorization-${entries.length + 1}`;
      const authorizations = [...entries, { authorizationId, orderId, idempotencyKey: key, status: "APPROVED" }];
      return { nextState: { authorizations }, visibleChanges: { authorizations }, reply: ok({ authorizationId, status: "APPROVED" }), callbacks: [] };
    } },
    "POST /void": { apply(body, state) {
      const orderId = text(record(body).orderId);
      const entries = record(state).authorizations as readonly CanonicalValue[];
      const authorizations = entries.map(record).map(entry => entry.orderId === orderId && entry.status === "APPROVED" ? { ...entry, status: "VOIDED" } : entry);
      const voided = entries.map(record).filter(entry => entry.orderId === orderId && entry.status === "APPROVED").length;
      return { nextState: { authorizations }, visibleChanges: { authorizations }, reply: ok({ orderId, voided }), callbacks: [] };
    } },
  } }),
};

/**
 * Notifications sends one message per `OrderConfirmed`. A provider rejection
 * (UNAVAILABLE, RATE_LIMITED) or a send timeout NACKs the delivery, so the bus
 * redelivers it (#126). With `idempotent`, the inbox records each processed
 * event ID with its notification, and a repeated event is acknowledged unsent.
 * The acknowledgement trails the recorded send by 5 ms.
 */
export const reliableNotificationsModel: ScenarioModel = {
  ...reliableNotificationsDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const idempotent = record(instance.configuration).idempotent === true;
    const provider = peer(reliableNotificationsDescriptor, instance, "provider");
    return { id: instance.id, version: instance.version, endpoints: {}, background: {}, consumers: {
      OrderConfirmed: function* (delivery, ctx) {
        const event = record(delivery.message.body);
        const eventId = text(event.eventId);
        const orderId = text(event.orderId);
        if (idempotent) {
          const read = ctx.db!.begin();
          const seen = read.get("inbox", eventId);
          read.rollback();
          if (seen) {
            ctx.log.write("info", "consumer.duplicate-ignored", { eventId });
            return;
          }
        }
        const reply = (yield ctx.http.request({ target: provider, endpoint: "POST /send", body: { orderId } })) as unknown as NetworkReply;
        if (reply.status !== "ok") {
          ctx.log.write("warn", "notification.rejected", { orderId, attempt: delivery.attempt, code: text(record(reply.body).code) });
          rejected(reply);
        }
        const tx = ctx.db!.begin();
        // Keyed by delivery, so concurrent copies never contend for one row.
        tx.insert("notifications", delivery.deliveryId, { orderId, eventId, attempt: delivery.attempt });
        if (idempotent && !tx.get("inbox", eventId)) tx.insert("inbox", eventId, { eventId });
        yield tx.commit();
        ctx.log.write("info", "notification.sent", { orderId, eventId, attempt: delivery.attempt });
        // Finishing the delivery takes a moment, so the acknowledgement trails the recorded send: a
        // copy of the event that arrives in between finds the send already recorded, as a redelivery would.
        yield ctx.clock.sleep(duration(5));
      },
    } };
  },
};
