# Scheduler Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-17 |
| Related issues | None |

## Responsibility

`Scheduler` owns the event queue and the deterministic total order of pending
work. It validates event drafts, assigns monotonic sequences and deterministic
identities, supports cancellation, and returns the next event ordered
lexicographically by `(time, sequence)`.

The scheduler does not advance time or execute handlers. `simulation-core`
dispatches the event, and `VirtualClock` owns current time.

## Public API

Event records, metadata, summaries, and canonical values are defined in
[Shared Simulation Contracts](contracts.md). The scheduler receives a read-only
current-time port, run ID, sealed handler-type/owner registry, and observation
sink at construction. It does not import the clock implementation.

```ts
interface EventDraft<T extends CanonicalValue = CanonicalValue> extends ScheduleMetadata {
  time: SimulationTime;
  type: string;
  payload: T;
}

interface Scheduler {
  schedule<T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle;
  cancel(eventId: EventId): boolean;
  peek(): Readonly<ScheduledEvent> | undefined;
  takeNext(): Readonly<ScheduledEvent> | undefined;
  pending(): readonly PendingEventSummary[];
  size(): number;
}

interface SchedulerController {
  exportState(): Readonly<SchedulerState>;
  restore(state: SchedulerState): void;
  reset(): void;
}
```

`schedule()` receives the current simulation time through its construction
port. It validates the complete draft before allocating a sequence or changing
the queue. This includes known handler type, canonical data, valid time, and
metadata. It takes a detached deeply frozen copy of the entire draft, including
nested payloads, before acceptance; it never freezes caller-owned objects.
The scheduler derives IDs logically as
`event:<runId>:<sequence>`; consumers treat the format as opaque.

`peek()` is side-effect free. `takeNext()` removes and returns one event exactly
once. `cancel()` returns `true` only for a currently pending event. `pending()`
returns an immutable execution-ordered snapshot, not the heap's internal layout.
Its summaries include all metadata but omit payload. `size()` counts only live
pending events. Neither `peek()` nor returned nested payloads permit mutation.
Handles are bound to the private run attempt, not only the event ID; old handles
throw `STALE_CAPABILITY` after reset or restore.

The core alone receives `takeNext` and `SchedulerController`. Runtime components
receive owner-bound schedule/cancel capabilities, never the full interface.
Cancellation by raw ID is restricted to trusted adapters and the core; ordinary
components can cancel only through handles issued to them.

Invalid drafts fail with stable codes such as `EVENT_IN_PAST`,
`INVALID_EVENT_TYPE`, or `INVALID_EVENT_PAYLOAD`. Exhausting the sequence range
fails with `SEQUENCE_OVERFLOW`.

## Owned state

```ts
interface SchedulerState {
  runId: RunId;
  nextSequence: number;
  pending: ScheduledEvent[];
}
```

The scheduler owns:

- the monotonic next-sequence allocator;
- pending event records and their deterministic IDs;
- the priority queue ordered by `(time, sequence)`;
- the cancellation index or equivalent internal tombstones.

Serialized `pending` events appear in execution order and exclude cancelled or
dispatched events. Reset clears pending and cancelled entries and restores the
initial sequence `0`.

Scheduling rejects `SEQUENCE_OVERFLOW` if incrementing nextSequence would
become unsafe. `exportState()` returns a detached snapshot. `restore()` is a
kernel-only operation for a fresh, non-running scheduler with matching run ID
and registry; it validates unique IDs/sequences, canonical data, times not
earlier than the injected clock, correct ID derivation, and nextSequence greater
than all stored sequences before replacing anything. Invalid state fails
atomically with `INVALID_SCHEDULER_STATE`. Restore neither emits schedule events
nor reconstructs task continuations. Reset/restore are not live simulation
snapshot APIs and revoke previously issued handles.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `scheduler.event.scheduled` | A draft is accepted | Event ID, type, due time, sequence, correlation metadata |
| `scheduler.event.cancelled` | A pending event is cancelled | Event ID, type, due time, sequence |
| `scheduler.event.dispatched` | `takeNext()` returns a live event | Event ID, type, due time, sequence |

