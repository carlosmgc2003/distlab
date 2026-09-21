# Virtual Clock Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-17 |
| Related issues | None |

## Responsibility

`VirtualClock` is the sole source of logical time for a simulation run. It
reports the current time and translates sleeps or delayed work into scheduler
requests without waiting for wall-clock time.

Time is elapsed logical milliseconds represented by a non-negative safe
integer. It is not a calendar or Unix timestamp. Only the simulation core
receives the capability that advances or resets the clock.

## Public API

Identity, metadata, payload, and controlled-operation types come from
[Shared Simulation Contracts](contracts.md).

```ts
type SimulationTime = number & { readonly __brand: "SimulationTime" };
type Duration = number & { readonly __brand: "Duration" };

declare function simulationTime(value: number): SimulationTime;
declare function duration(value: number): Duration;

interface VirtualClock {
  now(): SimulationTime;
  sleep(delay: Duration): ControlledOperation;

  schedule<T extends CanonicalValue>(
    delay: Duration,
    type: string,
    payload: T,
    metadata?: ScheduleMetadata
  ): ScheduledHandle;
}

interface ScheduledHandle {
  readonly eventId: EventId;
  readonly dueTime: SimulationTime;
  cancel(): boolean;
}
```

The simulation core alone receives this internal capability:

```ts
interface ClockController {
  advanceTo(time: SimulationTime): void;
  reset(startTime?: SimulationTime): void;
}
```

`now()` is side-effect free. `sleep(delay)` schedules a reserved wake event and
returns an operation to yield from a controlled generator task. The kernel
resumes the task with `null` at wake dispatch; there is no native promise or host
timer. Calling sleep outside an executing controlled task fails with
`NO_ACTIVE_TASK`. `schedule()` computes `now() + delay`,
delegates one event to `Scheduler`, and returns its handle. `cancel()` returns
`true` only when it changes a pending event to cancelled.

Runtime clock capabilities bind the component owner and active task correlation.
Metadata cannot impersonate another component or retarget another owner's
handler. Trusted network/message adapters own those dispatches. Sleep captures
trace/span/parent and the active initiating observation as wake-event causation.
It records `clock.sleep.scheduled` after the scheduler accepts the wake event.
The kernel coordinates operation creation, wake
scheduling, and task registration; the clock does not own those states.

`simulationTime` and `duration` validate without mutation and throw
`INVALID_SIMULATION_TIME` and `INVALID_DURATION`, respectively. Clock methods
also validate at runtime rather than trusting TypeScript brands. Invalid sleeps
allocate no operation or scheduler identity. Controller reset is restricted to
initialization/reset; it cannot reset time independently during a live run.
Old clock/handle capabilities reject `STALE_CAPABILITY` after reset, including
cancellation; they cannot affect a new event with a reused canonical ID. Sleep
wake handles are never exposed to model code; only their owner runtime/kernel
may invalidate them as part of task lifecycle.

Durations, start times, and absolute times must be finite, non-negative safe
integers. Checked addition fails with `TIME_OVERFLOW`. Advancing to the past
fails with `CLOCK_REWIND`.

## Owned state

```ts
interface VirtualClockState {
  currentTime: SimulationTime;
}
```

The initial and reset value is the scenario's validated start time, defaulting
to `0`. This state is serializable without loss.

The clock does not own wake events, cancellation state, or suspended tasks.
`Scheduler` owns the events and their order; the simulation core owns tasks.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `clock.advanced` | Time moves to a later event time | `from`, `to`, causing event ID |
| `clock.sleep.scheduled` | A valid sleep is delegated | Wake event ID, requested duration, due time |
| `clock.sleep.resumed` | The wake event resolves its task | Wake event ID, task ID, time |

`now()` emits nothing. Same-time event dispatch emits no redundant
`clock.advanced`. Scheduling and cancellation also emit scheduler-owned events.

## Invariants

- **CLOCK-INV-1:** `currentTime` is always a non-negative safe integer.
- **CLOCK-INV-2:** Time is monotonic within a run and changes only through
  `ClockController` at initialization/reset or immediately before event dispatch.
- **CLOCK-INV-3:** `now()` neither changes state nor consumes randomness nor
  emits an event.
- **CLOCK-INV-4:** Zero delay enqueues a new same-time event with a later
  scheduler sequence; it never invokes work reentrantly.
- **CLOCK-INV-5:** Equal scheduling inputs and event order produce equal clock
  values and clock events.
- **CLOCK-INV-6:** The clock never reads `Date.now()`, `performance.now()`, a
  browser timer, locale, or time zone.
- **CLOCK-INV-7:** Cancelling delayed work never rewinds time or reorders
  remaining events.

## Explicit non-responsibilities

- It does not order equal-time events or allocate their identities;
  `Scheduler` does.
- It does not dispatch handlers or track async tasks; `simulation-core` does.
- It does not model dates, calendars, locales, time zones, or daylight-saving
  time.
- It does not control UI animation speed or measure host performance.
- It does not initially provide recurring jobs, intervals, or cron semantics.
- It does not own event history; it sends structured transitions to the
  observation sink.

