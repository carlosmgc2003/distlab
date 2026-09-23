import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicClientRuntime, DeterministicServiceRuntime, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { RunInputs } from "@distlab/contracts/kernel";
import type { MessageBus } from "@distlab/contracts";

/** Headless client request, service callback, and correlated observation fixture. */
export const golden02Inputs: RunInputs = {
  contractVersion: 1,
  modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1", "fixture.golden-02": "1", client: "1", service: "1" },
  architecture: { components: ["client", "service"] },
  scenario: { id: "golden-02", actions: ["place"] },
  configuration: { startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
  seed: "distlab",
};

const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };

export function createGolden02() {
  let client!: DeterministicClientRuntime;
  let commits = 0;
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service" }, { source: "service", target: "client" },
  ] } }).createSimulation(golden02Inputs, setup => {
    commits = 0;
    const service = new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => ({ id: "service", version: "1", consumers: {}, background: {}, endpoints: {
        "POST /orders": function* (body, ctx) {
          commits++;
          ctx.log.write("info", "order committed", body);
          yield ctx.http.request({ target: "client", endpoint: "order-notice", body });
          return { status: "ok" as const, body: { accepted: true } };
        },
      } }), taskLifecycle: () => simulation.taskLifecycle, activeOwner: () => simulation.activeTaskOwner, events });
    client = new DeterministicClientRuntime({ id: "client", version: "1", setup,
      scenarioEventType: "scenario.client.action", activeOwner: () => simulation.activeTaskOwner,
      activeEvent: () => simulation.activeEvent,
      resolve: () => ({ id: "client", version: "1", initialState: { pending: null }, actions: {
        place: function* (body, ctx) {
          ctx.state.set("pending", body);
          const result = yield ctx.http.request({ target: "service", endpoint: "POST /orders", body });
          ctx.state.set("pending", null);
          return result as never;
        },
      }, callbacks: {
        "order-notice": (body, ctx) => {
          ctx.state.set("last-notice", body);
          return { status: "ok", body: { received: true } };
        },
      } }),
    });
    setup.registerHandler("scenario.client.action", "client", (event, context) =>
      client.dispatch(event, context, controller => controller.start("place-1", "place", { orderId: "o1", idempotencyKey: "k1" })));
    setup.schedule({ time: simulationTime(0), type: service.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "scenario.client.action", payload: null });
  });
  return { simulation, snapshot: () => canonicalCopy({ client: client.inspect(), service: { commits } }) };
}

export function golden02Result(fixture: ReturnType<typeof createGolden02>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot();
  const history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

// Usage: npm run build && node --experimental-strip-types packages/kernel/examples/golden-02.ts
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden02();
  await fixture.simulation.run();
  process.stdout.write(`${JSON.stringify(golden02Result(fixture), null, 2)}\n`);
}
