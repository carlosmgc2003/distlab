import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicFaultEngine, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { FaultDecisionPort } from "@distlab/contracts";

export const golden07Inputs: RunInputs = {
  contractVersion: 1, modelVersions: { "kernel.fault-engine": "1", "fixture.golden-07": "1" },
  architecture: { components: ["payments", "processor"] }, scenario: { id: "golden-07", actions: ["authorize", "lose-reply"] },
  configuration: { startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
  seed: "golden-07",
};

export function createGolden07() {
  let processorEffects = 0, callerOutcome = "";
  let engine!: DeterministicFaultEngine;
  const faults: FaultDecisionPort = { evaluate: probe => engine.evaluate(probe) };
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["payments", "processor"], links: [
    { source: "payments", target: "processor", policy: { timeout: duration(5) } },
  ], faults } }).createSimulation(golden07Inputs, setup => {
    processorEffects = 0; callerOutcome = "";
    engine = new DeterministicFaultEngine({ rules: [{ id: "lose-processor-reply", point: "network.response", source: "processor", target: "payments",
      name: "authorize", from: simulationTime(0), probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
    components: ["payments", "processor"], clock: { now: () => simulation.time }, random: { draw: label => simulation.random.draw(label) },
    observations: { registerSchema: (type, validate) => setup.registerObservationSchema(type, validate), record: input => setup.observations.record(input) },
    activeEvent: () => simulation.activeEvent });
    const network = setup.networkFor("payments"), controller = setup.networkController();
    controller.register("processor", { accept: requestId => {
      processorEffects++;
      controller.reply(requestId, { status: "ok", body: { authorizationId: "auth-1" } });
    } });
    setup.registerHandler("scenario.authorize", "payments", function* (): ControlledTask {
      try { yield network.request({ target: "processor", endpoint: "authorize", body: { orderId: "o1" } }); callerOutcome = "ok"; }
      catch (error) { callerOutcome = (error as { code: string }).code; }
    });
    setup.schedule({ time: simulationTime(0), type: "scenario.authorize", payload: null });
  });
  return { simulation, snapshot: () => canonicalCopy({ processorEffects, callerOutcome }) as { processorEffects: number; callerOutcome: string } };
}

export function golden07Result(fixture: ReturnType<typeof createGolden07>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot(), history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden07(); await fixture.simulation.run();
  process.stdout.write(JSON.stringify(golden07Result(fixture), null, 2) + "\n");
}
