import type { NetworkReply, ServiceDefinition } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { dependencyDescriptor, riskDescriptor } from "./descriptors.js";
import { ok, record, timeout } from "./common.js";

/** A catalog policy, not a new network primitive. One half-open probe at a time. */
export const dependencyModel: ScenarioModel = {
  ...dependencyDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const config = record(instance.configuration);
    const target = peer(dependencyDescriptor, instance, "target");
    const protectedDependency = config.breaker === true;
    let state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
    let openedAt = 0, failures = 0, active = 0, peakActive = 0, calls = 0, rejected = 0, failed = 0, succeeded = 0, totalWait = 0;
    const metrics = () => ({ state, calls, rejected, failed, succeeded, active, peakActive, totalWait });
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /check": function* (_body, ctx) {
        const started = ctx.clock.now();
        if (calls === 0 && rejected === 0 && protectedDependency) ctx.log.write("info", "breaker.state", { state });
        if (protectedDependency && state === "OPEN" && started - openedAt >= 30) {
          state = "HALF_OPEN";
          ctx.log.write("info", "breaker.state", { state });
        } else if (protectedDependency && state !== "CLOSED") {
          rejected++;
          ctx.kv!.set("dependency", metrics());
          ctx.log.write("warn", "breaker.rejected", { state, rejected });
          return ok({ status: "UNAVAILABLE", reason: "CIRCUIT_OPEN" });
        }
        calls++;
        active++;
        peakActive = Math.max(peakActive, active);
        ctx.kv!.set("dependency", metrics());
        ctx.log.write("info", "dependency.waiting", { active, peakActive, target });
        let result: NetworkReply;
        try {
          result = (yield ctx.http.request({ target, endpoint: "POST /check", body: {} })) as unknown as NetworkReply;
        } catch (error) {
          if (!timeout(error)) throw error;
          result = ok({ status: "UNAVAILABLE", reason: "TIMEOUT" });
        }
        const success = record(result.body).status === "APPROVED";
        active--;
        totalWait += ctx.clock.now() - started;
        if (success) {
          succeeded++;
          failures = 0;
          if (protectedDependency && state === "HALF_OPEN") {
            state = "CLOSED";
            ctx.log.write("info", "breaker.state", { state });
          }
        } else {
          failed++;
          failures++;
          if (protectedDependency && (state === "HALF_OPEN" || (state === "CLOSED" && failures >= 2))) {
            state = "OPEN";
            openedAt = ctx.clock.now();
            ctx.log.write("warn", "breaker.state", { state });
          }
        }
        // Metrics must not introduce DB contention into the dependency experiment.
        ctx.kv!.set("dependency", metrics());
        ctx.log.write("info", "dependency.completed", { ...metrics(), elapsed: ctx.clock.now() - started });
        return result;
      },
    } };
  },
};
export const riskModel: ScenarioModel = {
  ...riskDescriptor, checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, initialState: {}, operations: {
    "POST /check": { apply: () => ({ nextState: {}, visibleChanges: {}, reply: ok({ status: "APPROVED" }), callbacks: [] }) },
  } }),
};
