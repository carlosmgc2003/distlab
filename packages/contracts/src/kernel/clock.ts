import type { CanonicalValue } from "./canonical.js";
import type { EventId } from "./identities.js";
import type { ControlledOperation } from "./operations.js";
import type { ScheduleMetadata } from "./events.js";
import type { Duration, SimulationTime } from "./time.js";

export const ClockObservationTypes = {
  Advanced: "clock.advanced",
  SleepScheduled: "clock.sleep.scheduled",
  SleepResumed: "clock.sleep.resumed",
} as const;

export interface ScheduledHandle {
  readonly eventId: EventId;
  readonly dueTime: SimulationTime;
  /** `true` only when a pending event is cancelled. */
  cancel(): boolean;
}

/**
 * Sole source of logical time for a run. Runtime capabilities bind the
 * component owner; they cannot impersonate another component.
 *
 * `sleep` must be yielded from a controlled task. Zero delay enqueues a new
 * same-time event and never runs work reentrantly.
 */
export interface VirtualClock {
  now(): SimulationTime;
  sleep(delay: Duration): ControlledOperation;
  schedule<T extends CanonicalValue>(
    delay: Duration,
    type: string,
    payload: T,
    metadata?: ScheduleMetadata,
  ): ScheduledHandle;
}

/** Kernel-only. Runtime code never receives this port. */
export interface ClockController {
  advanceTo(time: SimulationTime): void;
  reset(startTime?: SimulationTime): void;
}

export interface VirtualClockState {
  readonly currentTime: SimulationTime;
}
