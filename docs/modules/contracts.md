# Contracts modules

`@distlab/contracts` encodes the public API defined by [docs/spec](../spec/contracts.md).
This guide covers every TypeScript source module under
`packages/contracts/src/`, including `kernel/`. Source links identify the
exports; specification links define their required semantics.

Most exports are types and interfaces, erased by TypeScript. Their invariants
are requirements for implementations, not validation performed by importing
this package. Runtime exports are observation-name objects, error-code objects,
version/catalog constants and reference data, plus `simulationTime`, `duration`,
and `throwSimulationError`. The package implements no clock, scheduler, network,
storage, runtime, scenario engine, or projection builder.

Consumers import shared contracts from `@distlab/contracts` or its narrower
`@distlab/contracts/kernel` entry point. Dependencies point toward this neutral
package: kernel and runtime implementations consume its ports; scenario and
catalog packages compose those implementations; the browser host consumes
protocols and projections. Contracts import only other contract modules, never
implementations or UI. A controller's export does not authorize a UI to use it.
The worker composition root injects trusted ports and owner-bound capabilities.
See [Application Boundary](../spec/application-boundary.md) and
[ADR-001](../spec/adr/001-deterministic-execution.md).

Examples construct values or use injected capabilities. They do not instantiate
runtime models. Generator examples must run as controlled tasks in the simulator.

## Source module: `index.ts`

[Source](../../packages/contracts/src/index.ts).

**Exported API:** The root barrel re-exports the kernel barrel, network,
message bus, database, KV store, faults, logging, service/client/external
contracts, scenario contracts, application protocol, and MVP catalog contracts.
It also exports `ObservationTypes` and `KnownObservationType` explicitly.

**Invariants:** Importing the entry point must not load runtime implementations,
application packages, or UI. Re-exported interfaces retain the constraints of
their owning modules.

**Dependency direction:** Outward public entry point to local contract modules;
implementation and host packages depend on this entry point.

```ts
import { duration, ObservationTypes } from "@distlab/contracts";
import type { WorkerCommand } from "@distlab/contracts";

const command: WorkerCommand = { version: 1, requestId: "step-1", type: "step" };
const delay = duration(20);
const requestType = ObservationTypes.network.RequestSent;
```

## Source module: `application.ts`

[Source](../../packages/contracts/src/application.ts) ·
[Specification](../spec/application-boundary.md).

**Exported API:** `ComponentNodeProjection`, `ArchitectureProjection`,
`SimulationProjection`, `ExecutionHistoryProjection`, `ComponentStateProjection`,
`RuntimeProjectionSet`, `ApplicationError`, `WorkerCommand`, and `WorkerEvent`.
Commands are version-1 `load`, `run`, `pause`, `step`, and `reset` variants;
events carry acknowledgments, projections, completion status, or errors.

**Invariants:** Projections must be canonical, detached, frozen values without
writable runtime handles. Component visibility is `student`, `assessment`, or
`host`. Projection kinds are `client`, `service`, `external`, or
`infrastructure`. Status is a projection field, not another command. Counters
come from explicit simulation reads, never inferred from visible history.
Terminal responses echo the command's `requestId`; unsolicited
`projection.updated` may omit it. Updates occur at safe boundaries. Presentation
playback changes UI state only and cannot advance virtual time or record history.

**Dependency direction:** Type-only dependencies on kernel canonical values,
identities, observations, simulation status, and time. Hosts and workers share
these shapes; kernel implementations do not depend on the application protocol.

## Source module: `client.ts`

[Source](../../packages/contracts/src/client.ts) ·
[Specification](../spec/client-runtime.md).

**Exported API:** `ClientObservationTypes`, `ClientActionStatus`, `ClientState`,
`ClientContext`, `ClientAction`, `ClientCallback`, `ClientDefinition`, and
`ClientController`. Definitions supply versioned action/callback functions and
initial client state; context supplies network, clock, logging, and client state.

**Invariants:** Client communication uses `VirtualNetwork`; no database or bus
capability is supplied. Actions return canonical results or controlled
`ServiceTask`s; callbacks return `NetworkReply`s or tasks. State reads return
`undefined` for absence and writes are synchronous, detached, and local to the
client. Actions and retries are explicit; timeout never proves remote failure.
The controller starts recorded actions through the scenario adapter, not UI
mutation of a live run.

