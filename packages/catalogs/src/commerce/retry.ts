import type { ServiceDefinition } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { retryDescriptor } from "./descriptors.js";
import { ok, record, text } from "./common.js";

export const retryModel: ScenarioModel = {
  ...retryDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const configuration = record(instance.configuration);
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /pay": function* (body, ctx) {
        const key = text(record(body).idempotencyKey);
        const tx = ctx.db!.begin();
        const previous = tx.get("results", key);
        if (configuration.idempotent === true && previous) {
          tx.rollback();
          ctx.log.write("info", "payment.previous-result", previous);
          return ok(previous);
        }
        const paymentId = `payment-${tx.scan("payments").length + 1}`;
        const result = { paymentId, status: "APPROVED" };
        tx.insert("payments", paymentId, { ...result, orderId: "order-1", amount: 5000 });
        if (configuration.idempotent === true) tx.insert("results", key, result);
        yield tx.commit();
        ctx.log.write("info", "payment.persisted", result);
        return ok(result);
      },
    } };
  },
};
