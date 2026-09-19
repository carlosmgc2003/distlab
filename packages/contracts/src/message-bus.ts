import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { ControlledOperation } from "./kernel/operations.js";
import type { Duration } from "./kernel/time.js";

export const MessageObservationTypes = {
  Published: "message.published",
  Queued: "message.queued",
  Delivered: "message.delivered",
  Dropped: "message.dropped",
  Acknowledged: "message.acknowledged",
  Nacked: "message.nacked",
  RetryScheduled: "message.retry.scheduled",
  Dead: "message.dead",
  AckStale: "message.ack.stale",
  PublishRejected: "message.publish.rejected",
} as const;

export type DestinationKind = "queue" | "topic";

/**
 * Per-record routing states. PUBLISHED / NACKED / RETRY may be recorded
 * transitions within one dispatch. DROPPED describes an individual copy.
 */
export type MessageRoutingState =
  | "PUBLISHED"
  | "QUEUED"
  | "IN_FLIGHT"
  | "ACKED"
  | "NACKED"
  | "RETRY"
  | "DROPPED"
  | "DEAD";

/**
 * Normalized destination. Defaults: delay/retryDelay 0, ackTimeout 1000 ms,
 * maxAttempts 3, capacity 10000.
 */
export interface DestinationDefinition {
  readonly id: string;
  readonly kind: DestinationKind;
  readonly deliveryDelay: Duration;
  readonly ackTimeout: Duration;
  readonly retryDelay: Duration;
  readonly maxAttempts: number;
  readonly capacity: number;
}

/** Asynchronous payload published to a destination. */
export interface BusMessage {
  readonly type: string;
  readonly body: CanonicalValue;
}

export interface Delivery {
  readonly messageId: string;
  readonly deliveryId: string;
  readonly destination: string;
  readonly attempt: number;
  readonly message: Readonly<BusMessage>;
}

/**
 * Owner-bound publish port. Admission success resumes with `{ messageId }`
 * and does not mean the message was consumed.
 */
export interface MessageBus {
  publish(destination: string, message: BusMessage): ControlledOperation;
}

export interface MessageReceiver {
  ready(): boolean;
  accept(delivery: Readonly<Delivery>): void;
}

/** Trusted runtime adapter port. Subscriptions are initialization-only. */
export interface MessageBusController {
  subscribe(
    destination: string,
    consumer: ComponentId,
    receiver: MessageReceiver,
  ): void;
  acknowledge(deliveryId: string, outcome: "ack" | "nack"): void;
  consumerChanged(consumer: ComponentId): void;
}
