import type { ExpectedValue, KeyValueDefinition, KeyValueStore, SetOptions } from "@distlab/contracts";
import { KeyValueObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, Duration, ObservationSink, ScheduledEvent, ScheduledHandle, Scheduler, SimulationTime } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "./canonical.js";
import { addDuration } from "./clock.js";

const fail = (code: string): never => throwSimulationError(code);
const invalid = (): never => fail(ErrorCodes.INVALID_KV_OPERATION);
const plain = (value: CanonicalValue | undefined): value is { [key: string]: CanonicalValue } => !!value && typeof value === "object" && !Array.isArray(value);
const timeValue = (value: CanonicalValue | undefined): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const presence = (value: CanonicalValue | undefined): boolean => {
  if (!plain(value)) return false;
  const keys = Object.keys(value);
  return value.present === false ? keys.length === 1 : value.present === true && keys.length === 2 && Object.hasOwn(value, "value");
};
const only = (value: { [key: string]: CanonicalValue }, required: readonly string[], optional: readonly string[] = []): boolean => {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key));
};
/** What a failed condition found: absent, or the live value with its expiry when it has one. */
const actualPresence = (value: CanonicalValue | undefined): boolean => {
  if (!plain(value)) return false;
  if (value.present === false) return Object.keys(value).length === 1;
  return value.present === true && Object.hasOwn(value, "value") && only(value, ["present", "value"], ["expiresAt"]) &&
    (value.expiresAt === undefined || timeValue(value.expiresAt));
};
const readRecord = (value: CanonicalValue | undefined): boolean => plain(value) && typeof value.key === "string" && value.key.length > 0 &&
  (value.present === true ? only(value, ["key", "present", "value"]) : value.present === false && only(value, ["key", "present"]));
const changedRecord = (value: CanonicalValue | undefined): boolean => plain(value) && typeof value.key === "string" && value.key.length > 0 &&
  (value.operation === "set" || value.operation === "delete" || value.operation === "increment" || value.operation === "compareAndSet" || value.operation === "compareAndDelete") &&
  presence(value.before) && presence(value.after) && (value.expiresAt === undefined || timeValue(value.expiresAt)) &&
  // `ifAbsent` is stored only on a set that passed it, and only as true.
  (value.ifAbsent === undefined || value.ifAbsent === true) &&
  only(value, ["key", "operation", "before", "after"], value.operation === "set" ? ["expiresAt", "ifAbsent"] : ["expiresAt"]);
const conditionRecord = (value: CanonicalValue | undefined): boolean => plain(value) && typeof value.key === "string" && value.key.length > 0 &&
  // A failed set is always set-if-absent and a failed compare-and-delete always expected a value.
  (value.operation === "set" ? plain(value.expected) && value.expected.present === false
    : value.operation === "compareAndDelete" ? plain(value.expected) && value.expected.present === true
      : value.operation === "compareAndSet") &&
  presence(value.expected) && actualPresence(value.actual) && only(value, ["key", "operation", "expected", "actual"]);
const expiredRecord = (value: CanonicalValue | undefined): boolean => plain(value) && typeof value.key === "string" && value.key.length > 0 &&
  timeValue(value.expiresAt) && timeValue(value.generation) && only(value, ["key", "value", "expiresAt", "generation"]);
const data = (value: unknown): CanonicalValue => { try { return canonicalCopy(value); } catch { return invalid(); } };
const tag = (value: CanonicalValue | undefined): CanonicalValue => value === undefined ? { present: false } : { present: true, value: data(value) };
/** The live entry a failed condition found, as `kv.condition.failed` stores it. */
const actual = (entry: { value: CanonicalValue; expiresAt?: SimulationTime } | undefined): CanonicalValue => entry === undefined ? { present: false }
  : { present: true, value: data(entry.value), ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }) };
