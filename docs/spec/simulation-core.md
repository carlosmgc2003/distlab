# Simulation Core Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`simulation-core` owns one deterministic simulation run. It composes the
`VirtualClock`, `Scheduler`, seeded generator, handler registry, task tracker,
runtime state, and observation sink; advances the run one scheduled event at a
time; and exposes lifecycle controls independently of the UI.

The core is the only component allowed to coordinate time advancement and event
dispatch. Runtime components receive narrow capabilities and cannot access the
event queue or kernel-owned mutable state directly.

## Public API

Shared types, construction, registration, and injected capabilities are defined
in [Shared Simulation Contracts](contracts.md). The application obtains
`createSimulation` from its composed factory; the kernel never interprets a
scenario schema or imports its runtime models.

```ts
type SimulationStatus =
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

interface Simulation {
  readonly status: SimulationStatus;
  readonly time: SimulationTime;

  step(): Promise<SimulationStep | undefined>;
  run(options?: RunOptions): Promise<RunResult>;
  pause(): void;
  reset(): Promise<void>;
}

interface RunOptions {
  maxEvents?: number;
  maxEventsPerYield?: number;
}

interface RunResult {
  status: "PAUSED" | "COMPLETED";
  reason: "PAUSE_REQUESTED" | "EVENT_LIMIT" | "EMPTY";
  time: SimulationTime;
  processedEvents: number;
  totalEvents: number;
}

interface SimulationStep {
  eventId: EventId;
  time: SimulationTime;
  sequence: number;
  outcome: "COMPLETED" | "SUSPENDED";
}

```

`step()` executes one dequeued event and its synchronous controlled continuation,
then remains paused unless the run completes or fails. It returns `undefined`
if no event remains and there are no tasks. `run()`
continues until completion, a pause request, a configured event limit, or a
failure. `pause()` takes effect after the current deterministic event boundary.

Queued events contain detached canonical data, not closures. A stable event
`type` selects a handler registered before execution begins. Handlers are
synchronous functions or generators yielding simulation-owned operations such
as `clock.sleep()` or virtual network requests. Native async handlers are not
supported by this initial contract; see [ADR-001](adr/001-deterministic-execution.md).

### Lifecycle and errors

| Current state | step / run | pause | reset |
| --- | --- | --- | --- |
| READY | Begin execution | No-op | Reinitialize |
| PAUSED | Continue execution | No-op | Reinitialize |
| RUNNING | Reject `CONTROL_BUSY` | Request pause at boundary | Reject `CONTROL_BUSY` |
| COMPLETED | step returns undefined; run returns COMPLETED/EMPTY with zero processed events | No-op | Reinitialize |
| FAILED | Reject recorded `SimulationError` | No-op | Reinitialize |

An active step or reset also holds the control lock; competing step/run/reset
calls reject `CONTROL_BUSY`. Pause never interrupts a synchronous continuation.
`maxEvents` defaults to unbounded; if supplied it is a non-negative safe integer.
Zero pauses without dispatch. `maxEventsPerYield` defaults to `1000` and must be
a positive safe integer. Invalid options reject `INVALID_RUN_OPTIONS` before
state changes. Host yielding happens only between event boundaries and has no
canonical effect. `processedEvents` counts dequeued events in this call;
`totalEvents` counts them since initialization, including wake events.

At each boundary, failure takes precedence, then completion/deadlock, then a
pause request, then an event limit. Consequently the last event can return a
`SimulationStep` while leaving status `COMPLETED`. All execution failures reject
step/run with `{ code, context }`; they are not successful `RunResult` values.
Reset failure leaves status `FAILED` with `INITIALIZATION_FAILED`. No partial
new simulation is runnable. Hosts request pause and await the outstanding
step/run promise before resetting; `pause()` itself returns no promise.

### Task execution protocol

1. Take the minimum live event, advance the clock to its time, and record event
   start. Invoke its registered handler. Returning `void` completes the event;
   returning a generator creates one task and runs it synchronously to its first
   yield or return. Returning a promise fails with `UNCONTROLLED_ASYNC`.
2. A yielded operation must be a pending kernel handle owned by this task in
   this run attempt. Register the wait and emit suspension before ending the
   boundary. Invalid yields fail with `INVALID_OPERATION`. Operations are created
   lazily while the task executes; no operation completes reentrantly.
