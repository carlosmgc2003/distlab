# Shared Simulation Contracts

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |

These contracts are normative for the component specs in this directory. They
belong to the kernel contract layer; importing them must not import runtime
models, application packages, or UI. Concrete dependencies are injected by an
application composition root. See [ADR-001](adr/001-deterministic-execution.md).

The TypeScript encoding lives in [`packages/contracts`](../../packages/contracts)
(`@distlab/contracts`, with kernel-only entry `@distlab/contracts/kernel`).
That package must not drift from the types in this directory. If they disagree,
treat this document as the prose source and reconcile the package.

## Canonical values and identities

```ts
type CanonicalValue = null | boolean | number | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };
type RunId = string;
type EventId = string;
type TaskId = string;
type OperationId = string;
type ComponentId = string;
type TraceId = string;
type SpanId = string;
type ObservationId = string;
type ObservationType = string;
type Unsubscribe = () => void;

interface EntityRef { kind: string; id: string; }
interface SimulationError {
  code: string;
  context: CanonicalValue;
}
interface ScheduleMetadata {
  source?: ComponentId;
  target?: ComponentId;
  traceId?: TraceId;
  spanId?: SpanId;
  parentSpanId?: SpanId;
  causationId?: ObservationId;
}
interface ScheduledEvent<T extends CanonicalValue = CanonicalValue>
  extends ScheduleMetadata {
  readonly id: EventId;
  readonly time: SimulationTime;
  readonly sequence: number;
  readonly type: string;
  readonly payload: T;
}
type PendingEventSummary = Omit<ScheduledEvent, "payload">;
```

Canonical values are JSON values restricted to finite numbers, dense arrays,
and plain objects with own enumerable string data properties. Reject negative
zero, cycles, undefined values, accessors, symbols, functions, class instances,
and other unsupported values without invoking user getters or `toJSON` methods.
Optional fields are absent, not explicitly `undefined`. Shared object references
are allowed but copied by value. Canonical encoding uses UTF-8 JSON, no
whitespace, object keys sorted by UTF-16 code-unit order, and ECMAScript JSON
string/number encoding. Arrays preserve order. Storage takes a deep detached,
frozen copy; callers' objects are never frozen in place.

IDs are opaque nonempty strings. `runId` is the lowercase SHA-256 hex digest of
the canonical normalized inputs, including contract version and model versions.
Equivalent runs and reset reuse that ID. Distinguishing browser sessions or run
attempts uses host-only identities. Per-run event, task, operation, trace, span,
and observation allocators are independent safe-integer counters starting at
zero; identity prefixes distinguish their namespaces. Allocation overflow fails
before mutation with `IDENTITY_OVERFLOW` (`SEQUENCE_OVERFLOW` for the scheduler).
No identity depends on time of day or randomness.

## Construction and capabilities

```ts
interface RunInputs {
  contractVersion: 1;
  modelVersions: Readonly<Record<string, string>>;
  architecture: CanonicalValue;
  scenario: CanonicalValue;
  configuration: {
    startTime: SimulationTime;
    historyLimit: number;
    visibility: VisibilityPolicy;
    models: CanonicalValue;
  };
  seed: string;
}
interface HandlerContext {
  readonly clock: VirtualClock;
  readonly observations: ObservationSink;
  // Local work only; the context fixes the owning component.
  schedule<T extends CanonicalValue>(
    work: { type: string; payload: T }
  ): ScheduledHandle;
}
type ControlledTask = Generator<ControlledOperation, void, CanonicalValue>;
type EventHandler = (
  event: ScheduledEvent, context: HandlerContext
) => void | ControlledTask;
interface SimulationSetup {
  registerHandler(type: string, owner: ComponentId | "simulation",
    handler: EventHandler): void;
  registerObservationSchema(type: ObservationType,
    validate: (data: CanonicalValue | undefined) => boolean): void;
  schedule<T extends CanonicalValue>(draft: EventDraft<T>): ScheduledHandle;
}
interface SimulationFactory {
  createSimulation(inputs: RunInputs,
    initialize: (setup: SimulationSetup) => void): Simulation;
}
```

`createSimulation` is the method of an application-composed `SimulationFactory`.
The factory injects fresh clock, scheduler, seeded generator, observation store,
and model instances for each construction/reset. The kernel depends on ports,
not concrete Observability or runtime-model packages. The initializer adapts
scenario data outside the kernel; its registered model versions identify the
same deterministic implementation for repeatability comparisons.

