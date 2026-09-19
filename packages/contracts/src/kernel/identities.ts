/**
 * Opaque nonempty strings. Prefixes distinguish allocator namespaces.
 * No identity depends on wall-clock time or randomness.
 * See docs/spec/contracts.md.
 */
export type RunId = string;
export type EventId = string;
export type TaskId = string;
export type OperationId = string;
export type ComponentId = string;
export type TraceId = string;
export type SpanId = string;
export type ObservationId = string;
export type ObservationType = string;

export type Unsubscribe = () => void;

export interface EntityRef {
  readonly kind: string;
  readonly id: string;
}

/** Literal stored in {@link import("./simulation.js").RunInputs.contractVersion}. */
export const CONTRACT_VERSION = 1;

/**
 * Runtime component categories from architecture §2.
 * Scenario instances use a narrower kind that excludes infrastructure.
 */
export type ComponentCategory =
  | "client"
  | "internal-service"
  | "external-service"
  | "infrastructure-primitive";

export type InfrastructurePrimitiveName =
  | "VirtualNetwork"
  | "MessageBus"
  | "Database"
  | "KeyValueStore"
  | "VirtualClock"
  | "Scheduler";
