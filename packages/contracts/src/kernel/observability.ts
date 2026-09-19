import type { CanonicalValue } from "./canonical.js";
import type {
  ComponentId,
  EntityRef,
  EventId,
  ObservationId,
  ObservationType,
  RunId,
  SpanId,
  TraceId,
  Unsubscribe,
} from "./identities.js";
import type { SimulationTime } from "./time.js";

export interface ObservationInput<T extends CanonicalValue = CanonicalValue> {
  type: ObservationType;
  source: ComponentId | "simulation";
  target?: ComponentId;
  traceId?: TraceId;
  spanId?: SpanId;
  parentSpanId?: SpanId;
  causationId?: ObservationId;
  eventId?: EventId;
  entityRefs?: readonly EntityRef[];
  data?: T;
}

/**
 * Immutable record of a meaningful simulation operation.
 * Time comes only from VirtualClock. Sequence is the append order.
 */
export interface Observation<T extends CanonicalValue = CanonicalValue>
  extends ObservationInput<T> {
  readonly schemaVersion: 1;
  readonly id: ObservationId;
  readonly time: SimulationTime;
  readonly sequence: number;
}

export interface ObservationSink {
  record<T extends CanonicalValue>(
    input: ObservationInput<T>,
  ): Readonly<Observation>;
}

export interface ObservationFilter {
  fromTime?: SimulationTime;
  toTime?: SimulationTime;
  type?: ObservationType;
  component?: ComponentId;
  traceId?: TraceId;
  eventId?: EventId;
  entity?: EntityRef;
}

export type ObservationListener = (observation: Readonly<Observation>) => void;

export type VisibilityMode = "visible" | "summary" | "redacted" | "omitted";

export interface VisibilityPolicy {
  readonly defaultMode: VisibilityMode;
  readonly byType: Readonly<Record<ObservationType, VisibilityMode>>;
  readonly summaryFields: Readonly<Record<ObservationType, readonly string[]>>;
}

export interface TerminalFailure {
  readonly time: SimulationTime;
  readonly code: string;
  readonly context: CanonicalValue;
  readonly historyComplete: boolean;
  readonly lastObservationId?: ObservationId;
}

export interface HistoryController {
  sealFailure(failure: TerminalFailure): void;
}

export interface ExecutionHistoryExport {
  readonly schemaVersion: 1;
  readonly runId: RunId;
  readonly observations: readonly Observation[];
  readonly terminalFailure?: TerminalFailure;
}

export interface ExecutionHistoryReader {
  all(): readonly Readonly<Observation>[];
  query(filter: ObservationFilter): readonly Readonly<Observation>[];
  byId(id: ObservationId): Readonly<Observation> | undefined;
  export(): ExecutionHistoryExport;
  subscribe(listener: ObservationListener): Unsubscribe;
}
