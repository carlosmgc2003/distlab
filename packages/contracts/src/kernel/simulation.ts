import type { CanonicalValue } from "./canonical.js";
import type { ComponentId, EventId, ObservationType } from "./identities.js";
import type { SimulationError } from "./errors.js";
import type { ControlledTask } from "./operations.js";
import type { EventDraft, ScheduledEvent } from "./events.js";
import type { ScheduledHandle, VirtualClock } from "./clock.js";
import type {
  ObservationSink,
  VisibilityPolicy,
} from "./observability.js";
import type { SimulationTime } from "./time.js";

export const SimulationObservationTypes = {
  Created: "simulation.created",
  EventStarted: "simulation.event.started",
  EventCompleted: "simulation.event.completed",
  EventSuspended: "simulation.event.suspended",
  EventFailed: "simulation.event.failed",
  Completed: "simulation.completed",
  Failed: "simulation.failed",
} as const;

export type SimulationStatus =
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

export interface RunInputs {
  readonly contractVersion: 1;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly architecture: CanonicalValue;
  readonly scenario: CanonicalValue;
  readonly configuration: {
    readonly startTime: SimulationTime;
    readonly historyLimit: number;
    readonly visibility: VisibilityPolicy;
    readonly models: CanonicalValue;
  };
  readonly seed: string;
}

export interface HandlerContext {
  readonly clock: VirtualClock;
  readonly observations: ObservationSink;
  /** Zero-delay local work. Cannot address another owner. */
  schedule<T extends CanonicalValue>(work: {
    type: string;
    payload: T;
  }): ScheduledHandle;
}

export type EventHandler = (
  event: ScheduledEvent,
  context: HandlerContext,
) => void | ControlledTask;

export interface SimulationSetup {
  registerHandler(
    type: string,
    owner: ComponentId | "simulation",
    handler: EventHandler,
  ): void;
  registerObservationSchema(
    type: ObservationType,
    validate: (data: CanonicalValue | undefined) => boolean,
  ): void;
  schedule<T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle;
}

export interface SimulationFactory {
  createSimulation(
    inputs: RunInputs,
    initialize: (setup: SimulationSetup) => void,
  ): Simulation;
}

export interface RunOptions {
  readonly maxEvents?: number;
  readonly maxEventsPerYield?: number;
}

export interface RunResult {
  readonly status: "PAUSED" | "COMPLETED";
  readonly reason: "PAUSE_REQUESTED" | "EVENT_LIMIT" | "EMPTY";
  readonly time: SimulationTime;
  readonly processedEvents: number;
  readonly totalEvents: number;
}

export interface SimulationStep {
  readonly eventId: EventId;
  readonly time: SimulationTime;
  readonly sequence: number;
  readonly outcome: "COMPLETED" | "SUSPENDED";
}

/**
 * Host control surface for one deterministic run.
 *
 * `step` / `run` return promises so the host may yield between event
 * boundaries. Handlers themselves are synchronous or generator tasks.
 */
export interface Simulation {
  readonly status: SimulationStatus;
  readonly time: SimulationTime;
  step(): Promise<SimulationStep | undefined>;
  run(options?: RunOptions): Promise<RunResult>;
  pause(): void;
  reset(): Promise<void>;
}

/**
 * Trusted runtime port. Removes matching tasks without resuming generators
 * or running `finally` blocks. See docs/spec/adr/002-runtime-model-semantics.md.
 */
export interface TaskLifecycleController {
  abandon(owner: ComponentId, processGeneration: number): void;
}

/**
 * Trusted composition-root hook. Synchronous, read-only, no scheduling.
 * `afterEvent` runs after handler bookkeeping and before the completion
 * decision. See ADR-002.
 */
export interface BoundaryReadHook {
  afterInitialization(): void;
  afterEvent(event: Readonly<ScheduledEvent>): void;
  onCompletion(): void;
  onFailure(error: Readonly<SimulationError>): void;
}
