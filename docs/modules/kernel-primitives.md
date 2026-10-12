# Kernel primitives

This reference describes the nine primitive modules and the package entry point
in `packages/kernel/src/` for developers composing or extending a headless
simulation. The remaining source modules are covered in
[Kernel runtimes](kernel-runtimes.md). Shared interfaces come
from `@distlab/contracts` and `@distlab/contracts/kernel`; concrete implementations
and the package exports below are available from `@distlab/kernel`.

VirtualClock supplies modeled time, the scheduler orders events, VirtualNetwork
models request/response transport, and MessageBus models broker delivery. Execution
history stores observations of their work. These are separate responsibilities.
The guarantees below describe the current implementations; reproducible execution
also requires deterministic initialization, handlers, and injected ports.

## `index.ts`: package entry point and public exports

[Source](../../packages/kernel/src/index.ts).

`index.ts` is the export barrel for `@distlab/kernel`: it explicitly re-exports
selected implementations, helpers, and types without adding simulation logic.
The package exposes only its root entry point, resolving runtime imports to
`dist/index.js` and TypeScript declarations to `dist/index.d.ts`.

Its public surface includes the canonical-data helpers, identity and correlation
controllers, history, scheduler, clock, seeded random, headless simulation,
VirtualNetwork, and MessageBus exports described below. It also exposes the
database, key-value store, client, service, external-service, and fault-engine
implementations and their selected supporting types described in
[Kernel runtimes](kernel-runtimes.md).

Module exports are not automatically package exports: `RuntimeSetup` from
`simulation.ts` and `registerRuntimeLogSchema` from `runtime-log.ts` are not
re-exported here. Shared contracts remain in `@distlab/contracts` and
`@distlab/contracts/kernel`.

## `canonical.ts`: canonical values and run fingerprints

[Source](../../packages/kernel/src/canonical.ts).

**Public exports:** `canonicalCopy`, `canonicalEncode`, `sha256Hex`,
`fingerprintRunInputs`.

`canonicalCopy(value)` validates and detaches data, recursively freezing the
result. It accepts null, strings, booleans, finite numbers other than negative
zero, dense arrays, and plain objects with ordinary or null prototypes. Object
copies have null prototypes. Unsupported values, cycles, accessors,
non-enumerable object properties, symbol keys, sparse arrays, and extra array
properties raise `INVALID_RUN_INPUT`. Ordinary accessor properties are inspected
through descriptors rather than invoked. Repeated references without a cycle
are copied independently.

`canonicalEncode` serializes a canonical value as JSON, preserving array order
and sorting object keys lexicographically by UTF-16 code units. It assumes its
argument is already canonical. `sha256Hex` hashes the UTF-8 encoding of a string
and returns a lowercase hexadecimal SHA-256 digest. `fingerprintRunInputs`
copies and validates its input before returning
`run:<SHA-256 of canonical encoding>`; it does not normalize the seed itself.

History, scheduling, and transports use canonical copies to isolate stored data
from caller mutation. Simulation normalizes its seed before fingerprinting.

```ts
import { canonicalCopy, canonicalEncode } from "@distlab/kernel";

const snapshot = canonicalCopy({ z: [1, true], a: "value" });
canonicalEncode(snapshot); // '{"a":"value","z":[1,true]}'
```

## `clock.ts`: VirtualClock

[Source](../../packages/kernel/src/clock.ts).

**Public exports:** `DeterministicVirtualClock`, `addDuration`, and the types
`ClockOptions`, `SleepPort`.

`DeterministicVirtualClock` implements VirtualClock and its trusted controller.
`now()` returns the stored virtual time, initially the configured start time or
zero. `addDuration` validates time and duration through the contracts and raises
`TIME_OVERFLOW` if their sum is not a safe integer.

`advanceTo` rejects a rewind with `CLOCK_REWIND`. A change records
`clock.advanced`, optionally tied to the causing event; advancing to the same
time records nothing. `reset` sets the supplied time, configured start time, or
zero, and invalidates capabilities issued by this clock's previous generation.
It does not reset the scheduler or history.

`schedule(delay, type, payload, metadata)` computes an absolute due time and
delegates to the scheduler, copying metadata. Its returned cancellation handle
checks the clock generation. `forOwner` exposes an immutable VirtualClock
capability that allows only the owner's permitted event types, fixes source and
target to that owner, and rejects conflicting metadata. The controller retains
time advancement and reset authority.

`sleep(delay)` requires an active controlled task and a `SleepPort`, otherwise
raising `NO_ACTIVE_TASK`. The port creates an operation and schedules its wake;
the clock records `clock.sleep.scheduled`. The core calls `resumeSleep` when
resuming the task, recording `clock.sleep.resumed`. Sleep returns a controlled
operation to yield from a generator, rather than a host promise.

