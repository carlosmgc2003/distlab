import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import type { WorkerPort } from "../src/host.ts";
import { simulationTime } from "@distlab/contracts";

export function projection(status: RuntimeProjectionSet["simulation"]["status"] = "READY"): RuntimeProjectionSet {
  return {
    architecture: { components: [{ id: "orders", kind: "service", label: "orders" }], links: [] },
    simulation: { runId: "same-input-fingerprint", status, time: simulationTime(0), pendingEvents: 2, processedEvents: 0, randomDrawCount: 0 },
    history: { observations: [] },
    components: [{ componentId: "orders", visibility: "host", state: { value: 1 } }],
  };
}

export class FakeWorker extends EventTarget implements WorkerPort {
  readonly commands: WorkerCommand[] = [];
  terminated = false;
  postMessage(command: WorkerCommand): void { this.commands.push(structuredClone(command)); }
  terminate(): void { this.terminated = true; }
  emit(event: WorkerEvent): void { this.dispatchEvent(new MessageEvent("message", { data: event })); }
  last(): WorkerCommand { return this.commands.at(-1)!; }
}
