import type { CanonicalValue, ComponentId, EventDraft, EventId, ObservationSink, PendingEventSummary, RunId, ScheduledEvent, ScheduledHandle, Scheduler, SchedulerController, SchedulerState, SimulationTime } from "@distlab/contracts/kernel";
import { ErrorCodes, simulationTime, throwSimulationError, SchedulerObservationTypes } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";
import { isIdentifier } from "./identity.js";

/** A sealed registry: keys are event types, values are the component allowed to handle them. */
export interface SchedulerOptions {
  runId: RunId;
  clock: { now(): SimulationTime };
  handlers: ReadonlyMap<string, ComponentId | "simulation">;
  observations: ObservationSink;
}

const fields = ["source", "target", "traceId", "spanId", "parentSpanId", "causationId"] as const;
const compare = (a: ScheduledEvent, b: ScheduledEvent): number => a.time - b.time || a.sequence - b.sequence;
const fail = (code: string): never => throwSimulationError(code);

export class DeterministicScheduler implements Scheduler, SchedulerController {
  readonly #options: SchedulerOptions;
  #heap: ScheduledEvent[] = [];
  #positions = new Map<EventId, number>();
  #next = 0;
  #generation = 0;
  #pristine = true;

  constructor(options: SchedulerOptions) {
    if (!isIdentifier(options.runId)) fail(ErrorCodes.INVALID_RUN_INPUT);
    this.#options = options;
  }

  #validate(draft: unknown): EventDraft {
    let copy: EventDraft;
    try { copy = canonicalCopy(draft) as unknown as EventDraft; }
    catch { return fail(ErrorCodes.INVALID_EVENT_PAYLOAD); }
    if (!copy || typeof copy !== "object" || Array.isArray(copy) ||
        Object.keys(copy).some(key => !["time", "type", "payload", ...fields].includes(key)) ||
        !Object.hasOwn(copy, "payload")) fail(ErrorCodes.INVALID_EVENT_PAYLOAD);
    try { simulationTime(copy.time); } catch { fail(ErrorCodes.INVALID_SIMULATION_TIME); }
    if (copy.time < this.#options.clock.now()) fail(ErrorCodes.EVENT_IN_PAST);
    if (!isIdentifier(copy.type) || !this.#options.handlers.has(copy.type)) fail(ErrorCodes.INVALID_EVENT_TYPE);
    for (const field of fields) {
      if (Object.hasOwn(copy, field) && !isIdentifier(copy[field])) fail(ErrorCodes.INVALID_EVENT_PAYLOAD);
    }
    if ((copy.spanId && !copy.traceId) || (copy.parentSpanId && (!copy.spanId || !copy.traceId))) fail(ErrorCodes.INVALID_EVENT_PAYLOAD);
    const owner = this.#options.handlers.get(copy.type);
    if (copy.target !== undefined && copy.target !== owner) fail(ErrorCodes.INVALID_EVENT_TYPE);
    return copy;
  }

  schedule<T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle {
    const copy = this.#validate(draft);
    if (this.#next >= Number.MAX_SAFE_INTEGER) fail(ErrorCodes.SEQUENCE_OVERFLOW);
    const sequence = this.#next++;
    const event = Object.freeze({ ...copy, id: `event:${this.#options.runId}:${sequence}`, sequence }) as ScheduledEvent;
    this.#insert(event);
    this.#pristine = false;
    this.#options.observations.record({ type: SchedulerObservationTypes.Scheduled, source: "simulation", eventId: event.id,
      ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
      ...(event.spanId === undefined ? {} : { spanId: event.spanId }),
      ...(event.parentSpanId === undefined ? {} : { parentSpanId: event.parentSpanId }),
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      data: { type: event.type, dueTime: event.time, sequence } });
    const generation = this.#generation;
    return Object.freeze({ eventId: event.id, dueTime: event.time, cancel: () => {
      if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
      return this.cancel(event.id);
    } });
  }

  /** Restrict model code to local work and its own issued handles. */
  forOwner(owner: ComponentId, allowedTypes: ReadonlySet<string>): Pick<Scheduler, "schedule"> {
    const generation = this.#generation;
    return Object.freeze({ schedule: <T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle => {
      if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
      const copy = canonicalCopy(draft) as unknown as EventDraft<T>;
      if (!allowedTypes.has(copy.type) || (copy.source !== undefined && copy.source !== owner) ||
          (copy.target !== undefined && copy.target !== owner)) fail(ErrorCodes.INVALID_EVENT_TYPE);
      return this.schedule({ ...copy, source: owner, target: owner });
    } });
  }

