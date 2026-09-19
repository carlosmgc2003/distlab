import type { SpanId, TraceId } from "./identities.js";

export interface CorrelationContext {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly parentSpanId?: SpanId;
}

/**
 * Trusted-adapter port. `root()` allocates a trace and its root span;
 * `child()` allocates a span in the same trace. Invalid parents allocate
 * nothing. Returned contexts are immutable.
 */
export interface CorrelationController {
  root(): CorrelationContext;
  child(parent: CorrelationContext): CorrelationContext;
}
