import type { AssertionResult } from "@distlab/contracts";
import type { CanonicalValue, RunOptions, RunResult, SimulationStep, SimulationTime } from "@distlab/contracts/kernel";
import type { SimulationStatus } from "@distlab/contracts/kernel";
import type { ExecutionHistoryExport } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import type { DeterministicScenarioSession } from "./engine.js";

export interface HarnessExport {
  readonly status: SimulationStatus;
  readonly time: SimulationTime;
  readonly state: CanonicalValue;
  readonly history: ExecutionHistoryExport;
  readonly results: readonly AssertionResult[];
  readonly digest: string;
}

/** UI-free controls over one loaded scenario session. */
export interface HarnessSession {
  run(options?: RunOptions): Promise<RunResult>;
  step(): Promise<SimulationStep | undefined>;
  pause(): void;
  reset(): Promise<void>;
  inspect(): HarnessExport;
  results(): readonly AssertionResult[];
}

export function openHarness(session: DeterministicScenarioSession): HarnessSession {
  return {
    run: options => session.simulation.run(options),
    step: () => session.simulation.step(),
    pause: () => session.simulation.pause(),
    reset: () => session.simulation.reset(),
    inspect: () => inspectSession(session),
    results: () => session.results(),
  };
}

export function inspectSession(session: DeterministicScenarioSession): HarnessExport {
  const projection = session.projection();
  const body = {
    status: session.simulation.status,
    time: session.simulation.time,
    state: canonicalCopy({
      components: projection.components,
      databases: projection.databases,
      stores: projection.stores,
      messageBus: projection.messageBus,
    }),
    history: session.simulation.history.export(),
    results: session.results(),
  };
  return { ...body, digest: sha256Hex(canonicalEncode(canonicalCopy(body))) };
}

export function compareExports(left: HarnessExport, right: HarnessExport): boolean {
  return canonicalEncode(canonicalCopy(left)) === canonicalEncode(canonicalCopy(right));
}