**Dependency direction:** Kernel value/identity/clock types, logging and network
contracts, and the task type from `service.ts`; no concrete service dependency.

## Source module: `database.ts`

[Source](../../packages/contracts/src/database.ts) ·
[Specification](../spec/database.md).

**Exported API:** `DatabaseObservationTypes`, `DatabaseRow`, `TableDefinition`,
`DatabaseDefinition`, `Transaction`, and `Database`. Definitions describe owner,
tables, unique-field tuples, named checks, and initial keyed rows. `Database.begin`
returns a handle for reads, scans, staged writes, commit, and rollback.

**Invariants:** Only the assigned internal service may write. One open
transaction per task reads a private snapshot plus staged writes. Commits are
zero-delay controlled operations and must be yielded; all staged changes commit
atomically or none do. Database-wide optimistic revision checks can reject even
unrelated-row concurrent writes. Committed state satisfies constraints and
survives service crash; uncommitted transactions are discarded. The contract
provides no cross-resource transaction or automatic retry.

**Dependency direction:** Kernel canonical values, component IDs, and controlled
operations only. Service contracts reference the database capability.

```ts
import type { ServiceTask, Transaction } from "@distlab/contracts";

function* commit(tx: Transaction): ServiceTask<null> {
  yield tx.commit();
  return null;
}
```

## Source module: `external.ts`

[Source](../../packages/contracts/src/external.ts) ·
[Specification](../spec/external-service-runtime.md).

**Exported API:** `ExternalObservationTypes`, `ExternalAvailability`,
`CallbackPlan`, `ProviderDecision`, `ExternalOperation`, `ExternalDefinition`,
`ExternalBehavior`, `ExternalRuntime`, and `ExternalController`. An operation's
synchronous `apply` returns next state, reply, declared visible changes, and
callback plans. Behavior specifies latency, degraded extra latency, response
suppression, and canonical parameters.

**Invariants:** Availability is `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`, or
`RATE_LIMITED`. Admission captures behavior; subsequent changes affect new
admissions. Provider effects and replies are independent: response suppression
or caller timeout cannot undo a committed effect. Callbacks use modeled network
requests. Catalog operation code has no database, kernel, or host I/O capability.
Idempotency belongs to the versioned operation, not an automatic runtime rule.
Configuration and availability controllers are scenario/fault adapter ports.

**Dependency direction:** Kernel values/identities/time and network request/reply
contracts. Internal services receive no provider-internal mutation capability.

## Source module: `fault.ts`

[Source](../../packages/contracts/src/fault.ts) ·
[Specification](../spec/fault-engine.md).

**Exported API:** `FaultObservationTypes`, `FaultPoint`, `FaultProbe`,
`FaultEffect`, `FaultRule`, `FaultDecision`, `FaultDecisionPort`, `ScheduledFault`,
and `FaultController`. Probe points are network request/response, message
delivery, and database commit. Effects are delay, drop, fail, duplicate, or
disconnect; scheduled faults are service crash or external availability changes.

**Invariants:** Immutable rules are evaluated in declaration order in
`[from, until)` windows, with bounded applications and seeded probability.
Normalization supplies probability and application defaults of 1; the normalized
interface requires both fields. `until`, when present, exceeds `from`.
Duplicate is message-only, disconnect is network-request-only, and fail is the
only database-commit effect. Owners apply decisions through modeled scheduling;
faults cannot directly mutate peers. Each original probe is evaluated once.
Timeout is an absent/late reply, not a fault kind; rate limiting is scheduled
external availability.

**Dependency direction:** Kernel component IDs and time types only. Models
consume the neutral decision port rather than importing a concrete fault engine.

## Source module: `kv-store.ts`

[Source](../../packages/contracts/src/kv-store.ts) ·
[Specification](../spec/kv-store.md).

**Exported API:** `KeyValueObservationTypes`, `SetOptions`, `ExpectedValue`,
`KeyValueDefinition`, and `KeyValueStore`. The port exposes `get`, `set`,
`delete`, `increment`, and `compareAndSet`; definitions bind initial entries to
one owner. Tagged expected values distinguish an absent key from a present null.

