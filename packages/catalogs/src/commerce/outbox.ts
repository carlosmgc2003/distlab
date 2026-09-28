import type { ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { ok, record, text } from "./common.js";

export const outboxModel: ScenarioModel = {
  model: "commerce.outbox-payment", version: "1.0.0", kind: "service", actions: [], endpoints: ["POST /pay", "POST /relay"], consumers: [], operations: [], checks: {},
  instantiate(instance): ServiceDefinition {
    const useOutbox = record(instance.configuration).outbox === true;
    return { id: instance.id, version: instance.version, consumers: {}, endpoints: {
      "POST /pay": function* (_body, ctx) {
        const tx = ctx.db!.begin();
        tx.insert("payments", "order-1", { status: "APPROVED", amount: 5000 });
        if (useOutbox) tx.insert("outbox", "payment-approved-1", { eventId: "payment-approved-1", orderId: "order-1", sent: false });
        yield tx.commit();
        // Exposes the real boundary between a local commit and broker publication.
        yield ctx.clock.sleep(duration(10));
        if (!useOutbox) yield ctx.events.publish("PaymentApproved", { type: "PaymentApproved", body: { eventId: "payment-approved-1", orderId: "order-1" } });
        return ok({ status: "APPROVED" });
      },
      "POST /relay": (_body, ctx) => {
        // A finite maintenance tick keeps the lesson runnable to completion.
        ctx.clock.schedule(duration(1), `service.${instance.id}.background`, { name: "relay", data: null });
        return ok({ status: "RELAY_SCHEDULED" });
      },
    }, background: {
      relay: function* (_data, ctx) {
        const read = ctx.db!.begin();
        const pending = read.scan("outbox").filter(entry => entry.row.sent === false);
        read.rollback();
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
  model: "commerce.notifications", version: "1.0.0", kind: "service", actions: [], endpoints: [], consumers: ["PaymentApproved"], operations: [], checks: {},
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
