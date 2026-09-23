import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGolden01, golden01Result } from "./golden-01.ts";
import { createGolden02, golden02Result } from "./golden-02.ts";
import { createGolden04, golden04Result } from "./golden-04.ts";
import { createGolden05, golden05Result } from "./golden-05.ts";
import { createGolden06, golden06Result } from "./golden-06.ts";
import { createGolden07, golden07Result } from "./golden-07.ts";
import type { HeadlessSimulation } from "@distlab/kernel";
import type { RunOptions, RunResult, SimulationStep } from "@distlab/contracts/kernel";

/** Scenario 03 is not part of the suite; it does not add coverage beyond these fixtures. */
export const goldenScenarioIds = ["01", "02", "04", "05", "06", "07"] as const;
export type GoldenScenarioId = (typeof goldenScenarioIds)[number];

export interface GoldenHarnessSession {
  readonly simulation: HeadlessSimulation;
  run(options?: RunOptions): Promise<RunResult>;
  step(): Promise<SimulationStep | undefined>;
  pause(): void;
  reset(): Promise<void>;
  inspect(): { status: string; time: number; state: unknown; history: unknown; digest: string };
  results(): readonly [];
}

function wrap<T extends { simulation: HeadlessSimulation }>(fixture: T, result: (fixture: T) => GoldenHarnessSession["inspect"] extends () => infer R ? R : never): GoldenHarnessSession {
  return {
    simulation: fixture.simulation,
    run: options => fixture.simulation.run(options),
    step: () => fixture.simulation.step(),
    pause: () => fixture.simulation.pause(),
    reset: () => fixture.simulation.reset(),
    inspect: () => result(fixture),
    results: () => [],
  };
}

const loaders: Record<GoldenScenarioId, () => GoldenHarnessSession> = {
  "01": () => wrap(createGolden01(), golden01Result),
  "02": () => wrap(createGolden02(), golden02Result),
  "04": () => wrap(createGolden04(), golden04Result),
  "05": () => wrap(createGolden05(), golden05Result),
  "06": () => wrap(createGolden06(), golden06Result),
  "07": () => wrap(createGolden07(), golden07Result),
};

export function loadGolden(id: string): GoldenHarnessSession {
  if (!Object.hasOwn(loaders, id)) throw new Error(`Unknown golden scenario ${id}`);
  return loaders[id as GoldenScenarioId]();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const session = loadGolden(process.argv[2] ?? "");
  await session.run();
  process.stdout.write(`${JSON.stringify(session.inspect(), null, 2)}\n`);
}