Failed validation, `peek()`, `pending()`, `size()`, and unsuccessful
cancellation do not consume identities or emit canonical scheduler events.
Payload visibility follows the observability policy.

`takeNext` records dequeue at the clock's current time; its `dueTime` is data,
not the observation timestamp. The core then advances time and emits
`clock.advanced` followed by `simulation.event.started`. Schedule/cancel/dequeue
commit their transition before emitting their observation. If that append
fails, execution terminates under the Observability terminal protocol; committed
queue changes remain inspectable and are not retried or silently rolled back.

## Invariants

- **SCHED-INV-1:** No two accepted events in one run share an ID or sequence.
- **SCHED-INV-2:** The next event is always the minimum `(time, sequence)` pair.
- **SCHED-INV-3:** Sequence values never decrease or get reused, including
  after cancellation.
- **SCHED-INV-4:** Events scheduled during dispatch use the same global
  allocator as every other event.
- **SCHED-INV-5:** An event in the past is rejected before identity allocation
  or queue mutation.
- **SCHED-INV-6:** Taking or cancelling an event makes it no longer pending and
  it can never be dispatched later.
- **SCHED-INV-7:** Queue inspection cannot mutate event records or queue order.
- **SCHED-INV-8:** Equal scheduling and cancellation command sequences produce
  equal IDs, sequences, events, and dequeue order.
- **SCHED-INV-9:** The scheduler does not depend on JavaScript sort stability,
  object-key iteration, randomness, wall time, or host timers.

## Explicit non-responsibilities

- It does not advance the virtual clock; it reads time only through its injected
  validation port.
- It does not dispatch event handlers, track suspended tasks, or control the
  simulation lifecycle.
- It does not define business, network, messaging, storage, or fault priority.
- It does not initially implement explicit priorities, fairness, cron, or
  recurring schedules.
- It does not store executable closures; queued payloads are serializable data.
- It does not own execution history; it reports transitions through a narrow
  observation sink.
- It does not depend on runtime models, UI, scenarios, catalogs, or assessment.

## Minimal examples

Fixtures register each handler type before scheduling. Ordering and cancellation
examples start at `t=0`; the past-event example starts at `t=100`.

### Order equal-time events

```ts
const first = scheduler.schedule({
  time: simulationTime(50),
  type: "orders.created",
  payload: { orderId: "order-1" },
});

const second = scheduler.schedule({
  time: simulationTime(50),
  type: "payments.authorize",
  payload: { orderId: "order-1" },
});

assert.equal(scheduler.takeNext()?.id, first.eventId);
assert.equal(scheduler.takeNext()?.id, second.eventId);
```

### Cancel without reordering

```ts
const timeout = scheduler.schedule({
  time: simulationTime(2_000),
  type: "network.timeout",
  payload: { requestId: "request-7" },
});

assert.equal(scheduler.cancel(timeout.eventId), true);
assert.equal(scheduler.cancel(timeout.eventId), false);
```

### Reject an event in the past

```ts
assert.throws(
  () => scheduler.schedule({
    time: simulationTime(99),
    type: "late.event",
    payload: {},
  }),
  { code: "EVENT_IN_PAST" }
);
```

## Acceptance criteria

- **SCHED-AC-1:** Events with distinct times dequeue by ascending time,
  regardless of insertion order.
- **SCHED-AC-2:** Events with equal times dequeue by ascending allocation
  sequence.
- **SCHED-AC-3:** Same-time work scheduled by an executing event receives a
  sequence after all already accepted same-time work.
- **SCHED-AC-4:** `peek()` may be repeated without changing state; `takeNext()`
  returns each live event exactly once.
- **SCHED-AC-5:** Cancelling first, middle, or last pending events leaves every
  remaining event ID, sequence, and relative order unchanged.