const keyOf = (key: unknown): string => typeof key === "string" && key.length > 0 ? key : invalid();
const ttlOf = (value: unknown): Duration | undefined => value === undefined ? undefined :
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value as Duration : invalid();
const optionsOf = (value: unknown, conditional: boolean): SetOptions => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["ttl", ...(conditional ? ["ifAbsent"] : [])].includes(key))) invalid();
  const options = value as SetOptions;
  ttlOf(options.ttl);
  if (conditional && options.ifAbsent !== undefined && typeof options.ifAbsent !== "boolean") invalid();
  return options;
};
const expectedOf = (value: unknown): ExpectedValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const expected = value as ExpectedValue;
  if (expected.present === false && Object.keys(expected).length === 1) return { present: false };
  if (expected.present === true && Object.keys(expected).length === 2 && Object.hasOwn(expected, "value"))
    return { present: true, value: data(expected.value) };
  return invalid();
};
const registered = new WeakSet<object>();
type Link = { eventId?: string; traceId?: string; spanId?: string; parentSpanId?: string; causationId?: string };
type Entry = { value: CanonicalValue; expiresAt?: SimulationTime; generation: number; handle?: ScheduledHandle; cause?: Link };
export interface KeyValueStoreOptions {
  readonly definition: KeyValueDefinition;
  readonly clock: { now(): SimulationTime };
  readonly scheduler: Pick<Scheduler, "schedule">;
  readonly observations: ObservationSink & { registerSchema(type: string, validate: (data: CanonicalValue | undefined) => boolean): void };
  readonly activeOwner: () => ComponentId | undefined;
  readonly dispatching: () => boolean;
  readonly activeEvent: () => ScheduledEvent | undefined;
  readonly check: () => void;
}