  cancel(eventId: EventId): boolean {
    const position = this.#positions.get(eventId);
    if (position === undefined) return false;
    const event = this.#remove(position);
    this.#options.observations.record({ type: SchedulerObservationTypes.Cancelled, source: "simulation", eventId: event.id,
      data: { type: event.type, dueTime: event.time, sequence: event.sequence } });
    return true;
  }

  peek(): Readonly<ScheduledEvent> | undefined { return this.#heap[0]; }
  takeNext(): Readonly<ScheduledEvent> | undefined {
    if (!this.#heap.length) return undefined;
    const event = this.#remove(0);
    this.#options.observations.record({ type: SchedulerObservationTypes.Dispatched, source: "simulation", eventId: event.id,
      data: { type: event.type, dueTime: event.time, sequence: event.sequence } });
    return event;
  }
  pending(): readonly PendingEventSummary[] {
    return Object.freeze([...this.#heap].sort(compare).map(({ payload: _payload, ...summary }) => Object.freeze(summary)));
  }
  size(): number { return this.#heap.length; }
  exportState(): Readonly<SchedulerState> {
    return Object.freeze({ runId: this.#options.runId, nextSequence: this.#next,
      pending: Object.freeze([...this.#heap].sort(compare).map(event => canonicalCopy(event) as unknown as ScheduledEvent)) as unknown as ScheduledEvent[] });
  }
  restore(state: SchedulerState): void {
    if (!this.#pristine) fail(ErrorCodes.INVALID_SCHEDULER_STATE);
    let copy: SchedulerState;
    try { copy = canonicalCopy(state) as unknown as SchedulerState; } catch { return fail(ErrorCodes.INVALID_SCHEDULER_STATE); }
    if (!copy || copy.runId !== this.#options.runId || !Number.isSafeInteger(copy.nextSequence) ||
        copy.nextSequence < 0 || copy.nextSequence > Number.MAX_SAFE_INTEGER || !Array.isArray(copy.pending)) fail(ErrorCodes.INVALID_SCHEDULER_STATE);
    const ids = new Set<string>(); const sequences = new Set<number>();
    for (const event of copy.pending) {
      try {
        const { id: _id, sequence: _sequence, ...draft } = event;
        this.#validate(draft);
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || event.sequence >= copy.nextSequence ||
            event.id !== `event:${copy.runId}:${event.sequence}` || ids.has(event.id) || sequences.has(event.sequence) ||
            Object.keys(event).some(key => !["id", "sequence", "time", "type", "payload", ...fields].includes(key))) fail(ErrorCodes.INVALID_SCHEDULER_STATE);
      } catch { fail(ErrorCodes.INVALID_SCHEDULER_STATE); }
      ids.add(event.id); sequences.add(event.sequence);
    }
    this.#heap = []; this.#positions.clear();
    this.#next = copy.nextSequence;
    for (const event of copy.pending) this.#insert(event);
    this.#generation++;
    this.#pristine = false;
  }
  reset(): void {
    this.#heap = []; this.#positions.clear(); this.#next = 0; this.#generation++; this.#pristine = true;
  }

  #swap(a: number, b: number): void {
    const first = this.#heap[a]!, second = this.#heap[b]!;
    this.#heap[a] = second; this.#heap[b] = first;
    this.#positions.set(first.id, b); this.#positions.set(second.id, a);
  }
  #up(index: number): void {
    while (index > 0) { const parent = Math.floor((index - 1) / 2);
      if (compare(this.#heap[parent]!, this.#heap[index]!) <= 0) break;
      this.#swap(parent, index); index = parent;
    }
  }
  #down(index: number): void {
    while (index * 2 + 1 < this.#heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.#heap.length && compare(this.#heap[child + 1]!, this.#heap[child]!) < 0) child++;
      if (compare(this.#heap[index]!, this.#heap[child]!) <= 0) break;
      this.#swap(index, child); index = child;
    }
  }
  #insert(event: ScheduledEvent): void {
    const index = this.#heap.length; this.#heap.push(event); this.#positions.set(event.id, index); this.#up(index);
  }
  #remove(index: number): ScheduledEvent {
    const removed = this.#heap[index]!; const last = this.#heap.pop()!;
    this.#positions.delete(removed.id);
    if (index < this.#heap.length) {
      this.#heap[index] = last; this.#positions.set(last.id, index);
      this.#up(index); this.#down(this.#positions.get(last.id)!);
    }
    return removed;
  }
}