```ts
import { addDuration } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";

addDuration(simulationTime(10), duration(5)); // virtual time 15
```

## `identity.ts`: namespaced identities and correlation

[Source](../../packages/kernel/src/identity.ts).

**Public exports:** `DeterministicIdAllocator`,
`DeterministicCorrelationController`, `isIdentifier`.

`isIdentifier` accepts any nonempty string. `DeterministicIdAllocator` validates
its prefix, run namespace, and nonnegative safe-integer starting sequence. Each
successful `allocate()` returns `<prefix>:<runId>:<sequence>` and then increments
the sequence. `canAllocate()` is false at `Number.MAX_SAFE_INTEGER`;
`IDENTITY_OVERFLOW` leaves the counter unchanged. `nextSequence` exposes the
next value for inspection and recovery tests. Separate allocators are independent;
their uniqueness depends on the namespace and sequence assigned by the caller.

`DeterministicCorrelationController.root()` preflights trace and span allocation
and returns a frozen root context. `child(parent)` accepts only a context whose
trace, span, and parent-span fields match a stored context; it preserves the
trace and creates a new span pointing to the parent. Unknown parents raise
`INVALID_OBSERVATION`. `hasSpan` checks the exact stored relationship.

Scheduler event identities use their own sequence. History, simulation tasks and
operations, VirtualNetwork correlation, and MessageBus identities use allocators.

```ts
import { DeterministicIdAllocator } from "@distlab/kernel";

const ids = new DeterministicIdAllocator("task", "example-run");
ids.allocate(); // "task:example-run:0"
ids.allocate(); // "task:example-run:1"
```

## `random.ts`: seeded draws

[Source](../../packages/kernel/src/random.ts).

**Public export:** `SeededRandom`.

`SeededRandom` implements `SeededRandomPort`. It rejects blank seeds, trims and
NFC-normalizes accepted seeds, hashes them with SHA-256, and derives four
32-bit state words with SplitMix32. Draws use the xoshiro128** state transition.
Each frozen result contains a zero-based `index`, the contract's
`SEEDED_RANDOM_ALGORITHM` identifier, a `uint32`, and `unit = uint32 / 2 ** 32`
in `[0, 1)`.

The same normalized seed and draw order produce the same sequence. A label must
be a nonempty string, but does not select a separate stream or affect the result.
Invalid labels raise `INVALID_OPERATION` before state advances. Draw-index
overflow raises `IDENTITY_OVERFLOW`. `revoke()` permanently disables subsequent
draws on that instance with `STALE_CAPABILITY`.

Simulation counts successful draws through its guarded random port. VirtualNetwork
uses that port for jitter and probabilistic loss. Reset constructs a fresh random
port with the stored normalized seed.

## `scheduler.ts`: ordered pending events

[Source](../../packages/kernel/src/scheduler.ts).

**Public exports:** `DeterministicScheduler`, type `SchedulerOptions`.

`DeterministicScheduler` maintains a heap ordered by `(time, sequence)`. Equal-time
events dispatch in allocation order. Successful scheduling allocates a zero-based
sequence and an ID `event:<runId>:<sequence>`; cancellation does not reuse it.
Sequence exhaustion raises `SEQUENCE_OVERFLOW`.

Scheduling canonically copies the draft and payload, validates the allowed
fields, registered type, metadata identifiers, correlation field dependencies,
and optional target against the handler owner. Events before `clock.now()` raise
`EVENT_IN_PAST`. Invalid input is rejected before sequence allocation.
`forOwner` restricts scheduling to allowed local types and fixes source and
target to the owner.

`peek()` reads the earliest event; `takeNext()` removes it and records dispatch.
Neither advances VirtualClock nor invokes a handler. `cancel(id)` returns false
for an absent event and records cancellation only when it removes one. Scheduling
records `scheduler.event.scheduled`; removal records
`scheduler.event.dispatched` or `scheduler.event.cancelled`.

`pending()` returns a frozen ordered view without payloads; `size()` reports its
count. `exportState()` includes ordered full events and the next sequence.
`restore()` accepts only a pristine scheduler, validates the matching run,
event IDs, unique sequences below the next sequence, and current draft rules,
then rebuilds pending events without scheduling observations. Restore and reset
invalidate issued handles and owner capabilities. Reset empties the queue,
restarts sequence allocation, and permits restore again.

Simulation takes an event, advances VirtualClock to its due time, then executes
its handler. Transports and sleep use this same ordering, including deadline ties.

## `history.ts`: immutable execution history

[Source](../../packages/kernel/src/history.ts).

**Public exports:** `ExecutionHistory`, types `ExecutionHistoryOptions`,
`VirtualTimeSource`.