/** One service-owned resource per simulation attempt. It outlives process generations. */
export class DeterministicKeyValueStore implements KeyValueStore {
  readonly #options: KeyValueStoreOptions;
  readonly #entries = new Map<string, Entry>();
  readonly #generations = new Map<string, number>();
  readonly #expiryType: string;
  #initialExpiriesScheduled = false;
  constructor(options: KeyValueStoreOptions) {
    this.#options = options;
    this.#expiryType = `kv.expiry.${options.definition.owner}`;
    if (!registered.has(options.observations)) {
      options.observations.registerSchema(KeyValueObservationTypes.Read, readRecord);
      options.observations.registerSchema(KeyValueObservationTypes.Changed, changedRecord);
      options.observations.registerSchema(KeyValueObservationTypes.ConditionFailed, conditionRecord);
      options.observations.registerSchema(KeyValueObservationTypes.Expired, expiredRecord);
      registered.add(options.observations);
    }
    const seen = new Set<string>();
    const initial = options.definition.initial.map(item => ({ key: keyOf(item.key), value: data(item.value), ttl: ttlOf(item.ttl) }));
    for (const item of initial) {
      if (seen.has(item.key)) invalid();
      seen.add(item.key);
      if (item.ttl !== undefined) this.#due(item.ttl);
    }
    for (const { key, value, ttl } of initial.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) {
      const expiresAt = ttl === undefined ? undefined : this.#due(ttl);
      this.#entries.set(key, { value, generation: 0, ...(expiresAt === undefined ? {} : { expiresAt }) });
      this.#generations.set(key, 0);
    }
  }
  /** Schedules initial TTLs after registrations and before scenario actions. */
  scheduleInitialExpiries(): void {
    if (this.#initialExpiriesScheduled) return;
    this.#initialExpiriesScheduled = true;
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt === undefined || entry.handle) continue;
      const armed = this.#arm(key, entry.generation, entry.expiresAt, {});
      if (armed.handle) entry.handle = armed.handle;
      if (armed.cause) entry.cause = armed.cause;
    }
  }
  get expiryEventType(): string { return this.#expiryType; }
  /** Trusted composition root registers this handler before any initial TTL is scheduled. */
  expire(event: ScheduledEvent): void {
    this.#options.check();
    const payload = event.payload as { key: string; generation: number };
    const entry = this.#entries.get(payload.key);
    if (entry?.generation === payload.generation && entry.expiresAt !== undefined && this.#options.clock.now() >= entry.expiresAt)
      this.#expire(payload.key, entry);
  }
  inspect(): readonly Readonly<{ key: string; value: CanonicalValue; expiresAt?: SimulationTime; generation: number }>[] {
    this.#options.check();
    const now = this.#options.clock.now();
    return Object.freeze([...this.#entries].filter(([, entry]) => entry.expiresAt === undefined || now < entry.expiresAt)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => Object.freeze({ key, value: data(entry.value), generation: entry.generation,
        ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }) })));
  }
  #active(): void {
    this.#options.check();
    if (!this.#options.dispatching() || this.#options.activeOwner() !== this.#options.definition.owner) invalid();
  }
  #due(ttl: Duration): SimulationTime {
    try { return addDuration(this.#options.clock.now(), ttl); } catch { return invalid(); }
  }
  #next(key: string): number {
    const next = (this.#generations.get(key) ?? 0) + 1;
    if (!Number.isSafeInteger(next)) invalid();
    return next;
  }
  #link(event?: ScheduledEvent): Link {
    return { ...(event?.traceId ? { traceId: event.traceId } : {}), ...(event?.spanId ? { spanId: event.spanId } : {}),
      ...(event?.parentSpanId ? { parentSpanId: event.parentSpanId } : {}), ...(event?.causationId ? { causationId: event.causationId } : {}) };
  }
  #schedule(key: string, generation: number, time: SimulationTime, trace: Link): ScheduledHandle {
    return this.#options.scheduler.schedule({ time, type: this.#expiryType, payload: { key, generation },
      source: this.#options.definition.owner, target: this.#options.definition.owner,
      ...(trace.traceId ? { traceId: trace.traceId } : {}), ...(trace.spanId ? { spanId: trace.spanId } : {}),
      ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}), ...(trace.causationId ? { causationId: trace.causationId } : {}) });
  }
  #arm(key: string, generation: number, expiresAt: SimulationTime | undefined, trace: Link): Pick<Entry, "handle" | "expiresAt" | "cause"> {
    if (expiresAt === undefined) return {};
    const handle = this.#schedule(key, generation, expiresAt, trace);
    return { handle, expiresAt, cause: { ...trace, eventId: handle.eventId } };
  }
  #observe(type: string, payload: CanonicalValue, link?: Link): void {
    const current = this.#options.activeEvent();
    const source = link ?? (current ? { eventId: current.id, ...this.#link(current) } : {});
    this.#options.observations.record({ type, source: this.#options.definition.owner,
      entityRefs: [{ kind: "service", id: this.#options.definition.owner }],
      ...(source.eventId ? { eventId: source.eventId } : {}), ...(source.traceId ? { traceId: source.traceId } : {}),
      ...(source.spanId ? { spanId: source.spanId } : {}), ...(source.parentSpanId ? { parentSpanId: source.parentSpanId } : {}),
      ...(source.causationId ? { causationId: source.causationId } : {}), data: payload });
  }
  #expire(key: string, entry: Entry): void {
    this.#entries.delete(key);
    entry.handle?.cancel();
    this.#observe(KeyValueObservationTypes.Expired,
      { key, value: data(entry.value), expiresAt: entry.expiresAt!, generation: entry.generation }, entry.cause);
  }
  #live(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (entry?.expiresAt !== undefined && this.#options.clock.now() >= entry.expiresAt) {
      this.#expire(key, entry); return undefined;
    }
    return entry;
  }
  get(key: string): CanonicalValue | undefined {
    this.#active(); keyOf(key);
    const entry = this.#live(key);
    this.#observe(KeyValueObservationTypes.Read, { key, ...tag(entry?.value) as object });
    return entry && data(entry.value);
  }
  #write(key: string, value: CanonicalValue, ttl: Duration | undefined, operation: string, previous: Entry | undefined, ifAbsent = false): void {
    const generation = this.#next(key);
    const expiresAt = ttl === undefined ? undefined : this.#due(ttl);
    const armed = this.#arm(key, generation, expiresAt, this.#link(this.#options.activeEvent()));
    previous?.handle?.cancel();
    this.#entries.set(key, { value, generation, ...armed });
    this.#generations.set(key, generation);
    this.#observe(KeyValueObservationTypes.Changed, { key, operation, ...(ifAbsent ? { ifAbsent: true } : {}), before: tag(previous?.value), after: tag(value),
      ...(expiresAt === undefined ? {} : { expiresAt }) });
  }
  set(key: string, value: CanonicalValue, options?: SetOptions): boolean {
    this.#active(); keyOf(key); const copy = data(value), parsed = optionsOf(options, true), ttl = ttlOf(parsed.ttl);
    this.#next(key); if (ttl !== undefined) this.#due(ttl);
    const previous = this.#live(key);
    if (parsed.ifAbsent && previous) {
      this.#observe(KeyValueObservationTypes.ConditionFailed, { key, operation: "set", expected: { present: false }, actual: actual(previous) });
      return false;
    }
    this.#write(key, copy, ttl, "set", previous, parsed.ifAbsent === true); return true;
  }
  delete(key: string): boolean {
    this.#active(); keyOf(key);
    const previous = this.#live(key);
    if (!previous) return false;
    this.#remove(key, previous, "delete");
    return true;
  }
  #remove(key: string, previous: Entry, operation: string): void {
    previous.handle?.cancel(); this.#entries.delete(key);
    this.#observe(KeyValueObservationTypes.Changed, { key, operation, before: tag(previous.value), after: tag(undefined) });
  }
  increment(key: string): number {
    this.#active(); keyOf(key); this.#next(key);
    const previous = this.#live(key);
    if (previous && (typeof previous.value !== "number" || !Number.isSafeInteger(previous.value))) fail(ErrorCodes.KV_NOT_INTEGER);
    const next = (previous ? previous.value as number : 0) + 1;
    if (!Number.isSafeInteger(next)) fail(ErrorCodes.KV_COUNTER_OVERFLOW);
    const generation = this.#next(key);
    const retained = { ...(previous?.cause ?? {}) };
    delete retained.eventId;
    const armed = this.#arm(key, generation, previous?.expiresAt, retained);
    previous?.handle?.cancel();
    this.#entries.set(key, { value: next, generation, ...armed });
    this.#generations.set(key, generation);
    this.#observe(KeyValueObservationTypes.Changed, { key, operation: "increment", before: tag(previous?.value), after: tag(next),
      ...(previous?.expiresAt === undefined ? {} : { expiresAt: previous.expiresAt }) });
    return next;
  }
  compareAndSet(key: string, expected: ExpectedValue, next: CanonicalValue, options?: { readonly ttl?: Duration }): boolean {
    this.#active(); keyOf(key); const checked = expectedOf(expected), copy = data(next), parsed = optionsOf(options, false), ttl = ttlOf(parsed.ttl);
    this.#next(key); if (ttl !== undefined) this.#due(ttl);
    const previous = this.#live(key);
    const matches = checked.present ? previous !== undefined && canonicalEncode(previous.value) === canonicalEncode(checked.value) : previous === undefined;
    if (!matches) {
      this.#observe(KeyValueObservationTypes.ConditionFailed, { key, operation: "compareAndSet", expected: checked as CanonicalValue, actual: actual(previous) });
      return false;
    }
    this.#write(key, copy, ttl, "compareAndSet", previous); return true;
  }
  compareAndDelete(key: string, expected: { readonly present: true; readonly value: CanonicalValue }): boolean {
    this.#active(); keyOf(key); const checked = expectedOf(expected);
    const value = checked.present ? checked.value : invalid();
    const previous = this.#live(key);
    if (!previous || canonicalEncode(previous.value) !== canonicalEncode(value)) {
      this.#observe(KeyValueObservationTypes.ConditionFailed, { key, operation: "compareAndDelete", expected: { present: true, value }, actual: actual(previous) });
      return false;
    }
    this.#remove(key, previous, "compareAndDelete"); return true;
  }
}
