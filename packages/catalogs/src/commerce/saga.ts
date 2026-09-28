import type { NetworkReply, ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { ok, record, save, text, timeout } from "./common.js";

export const sagaResourceModel: ScenarioModel = {
  model: "commerce.saga-resource", version: "1.0.0", kind: "service", actions: [], endpoints: ["POST /apply", "POST /compensate"], consumers: [], operations: [], checks: {},
  instantiate(instance): ServiceDefinition {
    const config = record(instance.configuration);
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /apply": function* (_body, ctx) {
        yield* save(ctx, "state", "order-1", record(config.forward!));
        ctx.log.write("info", "saga.forward", { component: instance.id });
        return ok({ status: "DONE" });
      },
      "POST /compensate": function* (_body, ctx) {
        yield* save(ctx, "state", "order-1", record(config.compensated!));
        ctx.log.write("info", "saga.compensation", { component: instance.id });
        return ok({ status: "COMPENSATED" });
      },
    } };
  },
};
export const sagaModel: ScenarioModel = {
  model: "commerce.saga", version: "1.0.0", kind: "service", actions: [], endpoints: ["POST /checkout"], consumers: [], operations: [], checks: {},
  instantiate(instance): ServiceDefinition {
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /checkout": function* (_body, ctx) {
        yield* save(ctx, "orders", "order-1", { status: "CREATED" });
        ctx.log.write("info", "saga.forward", { component: "orders" });
        for (const target of ["inventory", "payments"]) {
          const reply = (yield ctx.http.request({ target, endpoint: "POST /apply", body: { orderId: "order-1" } })) as unknown as NetworkReply;
          if (reply.status !== "ok") throw new Error(`Unexpected ${target} failure`);
        }
        try {
          yield ctx.http.request({ target: "carrier", endpoint: "POST /ship", body: { orderId: "order-1" } });
          yield* save(ctx, "orders", "order-1", { status: "CONFIRMED" });
        } catch (error) {
          if (!timeout(error)) throw error;
          yield* save(ctx, "orders", "order-1", { status: "NEEDS_COMPENSATION" });
          ctx.log.write("warn", "saga.inconsistent", { order: "NEEDS_COMPENSATION", inventory: "RESERVED", payment: "APPROVED" });
          if (record(instance.configuration).compensate === true) {
            // Deliberate inspection window, not an atomic distributed rollback.
            yield ctx.clock.sleep(duration(10));
            for (const target of ["payments", "inventory"]) {
              yield ctx.http.request({ target, endpoint: "POST /compensate", body: { orderId: "order-1" } });
            }
            yield* save(ctx, "orders", "order-1", { status: "CANCELLED" });
            ctx.log.write("info", "saga.compensation", { component: "orders" });
          }
        }
        return ok({ status: "WORKFLOW_FINISHED" });
      },
    } };
  },
};
export const carrierModel: ScenarioModel = {
  model: "commerce.carrier", version: "1.0.0", kind: "external", actions: [], endpoints: [], consumers: [], operations: ["POST /ship"], checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, initialState: {}, operations: {
    "POST /ship": { apply(body) {
      const orderId = text(record(body).orderId);
      return { nextState: { orderId }, visibleChanges: { orderId }, reply: ok({ status: "SHIPPED" }), callbacks: [] };
    } },
  } }),
};