The application normalizes omitted start time to `0`, history limit to `100000`,
and visibility to `visible` with no overrides before construction. It validates
model-specific input schemas; the factory independently validates canonical
inputs, nonempty seed/version IDs, time, and a positive safe-integer history
limit. Invalid construction throws `INVALID_RUN_INPUT` and returns no simulation.
The initializer is synchronous, uses only injected capabilities, and creates
fresh model state; it must not capture state from a prior attempt. Duplicate or
reserved handler/schema registrations fail with `INVALID_REGISTRATION`.

Initialization first registers handlers/schemas, then schedules initial events
in declared scenario order. The first schedule seals registration. Returning
from initialization revokes setup capabilities. Any invalid setup aborts
construction. Reset repeats the same initializer; it does not reuse old closures.
Built-in `simulation.*`, `scheduler.*`, and `clock.*` schemas and handlers are
registered by their owners before application initialization.

Runtime adapters bind additional network, storage, and messaging capabilities
to their handlers. `ctx.schedule` is zero-delay local work and cannot address
another owner. `clock.schedule` is similarly owner-bound. Only trusted runtime
adapters receive cross-component scheduling capabilities. Communication still
passes through `VirtualNetwork` or `MessageBus`; public scheduling cannot bypass
those models. Reserved kernel wake/completion event types are inaccessible to
application registration and scheduling.

## Controlled operations

```ts
interface ControlledOperation {
  readonly operationId: OperationId;
}
type OperationOutcome =
  | { kind: "success"; value: CanonicalValue }
  | { kind: "failure"; error: SimulationError };
interface OperationController {
  create(): ControlledOperation;
  complete(operationId: OperationId, outcome: OperationOutcome): void;
}
```

Operation handles are opaque, kernel-issued, and owned by one task and run
attempt. They are not promises or serializable payloads. Only trusted adapters
receive `OperationController`. `create()` allocates and registers a pending
operation synchronously; the adapter must arrange modeled completion through
the scheduler. `complete()` is legal only inside dispatch of that completion
event, settles once, and resumes the waiting task at that event's time. A second
completion is an idempotent no-op (for example, a late response after timeout).
Unknown operations fail with `INVALID_OPERATION`. Handles from an earlier reset
fail with `STALE_CAPABILITY` even though canonical IDs are reused.

Tasks yield one owned operation at a time. The initial contract does not support
native async handlers, raw promises, detached tasks, shared waits, or
`Promise.all`/`race`. Adapters may model concurrent requests as separate scheduled
tasks and aggregate their outcomes deterministically. See the core spec for the
dispatch algorithm. This deliberately narrow protocol makes the supported
execution boundary explicit; it is not an arbitrary JavaScript sandbox.