**Invariants:** Operations are synchronous and atomic per key in an owner task.
Values are detached; comparisons use canonical structural equality. At
`now >= expiresAt` an entry is absent even before its expiry event dispatches.
TTL must be positive although `Duration` permits zero. Generation checks prevent
old expiry work deleting replacements. `increment` adds one, treating absence
as zero and retaining an existing expiry. This port does not participate in
Database transactions; unexpired state survives service crash.

**Dependency direction:** Kernel canonical values, component IDs, and duration
only. Services receive their assigned store capability.

```ts
import { duration, type KeyValueStore } from "@distlab/contracts";

function claim(store: KeyValueStore, key: string): boolean {
  return store.set(key, true, { ifAbsent: true, ttl: duration(1000) });
}
```

## Source module: `logging.ts`

[Source](../../packages/contracts/src/logging.ts) ·
[Specification](../spec/service-runtime.md).

**Exported API:** `RuntimeObservationTypes` (`runtime.log`), `LogLevel`
(`debug`, `info`, `warn`, `error`), and `RuntimeLogger.write`.

**Invariants:** Logging validates canonical optional data and records
synchronously through controlled observations; it performs no host I/O. The
interface does not implement a logger or export a console adapter.

**Dependency direction:** Kernel canonical values only. Service and client
contexts reference this shared port.

## Source module: `message-bus.ts`

[Source](../../packages/contracts/src/message-bus.ts) ·
[Specification](../spec/message-bus.md).

**Exported API:** `MessageObservationTypes`, `DestinationKind`,
`MessageRoutingState`, `DestinationDefinition`, `BusMessage`, `Delivery`,
`MessageBus`, `MessageReceiver`, and `MessageBusController`. Publish returns a
controlled admission operation; the trusted controller subscribes receivers,
acknowledges live delivery IDs, and signals consumer readiness changes.

**Invariants:** Admission success resumes with `{ messageId }`, not proof of
consumption. Queues choose an ordinary consumer per attempt; topics settle
subscriptions independently. Attempts and capacity are bounded; duplicates
preserve logical message identity and do not guarantee exactly-once effects.
Only live delivery attempts can settle. Subscriptions are initialization-only.
Normalized destination fields are required: delay/retry defaults are 0,
ACK timeout 1000 ms, maximum attempts 3, and capacity 10000. These defaults
are supplied by normalization, not this module. Routing states describe records;
`PUBLISHED`, `NACKED`, and `RETRY` may occur within a single dispatch, while
`DROPPED` concerns an individual copy.

**Dependency direction:** Kernel values, identities, operations, and time.
Service handlers and scenario architecture depend on these broker contracts.

## Source module: `mvp-catalog.ts`

[Source](../../packages/contracts/src/mvp-catalog.ts) ·
[Specification](../spec/mvp-catalog-scenario.md).

**Exported API:** `MvpCatalogModels`, `MvpCatalogVersions`,
`OrderCreatedDestination`, `CheckoutResponseLostScenarioId`, `CheckoutRequest`,
`OrderCreatedMessage`, `OrderState`, `PaymentState`, `MvpComponentVersion`,
`ReferenceAssertionDefinition`, and `CheckoutResponseLostAssertions`.

**Invariants:** The four named models are Customer App, Orders, Payments, and
Payment Processor, with version `1.0.0`. The destination is `OrderCreated`,
the reference scenario is `checkout-processor-response-lost@1`, order state is
`CREATED`, and payment states are `AUTHORIZING`, `AUTHORIZED`, and `UNKNOWN`.
Reference assertion data describes six required outcomes; it contains no
predicate implementations, assertion timing, or model factories. A lost
processor response leaves Payments uncertain while the provider may have
committed authorization. TypeScript `readonly`/`as const` annotations do not
perform runtime freezing or payload validation.

**Dependency direction:** Kernel canonical values and component IDs only.
Catalog implementations and scenario fixtures consume these stable names and
payload shapes.

## Source module: `network.ts`

[Source](../../packages/contracts/src/network.ts) ·
[Specification](../spec/virtual-network.md).

**Exported API:** `NetworkObservationTypes`, `NetworkPolicy`, `NetworkRequest`,
`NetworkReply`, `VirtualNetwork`, `NetworkReceiver`, and `NetworkController`.
Replies have `ok` or `error` status and canonical bodies; requests identify a
target and endpoint. Registration/reply are trusted adapter operations.

