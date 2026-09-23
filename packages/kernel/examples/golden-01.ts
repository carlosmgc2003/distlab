import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { RunInputs } from "@distlab/contracts/kernel";

/** Headless fixture: scheduled local work, a controlled continuation, and one seeded decision. */
export const golden01Inputs: RunInputs = {
  contractVersion: 1,
  modelVersions: { "kernel.random": "xoshiro128ss-splitmix32-v1", "fixture.golden-01": "1" },
  architecture: { components: ["worker"] },
  scenario: { id: "golden-01", actions: ["begin", "marker"] },
  configuration: {
    startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {},
  },
  seed: "distlab",
};

interface GoldenState {
  readonly order: string[];
  readonly draws: number[];
  committed: number;
}

export function createGolden01() {
  let state!: GoldenState;
  const simulation = new HeadlessSimulationFactory().createSimulation(golden01Inputs, setup => {
    // Reset creates this state and all handlers afresh; nothing is captured from a prior attempt.
    state = { order: [], draws: [], committed: 0 };
    setup.registerHandler("fixture.begin", "worker", function* (_event, ctx) {
      state.order.push("begin");
      state.draws.push(simulation.random.draw("begin").uint32);
      yield ctx.clock.sleep(duration(2));
      state.order.push("awake");
      state.committed++;
      ctx.schedule({ type: "fixture.finish", payload: { result: state.committed } });
    });
    setup.registerHandler("fixture.marker", "worker", () => { state.order.push("marker"); });
    setup.registerHandler("fixture.finish", "worker", event => {
      state.order.push(`finish:${(event.payload as { result: number }).result}`);
    });
    setup.schedule({ time: simulationTime(0), type: "fixture.begin", payload: null });
    setup.schedule({ time: simulationTime(1), type: "fixture.marker", payload: null });
  });
  return { simulation, snapshot: () => canonicalCopy(state) };
}

export function golden01Result(fixture: ReturnType<typeof createGolden01>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot();
  const history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

// Usage: node --experimental-strip-types packages/kernel/examples/golden-01.ts
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden01();
  await fixture.simulation.run();
  process.stdout.write(`${JSON.stringify(golden01Result(fixture), null, 2)}\n`);
}
