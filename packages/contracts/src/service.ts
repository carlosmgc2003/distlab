import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { ControlledOperation, ControlledTask } from "./kernel/operations.js";
import type { VirtualClock } from "./kernel/clock.js";
import type { Database } from "./database.js";
import type { KeyValueStore } from "./kv-store.js";
import type { RuntimeLogger } from "./logging.js";
import type { Delivery, MessageBus } from "./message-bus.js";
import type { NetworkReply, VirtualNetwork } from "./network.js";

export const ServiceObservationTypes = {
  LifecycleChanged: "service.lifecycle.changed",
  HandlerStarted: "service.handler.started",
  HandlerCompleted: "service.handler.completed",
  HandlerFailed: "service.handler.failed",
  HandlerAbandoned: "service.handler.abandoned",
  WorkSkipped: "service.work.skipped",
} as const;

export type ServiceState =
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "CRASHED"
  | "STOPPED";

export interface ServiceContext {
  readonly db?: Database;
  readonly kv?: KeyValueStore;
  readonly events: MessageBus;
  readonly http: VirtualNetwork;
  readonly clock: VirtualClock;
  readonly log: RuntimeLogger;
}

export type ServiceTask<R> = Generator<ControlledOperation, R, CanonicalValue>;

export type EndpointHandler = (
  body: CanonicalValue,
  ctx: ServiceContext,
) => NetworkReply | ServiceTask<NetworkReply>;

export type ConsumerHandler = (
  delivery: Readonly<Delivery>,
  ctx: ServiceContext,
) => void | ControlledTask;

export type BackgroundHandler = (
  data: CanonicalValue,
  ctx: ServiceContext,
) => void | ControlledTask;

/**
 * Versioned catalog definition. Contains code, not scenario data.
 * Consumer keys name configured bus destinations.
 */
export interface ServiceDefinition {
  readonly id: ComponentId;
  readonly version: string;
  readonly endpoints: Readonly<Record<string, EndpointHandler>>;
  readonly consumers: Readonly<Record<string, ConsumerHandler>>;
  readonly background: Readonly<Record<string, BackgroundHandler>>;
}

export interface ServiceRuntime {
  readonly state: ServiceState;
}

/** Trusted lifecycle/fault dispatch only. Never a host UI mutation. */
export interface ServiceController {
  transition(next: ServiceState): void;
}
