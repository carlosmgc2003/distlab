import { SimulationHost } from "./host.ts";

export function createBrowserHost(): SimulationHost {
  return new SimulationHost(() => new Worker(new URL("./worker/entry.ts", import.meta.url), { type: "module" }));
}
