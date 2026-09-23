import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicServiceRuntime, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { simulationTime } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";

/** Headless fixture: orders publishes OrderCreated and billing consumes it. */
export const golden04Inputs: RunInputs = {
  contractVersion: 1,
  modelVersions: { "kernel.message-bus": "1", "fixture.golden-04": "1" },
  architecture: { components: ["orders", "billing"] },
  scenario: { id: "golden-04", actions: ["publish", "consume"] },
  configuration: {
    startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {},
  },
  seed: "golden-04",
};

interface GoldenState {
  messageId: string;
  deliveryId: string;
  orderId: string;
}

export function createGolden04() {
  let state: GoldenState = { messageId: "", deliveryId: "", orderId: "" };
  const simulation = new HeadlessSimulationFactory({
    network: { targets: ["orders", "billing"], links: [] },
    messageBus: { destinations: [{ id: "orders", kind: "topic" }] },
  }).createSimulation(golden04Inputs, setup => {
    state = { messageId: "", deliveryId: "", orderId: "" };
    const common = { setup, taskLifecycle: () => simulation.taskLifecycle, activeOwner: () => simulation.activeTaskOwner, busController: setup.messageBusController() };
    const orders = new DeterministicServiceRuntime({ ...common, id: "orders", version: "1", events: setup.messageBusFor("orders"),
      resolve: () => ({ id: "orders", version: "1", endpoints: {}, consumers: {}, background: { publish: function* (_, ctx): ControlledTask {
        const accepted = (yield ctx.events.publish("orders", { type: "OrderCreated", body: { orderId: "o1" } })) as { messageId: string };
        state.messageId = accepted.messageId;
      } } }) });
    const billing = new DeterministicServiceRuntime({ ...common, id: "billing", version: "1", events: setup.messageBusFor("billing"),
      resolve: () => ({ id: "billing", version: "1", endpoints: {}, background: {}, consumers: { orders: delivery => {
        state.deliveryId = delivery.deliveryId;
        const body = delivery.message.body as { orderId: string };
        state.orderId = body.orderId;
      } } }) });
    setup.schedule({ time: simulationTime(0), type: orders.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(0), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: orders.backgroundEventType, payload: { name: "publish", data: null } });
  });
  return { simulation, snapshot: () => canonicalCopy(state) as unknown as GoldenState };
}

export function golden04Result(fixture: ReturnType<typeof createGolden04>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot();
  const history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

// Usage: node --experimental-strip-types packages/kernel/examples/golden-04.ts
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden04();
  await fixture.simulation.run();
  process.stdout.write(`${JSON.stringify(golden04Result(fixture), null, 2)}\n`);
}
