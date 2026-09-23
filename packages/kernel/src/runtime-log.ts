import { RuntimeObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, SimulationSetup } from "@distlab/contracts/kernel";

const registered = new WeakSet<SimulationSetup>();
const levels = new Set(["debug", "info", "warn", "error"]);

/** The shared runtime log schema belongs to the simulation, once per setup. */
export function registerRuntimeLogSchema(setup: SimulationSetup): void {
  if (registered.has(setup)) return;
  setup.registerObservationSchema(RuntimeObservationTypes.Log, (data: CanonicalValue | undefined) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const record = data as Readonly<Record<string, CanonicalValue>>;
    return Object.keys(record).every(key => key === "level" || key === "message" || key === "data") &&
      Object.hasOwn(record, "level") && Object.hasOwn(record, "message") &&
      typeof record.level === "string" && levels.has(record.level) && typeof record.message === "string";
  });
  registered.add(setup);
}
