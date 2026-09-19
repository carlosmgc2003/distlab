import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { VirtualClock } from "./kernel/clock.js";
import type { RuntimeLogger } from "./logging.js";
import type { NetworkReply, VirtualNetwork } from "./network.js";
import type { ServiceTask } from "./service.js";

export const ClientObservationTypes = {
  ActionStarted: "client.action.started",
  ActionCompleted: "client.action.completed",
  ActionFailed: "client.action.failed",
  StateChanged: "client.state.changed",
  CallbackStarted: "client.callback.started",
  CallbackCompleted: "client.callback.completed",
} as const;

export type ClientActionStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface ClientState {
  get(key: string): CanonicalValue | undefined;
  set(key: string, value: CanonicalValue): void;
}

export interface ClientContext {
  readonly http: VirtualNetwork;
  readonly clock: VirtualClock;
  readonly log: RuntimeLogger;
  readonly state: ClientState;
}

export type ClientAction = (
  data: CanonicalValue,
  ctx: ClientContext,
) => CanonicalValue | ServiceTask<CanonicalValue>;

export type ClientCallback = (
  body: CanonicalValue,
  ctx: ClientContext,
) => NetworkReply | ServiceTask<NetworkReply>;

export interface ClientDefinition {
  readonly id: ComponentId;
  readonly version: string;
  readonly actions: Readonly<Record<string, ClientAction>>;
  readonly callbacks: Readonly<Record<string, ClientCallback>>;
  readonly initialState: Readonly<Record<string, CanonicalValue>>;
}

/** Scenario adapter only. The UI cannot start an unrecorded action mid-run. */
export interface ClientController {
  start(actionId: string, action: string, data: CanonicalValue): void;
}
