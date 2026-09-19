import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId, OperationId } from "./kernel/identities.js";
import type { ControlledOperation } from "./kernel/operations.js";
import type { Duration } from "./kernel/time.js";

export const NetworkObservationTypes = {
  RequestSent: "network.request.sent",
  RequestDelivered: "network.request.delivered",
  RequestDropped: "network.request.dropped",
  ResponseSent: "network.response.sent",
  ResponseDropped: "network.response.dropped",
  ResponseReceived: "network.response.received",
  RequestTimedOut: "network.request.timedout",
} as const;

/**
 * Normalized directed-link policy. Missing fields become zero latency/jitter
 * and a 1000 ms timeout before construction. Timeout must be positive;
 * `failureRate` is finite in `[0, 1]`.
 */
export interface NetworkPolicy {
  readonly requestLatency: Duration;
  readonly responseLatency: Duration;
  readonly jitter: Duration;
  readonly timeout: Duration;
  readonly failureRate: number;
}

export interface NetworkRequest {
  readonly target: ComponentId;
  readonly endpoint: string;
  readonly body: CanonicalValue;
}

export interface NetworkReply {
  readonly status: "ok" | "error";
  readonly body: CanonicalValue;
}

/**
 * Owner-bound request port. Source and trace cannot be chosen by the caller.
 * Timeout settles only the caller; it does not cancel target work or prove
 * that the remote operation failed.
 */
export interface VirtualNetwork {
  request(request: NetworkRequest): ControlledOperation;
}

export interface NetworkReceiver {
  accept(requestId: OperationId, request: Readonly<NetworkRequest>): void;
}

/** Trusted runtime adapter port. Registration is initialization-only. */
export interface NetworkController {
  register(target: ComponentId, receiver: NetworkReceiver): void;
  reply(requestId: OperationId, reply: NetworkReply): void;
}
