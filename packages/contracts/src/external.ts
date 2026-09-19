import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { Duration } from "./kernel/time.js";
import type { NetworkReply, NetworkRequest } from "./network.js";

export const ExternalObservationTypes = {
  AvailabilityChanged: "external.availability.changed",
  BehaviorChanged: "external.behavior.changed",
  OperationAdmitted: "external.operation.admitted",
  OperationRejected: "external.operation.rejected",
  EffectCommitted: "external.effect.committed",
  ResponseSuppressed: "external.response.suppressed",
  CallbackScheduled: "external.callback.scheduled",
  CallbackCompleted: "external.callback.completed",
} as const;

export type ExternalAvailability =
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "RATE_LIMITED";

export interface CallbackPlan {
  readonly after: Duration;
  readonly request: NetworkRequest;
}

export interface ProviderDecision {
  readonly nextState: CanonicalValue;
  readonly reply: NetworkReply;
  readonly visibleChanges: CanonicalValue;
  readonly callbacks: readonly CallbackPlan[];
}

/** Trusted synchronous catalog code. No database, kernel, or host I/O. */
export interface ExternalOperation {
  apply(
    body: CanonicalValue,
    state: CanonicalValue,
    behavior: CanonicalValue,
  ): ProviderDecision;
}

export interface ExternalDefinition {
  readonly id: ComponentId;
  readonly version: string;
  readonly operations: Readonly<Record<string, ExternalOperation>>;
  readonly initialState: CanonicalValue;
}

export interface ExternalBehavior {
  readonly latency: Duration;
  readonly degradedExtraLatency: Duration;
  readonly dropResponse: boolean;
  readonly parameters: CanonicalValue;
}

export interface ExternalRuntime {
  readonly availability: ExternalAvailability;
}

/** Scenario/fault adapters only. */
export interface ExternalController {
  configure(operation: string, behavior: ExternalBehavior): void;
  setAvailability(state: ExternalAvailability): void;
}
