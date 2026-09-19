import type { CanonicalValue } from "./canonical.js";
import type {
  ComponentId,
  EventId,
  ObservationId,
  SpanId,
  TraceId,
} from "./identities.js";
import type { SimulationTime } from "./time.js";

export interface ScheduleMetadata {
  source?: ComponentId;
  target?: ComponentId;
  traceId?: TraceId;
  spanId?: SpanId;
  parentSpanId?: SpanId;
  causationId?: ObservationId;
}

/**
 * Serializable queued work. Handlers live in a sealed registry; the queue
 * never stores closures. Ordered by `(time, sequence)`.
 */
export interface ScheduledEvent<T extends CanonicalValue = CanonicalValue>
  extends ScheduleMetadata {
  readonly id: EventId;
  readonly time: SimulationTime;
  readonly sequence: number;
  readonly type: string;
  readonly payload: T;
}

export interface EventDraft<T extends CanonicalValue = CanonicalValue>
  extends ScheduleMetadata {
  time: SimulationTime;
  type: string;
  payload: T;
}

export type PendingEventSummary = Omit<ScheduledEvent, "payload">;
