import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId, RunId } from "./kernel/identities.js";
import type { Observation } from "./kernel/observability.js";
import type { SimulationStatus } from "./kernel/simulation.js";
import type { SimulationTime } from "./kernel/time.js";
import type { SessionIdentity } from "./overlay.js";
import type { ScenarioDocument } from "./scenario-document.js";

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
  | {
      readonly version: 1;
      readonly requestId: string;
      readonly type: "load";
      /** An exact packaged document. */
      readonly scenario: CanonicalValue;
      readonly document?: never;
      /** Validated in the worker into a SessionOverlay. Absent means the empty overlay. */
      readonly overlay?: CanonicalValue;
    }
  | {
      readonly version: 1;
      readonly requestId: string;
      readonly type: "load";
      readonly scenario?: never;
      /** The raw text of an imported scenario document (ADR-006). Only the worker parses it. */
      readonly document: string;
      /** Validated in the worker against the document's own policy. Absent means the empty overlay. */
      readonly overlay?: CanonicalValue;
    }
  | { readonly version: 1; readonly requestId: string; readonly type: "run"; readonly maxEvents?: number }
  | { readonly version: 1; readonly requestId: string; readonly type: "pause" }
  | { readonly version: 1; readonly requestId: string; readonly type: "step" }
  | { readonly version: 1; readonly requestId: string; readonly type: "reset" };

export type WorkerEvent =
  | { readonly version: 1; readonly requestId: string; readonly type: "accepted" }
  | {
      readonly version: 1;
      readonly requestId: string;
      readonly type: "loaded";
      readonly projection: RuntimeProjectionSet;
      /** The lesson, seed, normalized overlay, and origin the worker applied. */
      readonly session: SessionIdentity;
      /** Present only for imported sessions: the normalized document the worker validated. */
      readonly document?: ScenarioDocument;
    }
  | { readonly version: 1; readonly requestId?: string; readonly type: "projection.updated"; readonly projection: RuntimeProjectionSet }
  | { readonly version: 1; readonly requestId: string; readonly type: "run.finished"; readonly status: "PAUSED" | "COMPLETED" | "FAILED" }
  | { readonly version: 1; readonly requestId: string; readonly type: "error"; readonly error: ApplicationError };