`ExecutionHistory` implements the observation sink, reader, and history
controller. Each observation type must have one registered validation function;
types use dotted lowercase names. `record()` validates the input, canonical data,
schema result, identifiers, entity references, and correlation dependencies.
An observation's `causationId`, when present, must identify an earlier stored
observation. Successful records receive a namespaced ID, zero-based sequence,
schema version 1, and the current VirtualClock time.

Visibility is applied after schema validation and before storage. `visible`
retains canonical data; `summary` selects the configured top-level fields from
object data; `redacted` stores `{ redacted: true }`; `omitted` stores no data
field. Readers and exports see only this transformed data. History retains no
alternate unredacted payload in its records.

`all()` and `query()` return frozen arrays in record order; `byId()` retrieves
one record. Filters combine time bounds (inclusive), type, component (source or
target), trace, event, and entity. Records and their canonical data are immutable.
`export()` returns schema version, run ID, observations, and a terminal failure
if sealed.

`record()` queues notifications without invoking listeners. The host calls
`flushNotifications()` after a control operation; callbacks run in record and
registration order. A throwing listener is disabled. Recording during delivery
raises `OBSERVER_REENTRANCY`. `sealFailure()` prevents future records with
`HISTORY_SEALED`; repeating the same failure is allowed, changing it is not.
The positive `historyLimit` is a hard limit, raising `HISTORY_LIMIT_EXCEEDED`
rather than dropping old records. Simulation records whether terminal history
could be completed when failure recording itself cannot succeed.

## `simulation.ts`: headless composition and controlled execution

[Source](../../packages/kernel/src/simulation.ts).

**Public exports:** `HeadlessSimulation`, `HeadlessSimulationFactory`, types
`HeadlessFactoryOptions`, `CoreClockPort`, `CoreSchedulerPort`, `CoreHistoryPort`.
The module also exports `RuntimeSetup`, which is not re-exported by the package
entry point.

The factory creates a simulation from canonical run inputs and a synchronous
initialization callback. Simulation validates required input fields, contract
version, configuration, and seed, normalizes the seed, and computes the run
fingerprint. Composition creates fresh clock, scheduler, history, random, task,
and operation state. Options can inject primitive constructors, a boundary hook,
VirtualNetwork, MessageBus, and key-value definitions.

Initialization registers handlers and observation schemas and schedules initial
events through `RuntimeSetup`. The first setup scheduling call seals handler,
schema, and transport registration; initialization completion seals it as well.
Reserved simulation, scheduler, clock, and kernel event/schema namespaces cannot
be registered by models. Setup scheduling capabilities expire after initialization.
Handler contexts expose owner-bound VirtualClock and local scheduling, and enforce
the recording component as observation source.

`step()` dispatches at most one pending event. `run()` dispatches until completion,
a requested pause, or `maxEvents`; its default `maxEventsPerYield` is 1000.
Yielding through a host `MessageChannel` occurs between event boundaries and does
not advance modeled time. `pause()` requests a stop between events while running.
Concurrent step, run, or reset controls raise `CONTROL_BUSY`. Empty scheduling
with no tasks completes the run; an empty queue with suspended tasks raises
`SIMULATION_DEADLOCK`.

Handlers return either nothing or a controlled generator. A generator must yield
the exact operation handle it just created. Completion resumes it with canonical
success data or throws a modeled failure into it. Uncontrolled promises raise
`UNCONTROLLED_ASYNC`, and returning with an unyielded operation raises
`UNAWAITED_OPERATION`. Trusted task-lifecycle abandonment fences the owner's
process generation, removes its tasks, and settles their outstanding operations.

Failures latch `FAILED`, seal terminal history, and remain authoritative even if
model code catches a guarded error. `reset()` reruns composition and initialization
with the stored inputs, clears counters, and invalidates prior run-bound mutation
capabilities. A history reader already obtained continues to read its old attempt.
`pendingEvents`, `processedEvents`, and `randomDrawCount` expose explicit counters;
history visibility does not determine these values. A run result's `processedEvents`
counts that run call's dispatches, while `totalEvents` counts successfully processed
events across calls within the attempt.

## `network.ts`: VirtualNetwork request/response transport

[Source](../../packages/kernel/src/network.ts).

**Public exports:** `DeterministicVirtualNetwork`, types `NetworkLinks`,
`NetworkSetup`, `NetworkFlight`, `NetworkOptions`.

VirtualNetwork uses declared directed links between unique target IDs. Each link
defaults to request/response latency 0, jitter 0, timeout 1000, and failure rate 0.
Latencies and jitter are nonnegative safe integers; timeout is positive and failure
rate is in `[0, 1]`. Controllers register one receiver per target before sealing.
`forOwner` issues a request capability for a declared component; requests require
that component's active controlled task, a declared link, a nonblank endpoint,
and a canonical body.

