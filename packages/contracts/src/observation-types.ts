import { ClientObservationTypes } from "./client.js";
import { DatabaseObservationTypes } from "./database.js";
import { ExternalObservationTypes } from "./external.js";
import { FaultObservationTypes } from "./fault.js";
import { ClockObservationTypes } from "./kernel/clock.js";
import { SchedulerObservationTypes } from "./kernel/scheduler.js";
import { SimulationObservationTypes } from "./kernel/simulation.js";
import { KeyValueObservationTypes } from "./kv-store.js";
import { RuntimeObservationTypes } from "./logging.js";
import { MessageObservationTypes } from "./message-bus.js";
import { NetworkObservationTypes } from "./network.js";
import { ScenarioObservationTypes } from "./scenario.js";
import { ServiceObservationTypes } from "./service.js";

/**
 * Canonical observation types grouped by owner. Nested so names such as
 * `CallbackCompleted` stay distinct across client and external runtimes.
 */
export const ObservationTypes = {
  simulation: SimulationObservationTypes,
  clock: ClockObservationTypes,
  scheduler: SchedulerObservationTypes,
  network: NetworkObservationTypes,
  message: MessageObservationTypes,
  database: DatabaseObservationTypes,
  kv: KeyValueObservationTypes,
  service: ServiceObservationTypes,
  client: ClientObservationTypes,
  external: ExternalObservationTypes,
  fault: FaultObservationTypes,
  scenario: ScenarioObservationTypes,
  runtime: RuntimeObservationTypes,
} as const;

type NestedValues<T> = T extends string
  ? T
  : { readonly [K in keyof T]: NestedValues<T[K]> }[keyof T];

export type KnownObservationType = NestedValues<typeof ObservationTypes>;
