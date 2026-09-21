import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId, RunId } from "./kernel/identities.js";
import type { Observation } from "./kernel/observability.js";
import type { SimulationStatus } from "./kernel/simulation.js";
import type { SimulationTime } from "./kernel/time.js";

export interface ComponentNodeProjection {
  readonly id: ComponentId;
  readonly kind: "client" | "service" | "external" | "infrastructure";
  readonly label: string;
  readonly model?: string;
  readonly version?: string;
}

export interface ArchitectureProjection {
  readonly components: readonly ComponentNodeProjection[];
  readonly links: readonly {
    readonly source: ComponentId;
    readonly target: ComponentId;
    readonly label?: string;
  }[];
}

export interface SimulationProjection {
  readonly runId: RunId;
  readonly status: SimulationStatus;
  readonly time: SimulationTime;
  readonly pendingEvents: number;
  readonly processedEvents: number;
  /** Count only; no random-generator state or future values are exposed. */
  readonly randomDrawCount: number;
}

export interface ExecutionHistoryProjection {
  readonly observations: readonly Observation[];
}

export interface ComponentStateProjection {
  readonly componentId: ComponentId;
  readonly state: CanonicalValue;
  readonly visibility: "student" | "assessment" | "host";
}

export interface RuntimeProjectionSet {
  readonly architecture: ArchitectureProjection;
  readonly simulation: SimulationProjection;
  readonly history: ExecutionHistoryProjection;
  readonly components: readonly ComponentStateProjection[];
}

export interface ApplicationError {
  readonly code: string;
  readonly message: string;
  readonly context: CanonicalValue;
}

export type WorkerCommand =
  | { readonly version: 1; readonly requestId: string; readonly type: "load"; readonly scenario: CanonicalValue }
  | { readonly version: 1; readonly requestId: string; readonly type: "run"; readonly maxEvents?: number }
  | { readonly version: 1; readonly requestId: string; readonly type: "pause" }
  | { readonly version: 1; readonly requestId: string; readonly type: "step" }
  | { readonly version: 1; readonly requestId: string; readonly type: "reset" };

export type WorkerEvent =
  | { readonly version: 1; readonly requestId: string; readonly type: "accepted" }
  | { readonly version: 1; readonly requestId: string; readonly type: "loaded"; readonly projection: RuntimeProjectionSet }
  | { readonly version: 1; readonly requestId?: string; readonly type: "projection.updated"; readonly projection: RuntimeProjectionSet }
  | { readonly version: 1; readonly requestId: string; readonly type: "run.finished"; readonly status: "PAUSED" | "COMPLETED" | "FAILED" }
  | { readonly version: 1; readonly requestId: string; readonly type: "error"; readonly error: ApplicationError };
