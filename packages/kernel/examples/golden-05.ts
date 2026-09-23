import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicFaultEngine, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { FaultDecisionPort } from "@distlab/contracts";

export const golden05Inputs: RunInputs = {
  contractVersion: 1, modelVersions: { "kernel.fault-engine": "1", "fixture.golden-05": "1" },
  architecture: { components: ["orders", "billing"] }, scenario: { id: "golden-05", actions: ["publish", "duplicate"] },
  configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
  seed: "golden-05",
};

export function createGolden05() {
  let deliveries: string[] = [], messageId = "";
  let engine!: DeterministicFaultEngine;
  const faults: FaultDecisionPort = { evaluate: probe => engine.evaluate(probe) };
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["orders", "billing"], links: [] },
    messageBus: { destinations: [{ id: "orders", kind: "topic", ackTimeout: duration(20), maxAttempts: 1 }], faults },
  }).createSimulation(golden05Inputs, setup => {
    deliveries = []; messageId = "";
    engine = new DeterministicFaultEngine({ rules: [{ id: "duplicate-first-order", point: "message.delivery", source: "orders", target: "billing", name: "orders",
      from: simulationTime(0), occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "duplicate", additionalCopies: 1, spacing: duration(0) } }],
    components: ["orders", "billing"], clock: { now: () => simulation.time }, random: { draw: label => simulation.random.draw(label) },
    observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
    activeEvent: () => simulation.activeEvent });
    const bus = setup.messageBusFor("orders");
    setup.messageBusController().subscribe("orders", "billing", { ready: () => true, accept: delivery => {
      deliveries.push(delivery.deliveryId);
    } });
    setup.registerHandler("scenario.publish", "orders", function* (): ControlledTask {
      const result = (yield bus.publish("orders", { type: "OrderCreated", body: { orderId: "o1" } })) as { messageId: string };
      messageId = result.messageId;
    });
    setup.schedule({ time: simulationTime(0), type: "scenario.publish", payload: null });
  });
  return { simulation, snapshot: () => canonicalCopy({ messageId, deliveries }) as { messageId: string; deliveries: string[] } };
}

export function golden05Result(fixture: ReturnType<typeof createGolden05>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot(), history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden05(); await fixture.simulation.run();
  process.stdout.write(JSON.stringify(golden05Result(fixture), null, 2) + "\n");
}