- **SCHED-AC-6:** Invalid drafts and failed cancellations allocate no identity,
  mutate no queue state, and emit no scheduler event.
- **SCHED-AC-7:** Reset of a populated scheduler equals a fresh scheduler with
  the same run configuration.
- **SCHED-AC-8:** Serializing and restoring scheduler state preserves every
  subsequent `peek()` and `takeNext()` result.
- **SCHED-AC-9:** Property tests compare randomized command logs against an
  explicit `(time, sequence)` reference implementation.
- **SCHED-AC-10:** Queue insertion/removal are `O(log n)` and peek is `O(1)`
  for `n` pending events, excluding canonical copying, validation, and observation
  costs proportional to the submitted data. `pending()` may sort a snapshot.
- **SCHED-AC-11:** Equal command sequences produce equal state, events, and
  dequeue order.
- **SCHED-AC-12:** Static and dependency checks find no wall-clock, timer,
  random, external-I/O, UI, runtime-model, or application-layer dependency.
- **SCHED-AC-13:** Every event listed above is emitted exactly at its defined
  transition with deterministic required data.
- **SCHED-AC-14:** Mutating a submitted draft, nested payload, or returned record
  cannot alter queued work; caller objects remain writable. Invalid canonical
  data invokes no getters and consumes no identity.
- **SCHED-AC-15:** Unknown handler types, stale handles, invalid restore state,
  and unsafe sequences fail without altering the queue; restored state preserves
  subsequent allocation as well as dequeue results. Inspection and size exclude
  cancelled entries.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| SCHED-INV-1, SCHED-INV-3 | SCHED-AC-3, SCHED-AC-5, SCHED-AC-9, SCHED-AC-15 |
| SCHED-INV-2 | SCHED-AC-1, SCHED-AC-2, SCHED-AC-9 |
| SCHED-INV-4 | SCHED-AC-3 |
| SCHED-INV-5 | SCHED-AC-6 |
| SCHED-INV-6 | SCHED-AC-4, SCHED-AC-5 |
| SCHED-INV-7 | SCHED-AC-4, SCHED-AC-14, SCHED-AC-15 |
| SCHED-INV-8 | SCHED-AC-11 |
| SCHED-INV-9 | SCHED-AC-9, SCHED-AC-12 |
| schedule | SCHED-AC-1–3, SCHED-AC-6, SCHED-AC-10, SCHED-AC-14, SCHED-AC-15 |
| cancel, ScheduledHandle.cancel | SCHED-AC-5, SCHED-AC-6, SCHED-AC-15 |
| peek, takeNext | SCHED-AC-4, SCHED-AC-10, SCHED-AC-14 |
| pending, size | SCHED-AC-14, SCHED-AC-15 |
| exportState, restore, reset | SCHED-AC-7, SCHED-AC-8, SCHED-AC-15 |
| Emitted events | SCHED-AC-13 |

## Architectural alignment and decisions

Architecture §7 requires `(time, sequence)` order; §§35 and 38 require practical
serialization and controlled execution. Vision §15 requires reproducibility.
[ADR-001](adr/001-deterministic-execution.md) records serializable drafts and
the split between scheduler dequeue and core handler execution. No unresolved
scheduler decisions remain; full simulation snapshots are explicitly deferred.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| [Deterministic event order](../architecture.md#7-simulation-kernel) | Public API; ordering invariants | SCHED-AC-1–6, SCHED-AC-9 |
| [Serializable state](../architecture.md#35-snapshots) | Owned state and controller | SCHED-AC-7, SCHED-AC-8, SCHED-AC-15 |
| [Repeatability](../vision.md#15-deterministic-simulation) | Copying and identity rules | SCHED-AC-11, SCHED-AC-14 |

## References

- [Simulation Core specification](simulation-core.md)
- [Virtual Clock specification](virtual-clock.md)
- [Observability specification](observability.md)
- [DistLab vision](../vision.md)
- [DistLab architecture](../architecture.md)
- [DistLab glossary](../glossary.md)
