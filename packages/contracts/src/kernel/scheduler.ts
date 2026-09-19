import type { CanonicalValue } from "./canonical.js";
import type { RunId } from "./identities.js";
import type { ScheduledHandle } from "./clock.js";
import type { EventDraft, PendingEventSummary, ScheduledEvent } from "./events.js";

export const SchedulerObservationTypes = {
  Scheduled: "scheduler.event.scheduled",
  Cancelled: "scheduler.event.cancelled",
  Dispatched: "scheduler.event.dispatched",
} as const;

/**
 * Owns the event queue and the `(time, sequence)` total order. Does not
 * advance time or execute handlers.
 *
 * Runtime components receive owner-bound schedule/cancel capabilities, never
 * this full interface. The core alone receives `takeNext` and
 * {@link SchedulerController}.
 */
export interface Scheduler {
  schedule<T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle;
  cancel(eventId: ScheduledEvent["id"]): boolean;
  peek(): Readonly<ScheduledEvent> | undefined;
  takeNext(): Readonly<ScheduledEvent> | undefined;
  pending(): readonly PendingEventSummary[];
  size(): number;
}

export interface SchedulerState {
  readonly runId: RunId;
  readonly nextSequence: number;
  readonly pending: ScheduledEvent[];
}

export interface SchedulerController {
  exportState(): Readonly<SchedulerState>;
  restore(state: SchedulerState): void;
  reset(): void;
}
