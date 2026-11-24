import type { ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { notificationDescriptor, outboxDescriptor } from "./descriptors.js";
import { ok, record, text } from "./common.js";

/**
 * Payments approves order-1 and answers the customer as soon as the payment
 * commits. With `outbox`, the same commit records the PaymentApproved event and
 * only the relay publishes it. Without it (a dual write), Payments publishes the
 * event 10 ms after the commit, in its own background task: the window in which
 * a crash loses the event although the customer was told APPROVED.
 */
export const outboxModel: ScenarioModel = {
  ...outboxDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const useOutbox = record(instance.configuration).outbox === true;
    const event = { eventId: "payment-approved-1", orderId: "order-1" };
    return { id: instance.id, version: instance.version, consumers: {}, endpoints: {
      "POST /pay": function* (_body, ctx) {
        const tx = ctx.db!.begin();
        tx.insert("payments", "order-1", { status: "APPROVED", amount: 5000 });
        if (useOutbox) tx.insert("outbox", event.eventId, { ...event, sent: false });
        yield tx.commit();
        ctx.log.write("info", "payment.approved", { orderId: event.orderId, event: useOutbox ? "in-outbox" : "publish-pending" });
        // Exposes the real boundary between a local commit and broker publication.
        if (!useOutbox) ctx.clock.schedule(duration(10), `service.${instance.id}.background`, { name: "publish", data: null });
        return ok({ status: "APPROVED" });
      },
      "POST /relay": (_body, ctx) => {
        // A finite maintenance tick keeps the lesson runnable to completion.
        ctx.clock.schedule(duration(1), `service.${instance.id}.background`, { name: "relay", data: null });
        return ok({ status: "RELAY_SCHEDULED" });
      },
    }, background: {
      publish: function* (_data, ctx) {
        yield ctx.events.publish("PaymentApproved", { type: "PaymentApproved", body: event });
        ctx.log.write("info", "payment.event-published", { eventId: event.eventId });
      },
      relay: function* (_data, ctx) {
        const read = ctx.db!.begin();
        const pending = read.scan("outbox").filter(entry => entry.row.sent === false);
        read.rollback();
        // What the restarted service knows it still owes: a dual write has no record of it.
        ctx.log.write("info", "outbox.relay", { pending: pending.length });
        for (const { key, row } of pending) {
          yield ctx.events.publish("PaymentApproved", { type: "PaymentApproved", body: { eventId: text(row.eventId), orderId: text(row.orderId) } });
          const mark = ctx.db!.begin();
          mark.update("outbox", key, { ...row, sent: true });
          yield mark.commit();
          ctx.log.write("info", "outbox.published", { eventId: key });
        }
      },
    } };
  },
};
export const notificationModel: ScenarioModel = {
  ...notificationDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    return { id: instance.id, version: instance.version, endpoints: {}, background: {}, consumers: {
      PaymentApproved: function* (delivery, ctx) {
        const event = record(delivery.message.body);
        const eventId = text(event.eventId);
        const tx = ctx.db!.begin();
        if (record(instance.configuration).idempotent === true && tx.get("inbox", eventId)) {
          tx.rollback();
          ctx.log.write("info", "consumer.duplicate-ignored", { eventId });
          return;
        }
        tx.insert("notifications", `notification-${tx.scan("notifications").length + 1}`, { orderId: text(event.orderId), eventId });
        if (record(instance.configuration).idempotent === true) tx.insert("inbox", eventId, { eventId });
        yield tx.commit();
        ctx.log.write("info", "notification.created", { eventId });
        // Keep acknowledgement pending long enough for the injected copy to arrive.
        yield ctx.clock.sleep(duration(5));
      },
    } };
  },
};
