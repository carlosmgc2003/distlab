import type { ServiceDefinition } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { ok, record, save } from "./common.js";

export const orderWriteModel: ScenarioModel = {
  model: "commerce.order-write", version: "1.0.0", kind: "service", actions: [], endpoints: ["POST /paid", "GET /order"], consumers: [], operations: [], checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
    "POST /paid": function* (_body, ctx) {
      yield* save(ctx, "orders", "order-1", { status: "PAID", version: 1 });
      yield ctx.events.publish("OrderUpdated", { type: "OrderUpdated", body: { orderId: "order-1", status: "PAID", version: 1 } });
      return ok({ status: "PAID" });
    },
    "GET /order": (_body, ctx) => {
      const tx = ctx.db!.begin();
      const row = tx.get("orders", "order-1")!;
      tx.rollback();
      ctx.log.write("info", "cqrs.write-read", row);
      return ok(row);
    },
  } } satisfies ServiceDefinition),
};
export const orderReadModel: ScenarioModel = {
  model: "commerce.order-read", version: "1.0.0", kind: "service", actions: [], endpoints: ["GET /order"], consumers: ["OrderUpdated"], operations: [], checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, background: {}, endpoints: {
    "GET /order": (_body, ctx) => {
      const tx = ctx.db!.begin();
      const row = tx.get("orders", "order-1")!;
      tx.rollback();
      ctx.log.write("info", "cqrs.projection-read", row);
      return ok(row);
    },
  }, consumers: {
    OrderUpdated: function* (delivery, ctx) {
      const update = record(delivery.message.body);
      yield* save(ctx, "orders", "order-1", { status: update.status!, version: update.version! });
      ctx.log.write("info", "cqrs.converged", { status: update.status! });
    },
  } } satisfies ServiceDefinition),
};
