import type { CorrelationContext, SpanId, TraceId } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";

/** Independent per-run safe-integer allocator. The counter is changed only after a successful allocation. */
export class DeterministicIdAllocator {
  #next = 0;
  readonly #prefix: string;
  readonly #runId: string;

  constructor(prefix: string, runId: string, start = 0) {
    if (!isIdentifier(prefix) || !isIdentifier(runId)) throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason: "invalid identity namespace" });
    if (!Number.isSafeInteger(start) || start < 0 || start > Number.MAX_SAFE_INTEGER || Object.is(start, -0)) {
      throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason: "invalid identity sequence" });
    }
    this.#prefix = prefix;
    this.#runId = runId;
    this.#next = start;
  }

  canAllocate(): boolean {
    return Number.isSafeInteger(this.#next) && this.#next < Number.MAX_SAFE_INTEGER;
  }

  allocate(): string {
    if (!this.canAllocate()) {
      throwSimulationError(ErrorCodes.IDENTITY_OVERFLOW, { namespace: this.#prefix });
    }
    const value = `${this.#prefix}:${this.#runId}:${this.#next}`;
    this.#next += 1;
    return value;
  }

  /** Test and recovery hook; it preserves the same atomic overflow rule. */
  get nextSequence(): number { return this.#next; }
}

export class DeterministicCorrelationController {
  readonly #traces: DeterministicIdAllocator;
  readonly #spans: DeterministicIdAllocator;
  readonly #contexts = new Map<SpanId, CorrelationContext>();

  constructor(runId: string) {
    this.#traces = new DeterministicIdAllocator("trace", runId);
    this.#spans = new DeterministicIdAllocator("span", runId);
  }

  root(): CorrelationContext {
    if (!this.#traces.canAllocate() || !this.#spans.canAllocate()) {
      throwSimulationError(ErrorCodes.IDENTITY_OVERFLOW, { namespace: !this.#traces.canAllocate() ? "trace" : "span" });
    }
    const traceId = this.#traces.allocate() as TraceId;
    const spanId = this.#spans.allocate() as SpanId;
    return this.#store({ traceId, spanId });
  }

  child(parent: CorrelationContext): CorrelationContext {
    const known = this.#contexts.get(parent.spanId);
    if (!known || known.traceId !== parent.traceId || known.parentSpanId !== parent.parentSpanId) {
      throwSimulationError(ErrorCodes.INVALID_OBSERVATION, { reason: "unknown correlation parent" });
    }
    return this.#store({ traceId: known.traceId, spanId: this.#spans.allocate() as SpanId, parentSpanId: known.spanId });
  }

  hasSpan(traceId: string, spanId: string, parentSpanId?: string): boolean {
    const context = this.#contexts.get(spanId);
    return context?.traceId === traceId && context.parentSpanId === parentSpanId;
  }

  #store(context: CorrelationContext): CorrelationContext {
    const frozen = Object.freeze(context);
    this.#contexts.set(frozen.spanId, frozen);
    return frozen;
  }
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