The accepted runtime extension in
[ADR-002](adr/002-runtime-model-semantics.md#kernel-integration-refinements)
defines trusted task-abandonment and boundary-read ports. Abandoned operations
cannot resume their former task; late completion is inert. These ports are
injected infrastructure capabilities, never application-handler capabilities.

## Seeded randomness

The kernel owns the deterministic random stream described in
[Seeded Random](seeded-random.md):

```ts
const SEEDED_RANDOM_ALGORITHM = "xoshiro128ss-splitmix32-v1";
interface RandomDraw {
  readonly index: number;
  readonly algorithm: typeof SEEDED_RANDOM_ALGORITHM;
  readonly uint32: number;
  readonly unit: number;
}
interface SeededRandomPort {
  draw(label: string): RandomDraw;
}
```

Trusted runtime adapters receive this port only when their model semantics need
probabilistic delay, loss, duplication, or fault selection. Application handlers,
UI code, subscribers, projections, and assertions do not receive it. Reset
recreates the stream from the normalized seed and rejects stale ports.

## Correlation

The kernel owns trace/span allocation, exposed to trusted runtime adapters as:

```ts
interface CorrelationContext {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId?: SpanId;
}
interface CorrelationController {
  root(): CorrelationContext;
  child(parent: CorrelationContext): CorrelationContext;
}
```

`root()` allocates one trace and its root span; `child()` allocates a span in the
same trace and sets the supplied span as parent. Invalid parents allocate
nothing. Returned contexts are immutable. Adapters propagate metadata, while
Observability validates and preserves it without inventing relationships.

| Transition | Trace and span rule | Causation |
| --- | --- | --- |
| Client action begins | Allocate a root trace/span | Absent for an initial action |
| Network request | Child span of caller; response shares request span | Request references initiating observation; response references request observation |
| Message publication | Child span of publisher's active span | Initiating observation |
| Delivery, including redelivery and fan-out | New child span of publication span per attempt/recipient | Publication observation, or retry-trigger observation for redelivery |
| Retry request | New child span of original caller span; same trace | Timeout/failure observation that triggered retry |
| Sleep or local continuation | Preserve active trace/span/parent | Active initiating observation, before queue insertion |

The adapters pass these fields into scheduled drafts and observations. A wake
event restores the task's correlation context before resuming it. A continuation
that starts a new distributed operation applies that operation's row above.
`causationId` always names an earlier observation in this run, never a scheduled
event; `eventId` identifies scheduled work separately. Parent spans require a
span and trace; spans require a trace. Kernel bookkeeping may be untraced.
Payload visibility must not remove IDs or correlation metadata.

The current event's `simulation.event.started` observation supplies the default
initiating observation. Runtime adapters may replace it with an earlier domain
observation for the operation they initiate. This context is task-local, never
a global "last observation", so interleaved tasks cannot steal one another's
causation. An untraced initial event receives this event-start cause for its
subsequent local work without acquiring a trace automatically.

## Application boundary contracts

The public application-facing protocol is versioned in
[Application Boundary](application-boundary.md): `WorkerCommand`, `WorkerEvent`,
`ApplicationError`, `RuntimeProjectionSet`, `ArchitectureProjection`,
`SimulationProjection`, `ExecutionHistoryProjection`, and
`ComponentStateProjection`. These shapes are exported from `@distlab/contracts`
but not from `@distlab/contracts/kernel` because they belong to the host/UI
boundary, not the kernel. They are detached read-only values and commands; they
carry no writable runtime handles.

The MVP catalog names in [MVP Catalog and Checkout Scenario](mvp-catalog-scenario.md)
are also exported from `@distlab/contracts`: `MvpCatalogModels`,
`MvpCatalogVersions`, `OrderCreatedDestination`,
`CheckoutResponseLostScenarioId`, the checkout and message payload interfaces,
and the reference assertion list.

## Validation and acceptance coverage

- **CONTRACT-AC-1:** Canonical encoding ignores object insertion order, preserves
  arrays, rejects unsupported data without getters, and detaches nested aliases.
- **CONTRACT-AC-2:** Equal normalized inputs/models yield equal IDs across fresh
  runs/reset; changed inputs change the fingerprint; allocator overflow is atomic.
- **CONTRACT-AC-3:** Factory normalization/validation, registration sealing,
  duplicate registration, reset initialization, and stale setup capabilities
  obey the construction rules without importing higher-level packages.
- **CONTRACT-AC-4:** Cross-owner/reserved scheduling is rejected; network and bus
  adapters remain the only distributed dispatch paths.
- **CONTRACT-AC-5:** Operation creation/completion enforces task ownership,
  single settlement, dispatch-only completion, and stale-handle rejection.
- **CONTRACT-AC-6:** A client → request → publication → fan-out → timeout/retry
  scenario verifies every correlation-table row, including a delayed continuation;
  invalid parents and references fail without allocation.

| Contract / operation | Acceptance criteria |
| --- | --- |
| Canonical encoding and copying | CONTRACT-AC-1 |
| Identity allocators | CONTRACT-AC-2 |
| createSimulation, registerHandler, registerObservationSchema | CONTRACT-AC-3 |
| Setup schedule, context schedule | CONTRACT-AC-3, CONTRACT-AC-4 |
| OperationController.create / complete | CONTRACT-AC-5 |
| SeededRandomPort.draw | RAND-AC-1–4 |
| CorrelationController.root / child and propagation | CONTRACT-AC-6 |
| WorkerCommand / WorkerEvent and projections | APP-AC-1–4 |
| MVP catalog constants and payloads | MVP-CAT-AC-1–3 |

## References

- [Architecture: dependency direction](../architecture.md#37-dependency-direction)
- [Architecture: trace model](../architecture.md#27-trace-model)
- [Seeded Random](seeded-random.md)
- [Application Boundary](application-boundary.md)
- [MVP Catalog and Checkout Scenario](mvp-catalog-scenario.md)
- [Vision: deterministic simulation](../vision.md#15-deterministic-simulation)
- [Vision: definition of success](../vision.md#27-definition-of-success)
