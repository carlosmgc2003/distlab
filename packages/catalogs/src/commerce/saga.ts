import type { NetworkReply, ServiceContext, ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { carrierDescriptor, sagaDescriptor, sagaResourceDescriptor } from "./descriptors.js";
import { ok, record, save, text, timeout } from "./common.js";

/**
 * A saga participant. `forward` and `compensated` are the rows it saves for
 * `order-1`; `events` names the business log of each, so the Story says what the
 * step did ("inventory.reserved", "payment.refunded"). A failed commit ends the
 * handler with its modeled code, which the caller receives as an error reply.
 */
export const sagaResourceModel: ScenarioModel = {
  ...sagaResourceDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const config = record(instance.configuration);
    const events = record(config.events!);
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /apply": function* (_body, ctx) {
        yield* save(ctx, "state", "order-1", record(config.forward!));
        ctx.log.write("info", text(events.forward), { orderId: "order-1" });
        return ok({ status: "DONE" });
      },
      "POST /compensate": function* (_body, ctx) {
        yield* save(ctx, "state", "order-1", record(config.compensated!));
        ctx.log.write("info", text(events.compensated), { orderId: "order-1" });
        return ok({ status: "COMPENSATED" });
      },
    } };
  },
};

type Outcome = "ok" | "rejected" | "timeout";

/** One saga request: a reply that is not ok is a rejection, a timeout is ambiguous. */
function* call(ctx: ServiceContext, target: string, endpoint: string) {
  try {
    const reply = (yield ctx.http.request({ target, endpoint, body: { orderId: "order-1" } })) as unknown as NetworkReply;
    return (reply.status === "ok" ? "ok" : "rejected") as Outcome;
  } catch (error) {
    if (!timeout(error)) throw error;
    return "timeout" as Outcome;
  }
}

/**
 * The orchestrator. It creates the order, reserves inventory, approves the
 * payment, and ships. When any step is rejected or times out, the order needs
 * compensation. With `compensate`, Orders waits 10 ms (a deliberate window in
 * which the inconsistent state can be inspected), then undoes in reverse order
 * every step that completed or may have completed (a timeout is ambiguous), and
 * cancels the order. A compensation that fails stops the rest: the order stays
 * NEEDS_COMPENSATION. The customer's reply carries the order's status.
 */
export const sagaModel: ScenarioModel = {
  ...sagaDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const steps = [
      { step: "reserve-inventory", target: peer(sagaDescriptor, instance, "inventory") },
      { step: "approve-payment", target: peer(sagaDescriptor, instance, "payments") },
    ];
    const carrier = peer(sagaDescriptor, instance, "carrier");
    const compensate = record(instance.configuration).compensate === true;
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /checkout": function* (_body, ctx) {
        const orderId = "order-1";
        yield* save(ctx, "orders", orderId, { status: "CREATED" });
        ctx.log.write("info", "order.created", { orderId });
        const undo: typeof steps = [];
        let failure: { step: string; reason: Outcome } | undefined;
        for (const item of steps) {
          const outcome = yield* call(ctx, item.target, "POST /apply");
          if (outcome !== "rejected") undo.push(item);
          if (outcome !== "ok") { failure = { step: item.step, reason: outcome }; break; }
        }
        if (!failure) {
          const outcome = yield* call(ctx, carrier, "POST /ship");
          if (outcome === "ok") {
            yield* save(ctx, "orders", orderId, { status: "CONFIRMED" });
            ctx.log.write("info", "order.confirmed", { orderId });
            return ok({ orderId, status: "CONFIRMED" });
          }
          failure = { step: "ship-order", reason: outcome };
        }
        const toUndo = [...undo].reverse();
        yield* save(ctx, "orders", orderId, { status: "NEEDS_COMPENSATION" });
        ctx.log.write("warn", "order.needs-compensation", { orderId, failedStep: failure.step, reason: failure.reason, toUndo: toUndo.map(item => item.step) });
        if (!compensate) return ok({ orderId, status: "NEEDS_COMPENSATION" });
        yield ctx.clock.sleep(duration(10));
        for (const item of toUndo) {
          const outcome = yield* call(ctx, item.target, "POST /compensate");
          if (outcome !== "ok") {
            ctx.log.write("warn", "compensation.failed", { orderId, step: item.step, reason: outcome });
            return ok({ orderId, status: "NEEDS_COMPENSATION" });
          }
        }
        yield* save(ctx, "orders", orderId, { status: "CANCELLED" });
        ctx.log.write("info", "order.cancelled", { orderId });
        return ok({ orderId, status: "CANCELLED" });
      },
    } };
  },
};

export const carrierModel: ScenarioModel = {
  ...carrierDescriptor, checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, initialState: {}, operations: {
    "POST /ship": { apply(body) {
      const orderId = text(record(body).orderId);
      return { nextState: { orderId }, visibleChanges: { orderId }, reply: ok({ status: "SHIPPED" }), callbacks: [] };
    } },
  } }),
};