## Minimal examples

Examples assume registered local handler types. The sleep and rewind examples
start at `t=100`; the independent cancellation example starts at `t=0`.

### Read and sleep

```ts
assert.equal(clock.now(), simulationTime(100));

// Inside a controlled generator task dispatched at t=100.
yield clock.sleep(duration(25));

assert.equal(clock.now(), simulationTime(125));
```

### Schedule and cancel a timeout

```ts
const timeout = clock.schedule(
  duration(2_000),
  "network.request.timeout",
  { requestId: "request-7" }
);

assert.equal(timeout.dueTime, simulationTime(2_000));
assert.equal(timeout.cancel(), true);
assert.equal(timeout.cancel(), false);
```

### Reject invalid time

```ts
assert.throws(() => duration(-1), { code: "INVALID_DURATION" });
assert.throws(() => controller.advanceTo(simulationTime(99)), {
  code: "CLOCK_REWIND",
});
```

## Acceptance criteria

- **CLOCK-AC-1:** A new or reset clock starts at the configured time or `0`
  when no start time is configured.
- **CLOCK-AC-2:** Repeated `now()` calls return the same value and leave clock,
  history, and random state unchanged.
- **CLOCK-AC-3:** `sleep(25)` at `t=100` resumes at `t=125` without a real-time
  wait, even when other events execute first.
- **CLOCK-AC-4:** Multiple sleeps due at the same time resume in scheduler
  sequence order.
- **CLOCK-AC-5:** A zero-duration sleep is non-reentrant and resumes through a
  newly sequenced same-time event.
- **CLOCK-AC-6:** Negative, fractional, non-finite, unsafe, and overflowing time
  values fail before queue or clock mutation.
- **CLOCK-AC-7:** Advancing to the current or a future time succeeds; advancing
  to the past fails with `CLOCK_REWIND` and leaves state unchanged.
- **CLOCK-AC-8:** Cancelling pending delayed work is idempotent and does not
  change the order of remaining events.
- **CLOCK-AC-9:** Clock state round-trips through serialization at `0`, typical,
  and maximum safe values.
- **CLOCK-AC-10:** Equal runs produce equal clock values and clock events.
- **CLOCK-AC-11:** Static and dependency checks find no wall-clock, timer, UI,
  runtime-model, or application-layer dependency.
- **CLOCK-AC-12:** Every event listed above is emitted exactly at its defined
  transition with deterministic required data.
- **CLOCK-AC-13:** Sleep outside a task fails without allocation; successive
  yields resume at their exact due times with preserved correlation. Old clock
  and cancel capabilities reject after reset without affecting the new run.
- **CLOCK-AC-14:** Runtime metadata cannot change the owning component, target
  another owner's handler, or schedule a reserved wake type.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| CLOCK-INV-1 | CLOCK-AC-1, CLOCK-AC-6, CLOCK-AC-9 |
| CLOCK-INV-2 | CLOCK-AC-1, CLOCK-AC-7 |
| CLOCK-INV-3 | CLOCK-AC-2 |
| CLOCK-INV-4 | CLOCK-AC-4, CLOCK-AC-5 |
| CLOCK-INV-5 | CLOCK-AC-10 |
| CLOCK-INV-6 | CLOCK-AC-11 |
| CLOCK-INV-7 | CLOCK-AC-8 |
| now | CLOCK-AC-2 |
| sleep | CLOCK-AC-3–6, CLOCK-AC-12, CLOCK-AC-13 |
| schedule, ScheduledHandle.cancel | CLOCK-AC-6, CLOCK-AC-8, CLOCK-AC-13, CLOCK-AC-14 |
| advanceTo, reset | CLOCK-AC-1, CLOCK-AC-7, CLOCK-AC-12, CLOCK-AC-13 |
| simulationTime, duration | CLOCK-AC-6 |

## Architectural alignment and decisions

Architecture §§3.2 and 9 require logical time without real waits. Vision §§14–15
require controllable, reproducible execution. [ADR-001](adr/001-deterministic-execution.md)
records the initial generator-based sleep API in place of conceptual native
await. User-facing run/pause/step/reset are core lifecycle operations; they do
not grant clock mutation to UI or runtime code. Fast-forward and full snapshots
remain deferred; there are no unresolved clock contract decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| [Simulation owns time](../architecture.md#32-simulation-owns-time) | Public API; invariants | CLOCK-AC-1–7, CLOCK-AC-11 |
| [Logical sleep](../architecture.md#9-virtual-clock) | Controlled operation semantics | CLOCK-AC-3–5, CLOCK-AC-13 |
| [Repeatable execution](../vision.md#15-deterministic-simulation) | Owned state; reset | CLOCK-AC-9, CLOCK-AC-10, CLOCK-AC-13 |

## References

- [Simulation Core specification](simulation-core.md)
- [Scheduler specification](scheduler.md)
- [Observability specification](observability.md)
- [DistLab vision](../vision.md)
- [DistLab architecture](../architecture.md)
- [DistLab glossary](../glossary.md)