**Invariants:** Owner-bound requests fix source and correlation. Handler work
starts only after modeled delivery. Request and response legs share the
request's directed policy. A caller settles once; timeout neither cancels target
work nor proves failure. Policy durations are normalized, timeout is positive,
and failure rate is finite in `[0, 1]`. Latency/jitter default to zero and timeout
to 1000 ms during normalization; interfaces do not apply defaults.
Registration is initialization-only.

**Dependency direction:** Kernel values, IDs, controlled operations, and duration.
Service, client, external, and scenario contracts use these transport shapes.

## Source module: `observation-types.ts`

[Source](../../packages/contracts/src/observation-types.ts) ·
[Specification](../spec/observability.md).

**Exported API:** `ObservationTypes` groups constants under simulation, clock,
scheduler, network, message, database, kv, service, client, external, fault,
scenario, and runtime. `KnownObservationType` is the union of their string
values; the recursive helper `NestedValues` is private.

**Invariants:** Grouping keeps identically named members such as
`CallbackCompleted` distinct across owners. This is a runtime vocabulary object,
not schema registration or validation. `ObservationType` remains an open string
type for registered extensions; the known union covers this exported vocabulary.

**Dependency direction:** Value imports of observation constants from their
owning contract modules, including kernel clock/scheduler/simulation modules;
no observation-store implementation is imported.

## Source module: `scenario.ts`

[Source](../../packages/contracts/src/scenario.ts) ·
[Specification](../spec/scenario-engine.md).

**Exported API:** `ScenarioObservationTypes`, `ComponentKind`,
`ComponentInstance`, `ArchitectureDefinition`, `ScenarioAction`,
`ScenarioAssertion`, `ScenarioDefinition`, `ScenarioDiagnostic`,
`AssertionResult`, `ScenarioSession`, and `ScenarioEngine` (`validate`/`create`).
Actions cover client, service, external availability, external behavior, and
scheduled faults. Assertion results are `PENDING`, `PASS`, `FAIL`, or `INCOMPLETE`.

**Invariants:** Definitions represent normalized experiments, with explicit
required lists and applied defaults. `ComponentKind` uses `client`, `service`,
and `external`, excluding infrastructure; these names differ deliberately from
`ComponentCategory`. Validation is pure and cannot allocate identities, execute
behavior, or draw randomness. Declared order breaks same-time action ties;
services need explicit startup. Assertion modes require appropriate timing:
`at` has only `at`, `eventually` only a finite deadline, and `always` neither.
The interface alone does not enforce those combinations. Assessment reads
completed boundaries; pauses leave unresolved assertions pending and terminal
failure makes them incomplete. `results` reads snapshots without re-evaluation.

**Dependency direction:** Type-only references to kernel simulation/inputs/time
and runtime definition/policy types. The Scenario Engine implementation belongs
to the application layer; kernel/runtime implementations must not import it.

## Source module: `service.ts`

[Source](../../packages/contracts/src/service.ts) ·
[Specification](../spec/service-runtime.md).

**Exported API:** `ServiceObservationTypes`, `ServiceState`, `ServiceContext`,
`ServiceTask<R>`, `EndpointHandler`, `ConsumerHandler`, `BackgroundHandler`,
`ServiceDefinition`, `ServiceRuntime`, and `ServiceController`. Definitions hold
versioned catalog code, not serialized scenario data; consumer keys name bus
destinations. Context binds optional owned DB/KV and bus, network, clock, logging.

**Invariants:** States are `STARTING`, `RUNNING`, `PAUSED`, `CRASHED`, and
`STOPPED`. Only RUNNING admits work; PAUSED allows admitted tasks to finish.
CRASHED/STOPPED abandon tasks without generator cleanup, discard uncommitted
transactions, and preserve committed resources. Communication uses network or
bus. Handlers are synchronous or controlled generators, never native async
functions. Lifecycle transitions are trusted scheduled actions, not direct UI
writes. A process restart and whole-simulation reset have different semantics.

**Dependency direction:** Kernel values/IDs/operations/clock and database,
KV, logging, message, and network contracts. No runtime model is constructed.

```ts
import { duration, type EndpointHandler } from "@distlab/contracts";

const endpoint: EndpointHandler = function* (_body, ctx) {
  yield ctx.clock.sleep(duration(10));
  return { status: "ok", body: null };
};
```