3. A later scheduled completion event settles the operation and invokes exactly
   one `next(value)` or `throw(error)` on the suspended generator. Execute until
   its next yield or return. Success for a sleep supplies `null`. Consecutive
   sleeps each allocate a new wake event, including zero-duration sleeps.
4. A resumed task's completion/suspension observations reference its original
   event and task ID; their timestamp is the current wake-event time. The wake
   event also receives its own start/completion observations. A failure context
   contains both the original event ID and the currently dispatched event ID.
5. Only after the synchronous continuation returns or suspends may another event
   dequeue or the host receive control. No host microtask drain is part of this
   algorithm. Empty queue plus no tasks completes; empty queue plus waiting
   tasks fails with `SIMULATION_DEADLOCK`.

Tasks must yield every created operation before returning; unconsumed operations
fail with `UNAWAITED_OPERATION`. A task may have only one outstanding operation;
creating another before yielding fails with `INVALID_OPERATION`. Built-in wake
events settle operations without creating a second user task. Completion races
are ordered by scheduler sequence; late completions are harmless no-ops.
Model handlers must perform bounded synchronous work; arbitrary programs and
preemption of an infinite loop are outside the supported runtime contract.

### Modeled failures and terminal failures

The runtime draft extension in
[ADR-002](adr/002-runtime-model-semantics.md#kernel-integration-refinements)
specifies trusted owner/process task abandonment and deterministic read hooks
after initialization, after event bookkeeping, and at completion/failure. These
hooks preserve the dispatch order above and expose no application mutation port.

Runtime adapters own the boundary between domain behavior and kernel errors.
Timeouts and failed storage/network operations settle controlled operations with
a failure outcome, injected via `generator.throw`. Handlers can catch them and
schedule recovery. Each adapter wraps its user task and translates an uncaught
modeled error into its specified request failure, message NACK, or service crash.
It then returns normally to the kernel. A modeled crash invalidates that
service's affected operations according to the runtime policy, without resetting
other components or rolling back committed business state.

An unexpected exception escaping the adapter, invalid capability use, or kernel
invariant violation terminates the run. Unknown exceptions become
`HANDLER_FAILED` with deterministic event/task context; host messages and stacks
are diagnostics only. A terminal run dispatches no more events and revokes task
capabilities. State remains available for inspection, including committed work.
Observation failures follow the separate terminal-export protocol in
[Observability](observability.md#terminal-failure-and-capacity).

Injected capabilities latch terminal errors in kernel state before throwing.
Runtime adapters must not translate them into modeled failures. Even if model
code catches such an exception, later capability calls reject the latched error
and the boundary terminates the run; it cannot be cleared by a handler. Only
explicit modeled `OperationOutcome` failures are delivered through task
`throw(error)` as recoverable outcomes.

## Owned state

The core is the source of truth for:

- normalized, immutable run inputs: architecture, scenario, configuration, and
  seed;
- lifecycle status and pending pause request;
- deterministic run, task, and handler-registration identities;
- the set of active and suspended controlled tasks;
- registered event handlers;
- composed component runtime state;
- the terminal result or failure.

`VirtualClock` owns current time, `Scheduler` owns queued events and their
sequence allocator, the seeded generator owns random state, and `Observability`
owns execution history. The core owns their lifecycle as parts of the run but
does not duplicate their state.

`reset()` restores all composed state from normalized initial inputs, including
the original seed, empty task set, initial clock, initial queue, component
state, and new execution history. Old generators are abandoned without executing
their `finally` blocks; all old capabilities, including handles and operation
controllers, are revoked through a host-private attempt generation. This
generation does not enter canonical IDs or history.

Factory initialization creates the observation store at the initial clock time,
records `simulation.created`, then invokes the application initializer. Initial
queue events and their scheduler observations follow declared setup order. Reset
produces this same prefix and reuses the deterministic input-derived `runId`.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `simulation.created` | Validated base state exists, before application initialization | `runId`, input fingerprint |
| `simulation.event.started` | Before handler dispatch | Event ID, type, time, sequence |
| `simulation.event.completed` | Handler finishes | Event ID, type, time, sequence |
| `simulation.event.suspended` | Handler awaits controlled work | Event ID, task ID |
| `simulation.event.failed` | Unexpected handler error escapes its adapter | Event ID, stable error code |
| `simulation.completed` | Queue and task set are empty | Final time, event count |
| `simulation.failed` | A terminal invariant or execution error occurs | Stable error code, structured context |

The event failure row and `simulation.failed` are appended only while the
observation sink is healthy; the terminal export always records the final
failure even if append fails. Event completion carries the original scheduled
time separately from its actual observation timestamp for suspended handlers.

`simulation.started`, `simulation.resumed`, `simulation.paused`, and
`simulation.reset` are host-only lifecycle notifications, not observation types.
They allocate no canonical IDs. Host yield duration, browser timing, and stack
traces are also excluded. The host adapter derives lifecycle notifications from
control calls/results; it must not pass them to `ObservationSink.record`.

## Invariants

- **CORE-INV-1:** Events execute only in the order returned by `Scheduler`.
- **CORE-INV-2:** Before dispatch, `VirtualClock.now()` equals the event time
  and never decreases.
- **CORE-INV-3:** The same architecture, scenario, configuration, and seed
  produce the same final state and canonical execution history.
- **CORE-INV-4:** Simulation behavior never calls `Date.now()`,
  `performance.now()`, `setTimeout()`, `setInterval()`, `Math.random()`,
  `fetch()`, or an external network.
- **CORE-INV-5:** Synchronous distributed communication uses `VirtualNetwork`;
  message publication/delivery uses `MessageBus`. External HTTP callbacks use
  `VirtualNetwork` even when triggered asynchronously.
- **CORE-INV-6:** The run completes only when the event queue and controlled
  task set are both empty.
- **CORE-INV-7:** An empty queue with suspended tasks is a deterministic
  `SIMULATION_DEADLOCK`, not successful completion.
- **CORE-INV-8:** Runtime components cannot mutate kernel, clock, scheduler,
  random-generator, or history state except through their public capabilities.
- **CORE-INV-9:** Yielding to the browser may change host responsiveness but
  never simulation time, state, order, or history.

## Explicit non-responsibilities

- It does not define network, message-bus, storage, fault, or business
  semantics; their runtime models own those rules.
- It does not decide equal-time ordering; `Scheduler` owns the
  `(time, sequence)` order.
- It does not calculate time; `VirtualClock` owns logical-time validation and
  state.
- It does not store or query history; `Observability` owns those capabilities.
- It does not execute arbitrary applications, real I/O, or host concurrency.
- It does not control UI animation, playback speed, canvas state, or browser
  timers.
- It does not initially serialize suspended JavaScript continuations for
  snapshots.

## Minimal examples

### Step one event

```ts
// The initializer queues two events so the first step is nonterminal.
const simulation = factory.createSimulation(inputs, initializeTwoEvents);

const step = await simulation.step();

assert.equal(step?.sequence, 0);
assert.equal(simulation.status, "PAUSED");
```

### Suspend and resume on virtual time

```ts
const simulation = factory.createSimulation(inputs, setup => {
  setup.registerHandler("payment.retry", "payments", function* (_event, ctx) {
    yield ctx.clock.sleep(duration(2_000));
    ctx.schedule({ type: "payment.status.check", payload: {} });
  });
  setup.registerHandler("payment.status.check", "payments", () => {});
  setup.schedule({ time: simulationTime(0), type: "payment.retry", payload: {} });
});

await simulation.run(); // no real two-second wait
```

### Detect a deadlock

```ts
// Test fixture: a trusted adapter creates an operation but queues no completion.
const simulation = deadlockFixture();
await assert.rejects(() => simulation.run(), { code: "SIMULATION_DEADLOCK" });
```

## Acceptance criteria

- **CORE-AC-1:** Given a paused run with queued events, when `step()` is called,
  exactly one event is dequeued, the clock advances first, and the run remains
  paused unless that boundary completes or fails the run.
- **CORE-AC-2:** Given a ready or paused run, when `run()` is called, events run
  until completion, a deterministic failure, a pause request, or `maxEvents`.
- **CORE-AC-3:** Given `pause()` during a handler, no later event starts after
  that handler's deterministic boundary.
- **CORE-AC-4:** Given a controlled task awaiting virtual work, other queued
  events may run and the task resumes only from its scheduled completion.
- **CORE-AC-5:** Given an empty queue and no tasks, the status becomes
  `COMPLETED`; given an empty queue and suspended tasks, the status becomes
  `FAILED` with `SIMULATION_DEADLOCK`.
- **CORE-AC-6:** Given an unexpected error escaping a runtime adapter, the core
  records event and simulation failures while the sink is healthy, always seals
  the terminal export, and dequeues no later event.
- **CORE-AC-7:** Given mutations to every composed state, `reset()` produces
  state and identities equal to a fresh simulation from the same inputs.
- **CORE-AC-8:** Given two runs with equal architecture, scenario,
  configuration, and seed, their final state and canonical history are equal.
- **CORE-AC-9:** Static checks find no forbidden time, random, timer, fetch, or
  external-network API in simulation code.
- **CORE-AC-10:** Package-boundary tests prove that core has no dependency on
  UI, scenario, catalog, or assessment packages and runtimes receive no mutable
  core internals.
- **CORE-AC-11:** Changing `maxEventsPerYield` changes neither state nor
  canonical history.
- **CORE-AC-12:** Every event listed above is emitted at its defined transition
  with deterministic required data.
- **CORE-AC-13:** Nested sequential sleeps, two equal-time wakeups, zero-delay
  waits, operation failure caught by a task, and an unconsumed operation follow
  the task protocol; native promises and invalid yields fail deterministically.
- **CORE-AC-14:** Continuous execution, repeated stepping, and pause/resume at
  every boundary produce identical terminal state/history. Reset repeats the
  same canonical prefix/IDs and revokes every old handle without running cleanup.
- **CORE-AC-15:** Filling history during handler execution or failure reporting
  produces one terminal failure without recursive append or global rollback.
  Catching the thrown observation error cannot clear the fatal latch or allow
  further scheduling, recording, or dispatch.
- **CORE-AC-16:** A modeled timeout is caught and retried, and a modeled service
  crash leaves another service running and committed data intact. An unexpected
  adapter exception instead terminates the run.
- **CORE-AC-17:** Every lifecycle-table cell, control-lock conflict, option
  boundary, precedence rule, event counter, and initialization failure is tested.
- **CORE-AC-18:** Construction uses injected ports and fresh model instances;
  initialized events execute without exposing setup or cross-owner capabilities.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| CORE-INV-1, CORE-INV-2 | CORE-AC-1, CORE-AC-4, CORE-AC-13 |
| CORE-INV-3 | CORE-AC-7, CORE-AC-8, CORE-AC-14 |
| CORE-INV-4 | CORE-AC-9, CORE-AC-13 |
| CORE-INV-5 | CORE-AC-18, CONTRACT-AC-4 |
| CORE-INV-6, CORE-INV-7 | CORE-AC-5, CORE-AC-17 |
| CORE-INV-8 | CORE-AC-10, CORE-AC-14, CORE-AC-18 |
| CORE-INV-9 | CORE-AC-11, CORE-AC-14 |
| step | CORE-AC-1, CORE-AC-5, CORE-AC-6, CORE-AC-17 |
| run | CORE-AC-2, CORE-AC-4–6, CORE-AC-13, CORE-AC-15–17 |
| pause | CORE-AC-3, CORE-AC-14, CORE-AC-17 |
| reset | CORE-AC-7, CORE-AC-14, CORE-AC-17 |
| Emission and composition | CORE-AC-12, CORE-AC-18 |

## Architectural alignment and decisions

Architecture §§7–9, 37–39 govern scheduling, time, dependency direction, and
testing. Vision §§15–17 require reproducible faults and inspectable execution.
[ADR-001](adr/001-deterministic-execution.md) records the queue representation,
controlled generator API, composition boundary, and canonical history choices.
No unresolved contract decisions remain for this scope. Complete snapshots and
an async authoring adapter are deferred rather than implicit requirements.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| [Kernel and API](../architecture.md#7-simulation-kernel) | Task execution protocol; lifecycle | CORE-AC-1–6, CORE-AC-13, CORE-AC-17 |
| [Reproducibility](../vision.md#15-deterministic-simulation) | Owned state; canonical events | CORE-AC-7, CORE-AC-8, CORE-AC-11, CORE-AC-14 |
| [Recoverable service crashes](../architecture.md#14-service-lifecycle) | Modeled failures and terminal failures | CORE-AC-16 |
| [Dependency direction](../architecture.md#37-dependency-direction) | Construction via shared ports | CORE-AC-10, CORE-AC-18 |

## References

- [Virtual Clock specification](virtual-clock.md)
- [Scheduler specification](scheduler.md)
- [Observability specification](observability.md)
- [DistLab vision](../vision.md)
- [DistLab architecture](../architecture.md)
- [DistLab glossary](../glossary.md)