A request creates a controlled operation whose ID is also its request ID. The
transport records `network.request.sent`, propagates or allocates trace/span
correlation, schedules its deadline first, then schedules delivery. Each request
and response leg independently adds integer jitter in `[0, jitter]`, evaluates
loss, and applies injected delay/drop faults. Zero jitter consumes no draw;
failure rates 0 and 1 consume no loss draw. Fail or duplicate fault effects are
rejected with `INVALID_FAULT`.

Receiver admission and `accept` run in a scheduled delivery event. Missing
receivers produce a modeled `TARGET_UNAVAILABLE` error reply; an optional trusted
admission adapter may also return `ENDPOINT_NOT_FOUND`. Controller replies require
active dispatch, canonical `ok`/`error` reply bodies, and an admitted, timed-out,
or already-replied request. Only the first valid reply sends a response.

The first received response cancels the deadline and completes the operation
successfully with the whole reply, including an `error` reply status. Deadline
expiry instead fails the operation with `NETWORK_TIMEOUT`. A response scheduled
exactly at the deadline loses the sequence tie. Timeout does not cancel delivery
or receiver work: a later response is recorded with `late: true` and cannot
complete the operation again. Dropped legs are observed and leave timeout to
settle the request.

`handlers()` supplies the core's deadline, delivery, and response handlers.
`hasLink()` checks topology; `inFlight()` returns frozen summaries of unsettled
requests, without bodies. `NetworkSetup.enqueueNetworkWork` lets trusted adapters
schedule target-owned work during dispatch. Simulation rebuilds the transport
and fences its capabilities on reset.

## `message-bus.ts`: MessageBus admission and delivery

[Source](../../packages/kernel/src/message-bus.ts).

**Public exports:** `DeterministicMessageBus`, `neutralFaultPort`, types
`MessageDestinationInput`, `MessageCounterStart`, `MessageBusOptions`,
`MessageBusInspection`.

MessageBus defines queues and topics with unique IDs. Destination defaults are
delivery delay 0, acknowledgement timeout 1000, retry delay 0, maximum attempts 3,
and capacity 10000. Delays are nonnegative safe integers; timeout, attempts, and
capacity are positive. Controllers subscribe consumers before sealing; each
destination/consumer pair is unique and supplies `ready` and `accept` callbacks.

An owner-bound `publish` requires a sealed bus and the owner's active controlled
task. It copies a message with exactly `type` (a nonempty string) and `body`, then
schedules admission at the current virtual time. Publication success returns
`{ messageId }` after admission, independently of consumer acknowledgement.
Capacity counts active routing records, excluding `ACKED` and `DEAD`. Admission
checks all required recipients before creating records; rejection fails publication
with `BUS_CAPACITY_EXCEEDED`.

A queue creates one routing record. A topic creates one per registered subscriber
in registration order; a topic with no subscribers succeeds with zero recipients.
Dispatch reserves the oldest eligible routing record, allowing an unavailable
record to be skipped. Queues choose ready, unreserved consumers by a round-robin
cursor; topics target their assigned subscriber. Reservation is per subscription.

Each attempt schedules delivery arrivals and an acknowledgement deadline at
`first arrival time + ackTimeout`. The deadline is inserted before arrivals,
so acknowledgement at that exact deadline loses the sequence tie. Injected
`message.delivery` faults can delay, drop, or add up to 16 copies with spacing;
`fail` is invalid. Each copy has a distinct delivery ID and span. A drop still
leaves an attempt waiting for its deadline. An arrival after settlement or from
an old attempt records a drop instead of invoking the receiver.

Acknowledgement requires active dispatch and a known delivery ID. A live `ack`
settles the routing record, cancels its deadline, and releases the subscription.
A live `nack`, unavailable receiver at arrival, or timeout releases the reservation
and schedules retry after `retryDelay`, or records a dead letter when attempts
are exhausted. Retrying preserves message ID, routing ID, and original ordering;
new deliveries receive new IDs. Known stale acknowledgements record
`message.ack.stale` without settling newer work. Duplicate copies and retries
can invoke the receiver more than once; the bus does not deduplicate business effects.

`handlers()` supplies admission, dispatch, arrival, timeout, and retry handlers.
`consumerChanged` schedules eligible dispatch after a readiness change during
dispatch. `inspect()` returns a detached frozen snapshot of destinations,
subscriptions, ordered routing records, dead letters, queue cursors, and allocation
counters. MessageBus observations include message, destination, routing, and
delivery entity references where applicable, with publication/delivery correlation.
`neutralFaultPort` returns no fault effects. Simulation reconstructs the bus on
reset, including identity counters and subscriptions established by initialization.