## Source module: `kernel/index.ts`

[Source](../../packages/contracts/src/kernel/index.ts) ·
[Specification](../spec/contracts.md).

**Exported API:** The `@distlab/contracts/kernel` barrel exports canonical
values, identities/version, structured errors, validated time constructors,
operations, events, correlation, clock, scheduler, random, observability, and
simulation contracts.

**Invariants:** This entry point exposes no application worker protocol,
scenario types, runtime model definitions, MVP catalog, or aggregate
`ObservationTypes`. Its exported controllers remain trusted infrastructure ports.

**Dependency direction:** Only local kernel contract modules. The root barrel
re-exports it; kernel consumers can depend on the narrower surface.

## Source module: `kernel/canonical.ts`

[Source](../../packages/contracts/src/kernel/canonical.ts) ·
[Specification](../spec/contracts.md).

**Exported API:** `CanonicalValue`, a recursive union of null, boolean, number,
string, readonly arrays, and string-keyed objects.

**Invariants:** Actual canonical inputs permit finite numbers, dense arrays,
and plain objects with own enumerable string data properties. Negative zero,
undefined, cycles, accessors, symbols, functions, and class instances are
rejected by implementations. Optional fields are absent. Canonical copying
detaches/freezes values; encoding sorts object keys and preserves array order.
The union itself cannot validate these restrictions and exports no codec.

**Dependency direction:** No imports; the foundational value type is used
throughout the contract package.

## Source module: `kernel/clock.ts`

[Source](../../packages/contracts/src/kernel/clock.ts) ·
[Specification](../spec/virtual-clock.md).

**Exported API:** `ClockObservationTypes`, `ScheduledHandle`, `VirtualClock`,
`ClockController`, and `VirtualClockState`. Public operations are `now`, `sleep`,
and `schedule`; the kernel controller advances/resets logical time.

**Invariants:** Time is monotonic within a run and independent of host time.
`sleep` returns a controlled operation to yield. Zero delay queues same-time
work with later sequence rather than invoking it reentrantly. Scheduling is
owner-bound; components cannot impersonate peers. A handle's `cancel` returns
true only when pending work was cancelled. Runtime code never receives the
clock controller.

**Dependency direction:** Kernel values, event IDs/metadata, operations, and time;
scheduler contracts reference `ScheduledHandle`.

## Source module: `kernel/correlation.ts`

[Source](../../packages/contracts/src/kernel/correlation.ts) ·
[Specification](../spec/contracts.md#correlation).

**Exported API:** `CorrelationContext` (trace, span, optional parent span) and
`CorrelationController.root`/`child`.

**Invariants:** Trusted adapters allocate immutable contexts: root creates a
trace/root span; child creates a span in the parent's trace. Invalid parents
allocate nothing. Causation refers to an earlier observation, while event IDs
identify scheduled work; these are separate relationships. Neither UI nor
application handler may invent allocator state.

**Dependency direction:** Kernel trace/span identity types only.

## Source module: `kernel/errors.ts`

[Source](../../packages/contracts/src/kernel/errors.ts) ·
[Specification](../spec/simulation-core.md#modeled-failures-and-terminal-failures).

**Exported API:** `SimulationError`, `ErrorCodes`, `KnownErrorCode`,
`ModeledErrorCodes`, `ReplyErrorCodes`, and `throwSimulationError`.

**Invariants:** Structured errors have stable string codes and canonical context;
host messages/stacks are diagnostics. `SimulationError.code` remains open to
future codes. Modeled errors can be caught by tasks; reply-body errors travel
in network replies; other listed codes terminate the run. The runtime helper
throws an `Error` augmented with `code` and `context` (default null). It does
not independently validate/copy context or execute simulator failure handling.

**Dependency direction:** Kernel canonical values only. Time constructors use
the helper and shared invalid-number codes.

## Source module: `kernel/events.ts`

[Source](../../packages/contracts/src/kernel/events.ts) ·
[Specification](../spec/contracts.md).

**Exported API:** `ScheduleMetadata`, `ScheduledEvent<T>`, `EventDraft<T>`,
and `PendingEventSummary` (a scheduled event without payload).

**Invariants:** Queued work is serializable canonical data, not closures.
Scheduled records have an ID, logical time, unique sequence, type, payload, and
optional component/correlation metadata. Ordering is `(time, sequence)`;
handlers resolve separately through a sealed registry. Drafts omit allocator
fields. Pending summaries omit payload but retain event identity and metadata.

**Dependency direction:** Kernel canonical values, IDs, and simulation time.
Clock, scheduler, and simulation contracts consume these shapes.

## Source module: `kernel/identities.ts`

[Source](../../packages/contracts/src/kernel/identities.ts) ·
[Specification](../spec/contracts.md).

**Exported API:** `RunId`, `EventId`, `TaskId`, `OperationId`, `ComponentId`,
`TraceId`, `SpanId`, `ObservationId`, `ObservationType`, `Unsubscribe`, `EntityRef`,
`CONTRACT_VERSION` (1), `ComponentCategory`, and `InfrastructurePrimitiveName`.

**Invariants:** IDs are opaque nonempty strings; their aliases do not provide
runtime validation or nominal type separation. Run IDs derive from normalized
inputs; allocators are deterministic and independent of host time/randomness.
Categories are `client`, `internal-service`, `external-service`, and
`infrastructure-primitive`. Infrastructure names are `VirtualNetwork`,
`MessageBus`, `Database`, `KeyValueStore`, `VirtualClock`, and `Scheduler`.
Scenario and projection kind vocabularies are separate specified shapes.

**Dependency direction:** No imports; shared identity aliases underpin other
contracts. This module supplies no allocator or fingerprint implementation.

## Source module: `kernel/observability.ts`

[Source](../../packages/contracts/src/kernel/observability.ts) ·
[Specification](../spec/observability.md).

**Exported API:** `ObservationInput`, `Observation`, `ObservationSink`,
`ObservationFilter`, `ObservationListener`, `VisibilityMode`, `VisibilityPolicy`,
`TerminalFailure`, `HistoryController`, `ExecutionHistoryExport`, and
`ExecutionHistoryReader` (`all`, `query`, `byId`, `export`, `subscribe`).

**Invariants:** Observation is the unit of immutable, append-only execution
history. Schema version is 1; timestamps come from VirtualClock and sequences
from append order. Validation/visibility precede allocation and append. Visible,
summary, redacted, and omitted modes transform stored data without removing
identity/correlation; readers cannot reconstruct removed payloads. Reader filters
combine with AND, use inclusive time bounds and exact type matching, and preserve
append order. Listeners are host notifications isolated from modeled execution.
The kernel alone seals terminal failure separately from ordinary history
capacity; failed recording does not globally roll back committed business state.

**Dependency direction:** Kernel values, identities, and time only. Implementations
inject sink/read/controller capabilities for their authorized consumers.

```ts
import { NetworkObservationTypes, type ExecutionHistoryReader } from "@distlab/contracts";

function sentRequests(history: ExecutionHistoryReader) {
  return history.query({ type: NetworkObservationTypes.RequestSent });
}
```

## Source module: `kernel/operations.ts`

[Source](../../packages/contracts/src/kernel/operations.ts) ·
[Specification](../spec/contracts.md#controlled-operations).

**Exported API:** `ControlledOperation`, `OperationOutcome`,
`OperationController`, and `ControlledTask`.

**Invariants:** Handles are opaque, kernel-issued, owned by one task/run attempt,
and neither promises nor serializable payloads. Tasks yield one owned operation
at a time and resume with canonical values or modeled errors. Trusted completion
is legal only inside its completion-event dispatch and settles once; repeat
completion is inert. Reset revokes stale handles. The structural interface alone
cannot establish ownership or arrange completion events.

**Dependency direction:** Kernel canonical values, operation IDs, and errors.
Clock/network/bus/storage capabilities return these neutral handles.

## Source module: `kernel/random.ts`

[Source](../../packages/contracts/src/kernel/random.ts) ·
[Specification](../spec/seeded-random.md).

**Exported API:** `SEEDED_RANDOM_ALGORITHM` (`xoshiro128ss-splitmix32-v1`),
`SeededRandomAlgorithm`, `RandomDraw`, and `SeededRandomPort.draw`.

**Invariants:** A synchronous draw consumes one stream value; index starts at
zero and `unit = uint32 / 2 ** 32` lies in `[0, 1)`. Labels are diagnostic,
not stream inputs. Equal normalized inputs/seed reproduce draws; reset rebuilds
the stream and revokes old ports. Only trusted adapters receive the port;
UI, application handlers, and assertions cannot consume it. This module names
the algorithm but implements no PRNG or seed normalization.

**Dependency direction:** No imports; kernel/runtime implementations consume
this algorithm vocabulary and port.

## Source module: `kernel/scheduler.ts`

[Source](../../packages/contracts/src/kernel/scheduler.ts) ·
[Specification](../spec/scheduler.md).

**Exported API:** `SchedulerObservationTypes`, `Scheduler`, `SchedulerState`,
and `SchedulerController`. Scheduler exposes schedule/cancel, peek/takeNext,
pending summaries, and size; its controller exports/restores/resets queue state.

**Invariants:** The queue owns `(time, sequence)` total order with unique,
increasing sequences that cancellation does not reuse. Past events reject before
allocation/mutation. Dequeue/cancel removes pending work; inspection cannot change
order. The scheduler does not advance time or execute handlers. Only the core
receives dequeue/controller capabilities. Queue serialization is not a complete
simulation snapshot because suspended generators are not serialized.

**Dependency direction:** Kernel values, run IDs, clock handles, and event types.
Simulation implementations orchestrate this port separately from the clock.

## Source module: `kernel/simulation.ts`

[Source](../../packages/contracts/src/kernel/simulation.ts) ·
[Specification](../spec/simulation-core.md) ·
[Boundary counters](../spec/adr/003-boundary-counters.md) ·
[Runtime integration](../spec/adr/002-runtime-model-semantics.md).

**Exported API:** `SimulationObservationTypes`, `SimulationStatus`, `RunInputs`,
`HandlerContext`, `EventHandler`, `SimulationSetup`, `SimulationFactory`,
`RunOptions`, `RunResult`, `SimulationStep`, `Simulation`,
`TaskLifecycleController`, and `BoundaryReadHook`.

**Invariants:** Run inputs record contract/model versions, architecture,
scenario, configuration, and seed. Setup registers before scheduling seals the
registry; runtime scheduling is local and owner-bound. Events dispatch in
scheduler order with the clock at their time. Handlers are synchronous or
controlled generators; host promises from `step`, `run`, and `reset` do not
permit native async model execution. Completion requires both queue and task set
empty; suspended tasks with no pending event are a deadlock. Reset reconstructs
equal inputs and revokes old capabilities.

Simulation statuses are `READY`, `RUNNING`, `PAUSED`, `COMPLETED`, and `FAILED`.
Successful `RunResult` statuses are PAUSED/COMPLETED, with reasons
`PAUSE_REQUESTED`, `EVENT_LIMIT`, or `EMPTY`; failures follow the structured-error
path. Read-only pending, processed, and random-draw counters are independent of
history visibility and sampled at boundaries. Processed events include dequeued
work whose handler fails. Trusted task abandonment does not resume generators
or run `finally`; boundary hooks are synchronous readers, not scheduling or
business-mutation capabilities. `afterEvent` precedes the completion decision.

**Dependency direction:** Kernel values, identities, errors, operations, events,
clock, observability ports, and time. A composition root supplies implementations;
this module imports no runtime, catalog, assessment, or scenario package.

## Source module: `kernel/time.ts`

[Source](../../packages/contracts/src/kernel/time.ts) ·
[Specification](../spec/virtual-clock.md).

**Exported API:** Branded numeric types `SimulationTime` and `Duration`, with
runtime constructors `simulationTime` and `duration`.

**Invariants:** Both constructors accept nonnegative safe integers in logical
milliseconds, rejecting negative zero, fractions, negatives, nonfinite numbers,
and unsafe integers. They throw `INVALID_SIMULATION_TIME` or `INVALID_DURATION`
with structured context; nonfinite input is represented as a string in context.
Zero duration is valid here; individual model rules such as positive TTL and
network timeout are stricter. Values are elapsed logical time, not calendar or
Unix timestamps. Constructors do not advance time or check composed arithmetic.

**Dependency direction:** Kernel canonical values and runtime error helpers only.
Time-dependent contracts import these branded types.

```ts
import { duration, simulationTime } from "@distlab/contracts/kernel";

const start = simulationTime(0);
const backoff = duration(100);
// duration(0.5) throws INVALID_DURATION.
```
