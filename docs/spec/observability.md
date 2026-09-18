# Observability Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-17 |
| Related issues | None |

## Responsibility

`Observability` validates and stores meaningful simulation operations as one
immutable, ordered execution history. It provides deterministic identities,
correlation, filtered reads, canonical export, and payload visibility rules for
timelines, traces, debugging, assessment, and future replay tooling.

Observability records what happened. It cannot decide what the simulation does
next or mutate any simulation state outside its own history and indexes.

## Public API

Identity, canonical data, and correlation rules are defined in
[Shared Simulation Contracts](contracts.md). Storage detaches and deeply freezes
inputs before exposing them to readers.

```ts
interface ObservationInput<T extends CanonicalValue = CanonicalValue> {
  type: ObservationType;
  source: ComponentId | "simulation";
  target?: ComponentId;
  traceId?: TraceId;
  spanId?: SpanId;
  parentSpanId?: SpanId;
  causationId?: ObservationId;
  eventId?: EventId;
  entityRefs?: readonly EntityRef[];
  data?: T;
}

interface Observation<T extends CanonicalValue = CanonicalValue> extends ObservationInput<T> {
  schemaVersion: 1;
  id: ObservationId;
  time: SimulationTime;
  sequence: number;
}

interface ObservationSink {
  // Visibility transformation may change the payload shape.
  record<T extends CanonicalValue>(input: ObservationInput<T>): Readonly<Observation>;
}

interface ObservationFilter {
  fromTime?: SimulationTime;
  toTime?: SimulationTime;
  type?: ObservationType;
  component?: ComponentId;
  traceId?: TraceId;
  eventId?: EventId;
  entity?: EntityRef;
}
type ObservationListener = (observation: Readonly<Observation>) => void;
type VisibilityMode = "visible" | "summary" | "redacted" | "omitted";
interface VisibilityPolicy {
  defaultMode: VisibilityMode;
  byType: Readonly<Record<ObservationType, VisibilityMode>>;
  summaryFields: Readonly<Record<ObservationType, readonly string[]>>;
}
interface TerminalFailure {
  time: SimulationTime;
  code: string;
  context: CanonicalValue;
  historyComplete: boolean;
  lastObservationId?: ObservationId;
}
interface HistoryController {
  sealFailure(failure: TerminalFailure): void;
}

interface ExecutionHistoryReader {
  all(): readonly Readonly<Observation>[];
  query(filter: ObservationFilter): readonly Readonly<Observation>[];
  byId(id: ObservationId): Readonly<Observation> | undefined;
  export(): ExecutionHistoryExport;
  subscribe(listener: ObservationListener): Unsubscribe;
}
```

Runtime models receive only `ObservationSink`. UI and assessment consumers
receive only `ExecutionHistoryReader`. `record()` reads time from
`VirtualClock`, validates the registered event schema, applies the immutable
visibility policy, allocates identity and sequence, freezes the record, and
appends it synchronously.

Types use lowercase dot-separated namespaces such as
`network.request.sent`. Observation schemas are registered before the run;
unknown types and noncanonical values fail before append or identity allocation.
Queries filter by time, type, component, trace, event, and entity.

Filters combine with AND; time bounds are inclusive, `type` is an exact match,
`component` matches source or target, and `entity` matches both kind and ID in
`entityRefs`. Results preserve append order; no filter means all records.
Invalid bounds/identifiers reject `INVALID_OBSERVATION_FILTER`; `byId` returns
undefined for an unknown valid ID. `all`, `query`, and `export` return detached
immutable snapshots; `byId` may return the stored immutable record.

Schema validators are synchronous, deterministic, pure predicates; throwing or
returning a non-boolean is `INVALID_OBSERVATION_SCHEMA`. Input is validated
before visibility transformation, including correlation references and canonical
data. Unknown type is `UNKNOWN_OBSERVATION_TYPE`; other invalid input is
`INVALID_OBSERVATION`. Neither allocates identity. History/observation IDs use
the shared run and observation-sequence allocator rules.

### Visibility and inspection

Policy is fixed in normalized configuration. An exact `byType` entry overrides
`defaultMode`. `visible` stores data unchanged; `summary` stores only the listed
top-level fields of object data (missing fields are omitted); `redacted` stores
`{ "redacted": true }`; `omitted` stores no data field. Summary requires an
object payload and an explicit field list for that type; invalid policy/data
combinations fail before append. Identity, time, type, component, entity, and
correlation fields are never transformed. Readers cannot recover removed data.

Runtime-owned schemas for state transitions must identify the affected entity
and include `before`/`after` values or an explicit change description sufficient
for the intended inspection. A scenario needing before/after inspection must
use visible data or summary fields retaining that evidence. External-service
schemas expose only their scenario-visible boundary state. Visibility does not
change business state; assessment needing hidden business state obtains an
appropriate read capability from its runtime, not from a UI projection.

### Terminal failure and capacity

`historyLimit` bounds ordinary observations, not the single terminal failure
field. The first append beyond it throws `HISTORY_LIMIT_EXCEEDED` before
allocation or append. The kernel immediately stops dispatch, revokes active
tasks, and invokes its exclusive `HistoryController.sealFailure` capability.
The export retains all committed observations plus the canonical failure,
`historyComplete: false`, last observation ID (if any), and context naming the
rejected observation type and active event/task when present. No further append
is attempted to report an observation failure.

For an unexpected handler error while the sink is healthy, the kernel first
attempts `simulation.event.failed` and `simulation.failed`, then seals the
export with the original error and `historyComplete: true`. If either append
fails, seal with that observation error, `historyComplete: false`, and the
original error code in context. The first observation failure takes precedence;
no recursive reporting occurs. Failures outside a handler emit only
`simulation.failed` if the sink is healthy.

`sealFailure` stores one fixed-shape, detached terminal record without schema
callbacks, visibility transforms, ordinary capacity accounting, ID allocation,
or subscriber notification. Repeating the same value is a no-op; a conflicting
second value rejects `HISTORY_SEALED`. Further `record` calls also reject
`HISTORY_SEALED`. Read/export remain available. The kernel is responsible for
supplying canonical error context; host diagnostics never enter this record.

An observation error may happen after a model transition has already committed.
There is no global rollback. Such an export explicitly describes an incomplete
history and must not be treated as a successful assessment or complete replay.
`sealFailure` addresses configured limits and validation errors, not recovery
from browser process termination or physical memory exhaustion.

### Subscriber isolation

Append queues notifications for the host adapter to deliver after the current
control operation releases execution, or at a host yield with the simulation
control lock still held. Notifications never execute inline within `record`.
Registration order determines delivery order for each committed record. No
simulation sink or control capability is passed to listeners; notification
delivery rejects reentrant simulation mutations with `OBSERVER_REENTRANCY` even
if a caller retained such a capability. Queries remain allowed.

Unsubscribe is idempotent and suppresses any undelivered notifications for that
registration. A throwing listener is disabled immediately, emits a host-only
diagnostic, and does not prevent other listeners from receiving notifications.
Reset invalidates pending notifications and registrations from the old attempt.

## Owned state

```ts
interface ExecutionHistoryExport {
  schemaVersion: 1;
  runId: RunId;
  observations: readonly Observation[];
  terminalFailure?: TerminalFailure;
}
```

Observability owns:

- the monotonic observation-sequence and identity allocator;
- immutable canonical observations in append order;
- registered observation schemas;
- the run's immutable payload visibility policy;
- the optional sealed terminal failure;
- rebuildable indexes by ID, type, component, trace, event, and entity;
- read-only subscriber registrations.

Canonical observations are the source of truth. Indexes and UI projections are
derived state. Reset clears history, terminal failure, indexes, allocators, and subscribers, then
the new run records its own initial events.

The configured history limit is part of normalized run configuration. The
default must support at least 100,000 observations in a modern browser.

## Emitted events

Observability does not append an observation about appending an observation;
that would recurse indefinitely. Instead, after a successful canonical append,
it publishes one noncanonical, read-only notification to subscribers:

| Event | When | Required data |
| --- | --- | --- |
| `observation.appended` | A canonical record has committed | The immutable observation |
| `observation.subscriber_failed` | A subscriber throws | Host-only subscriber identity and error |

`observation.appended` drives projections and UI refresh but is not stored in
execution history. `observation.subscriber_failed` belongs only to host
diagnostics. Neither may schedule work or affect simulation state.

Registered canonical schemas use these namespaces (a namespace alone does not
authorize an unregistered type or the host-only lifecycle names):

```text
simulation.*  clock.*      scheduler.*  client.*
service.*     external.*   network.*    message.*
db.*          kv.*         fault.*      assessment.*
```

## Invariants

- **OBS-INV-1:** Canonical history is append-only and ordered by monotonic
  observation sequence.
- **OBS-INV-2:** Observation time comes only from `VirtualClock` and never
  regresses.
- **OBS-INV-3:** Same-time observations retain append order through distinct
  increasing sequences.
- **OBS-INV-4:** Stored records and nested data cannot change after append.
- **OBS-INV-5:** IDs, sequences, correlation fields, and canonical data are
  deterministic for equal run inputs.
- **OBS-INV-6:** Validation and visibility transformation finish before
  identity allocation and canonical append.
- **OBS-INV-7:** Subscriber, index, query, export, or projection behavior cannot
  change simulation scheduling, time, random state, business state, or history.
- **OBS-INV-8:** Canonical history excludes wall-clock timestamps, host
  duration, browser timing, and host stack traces.
- **OBS-INV-9:** No record is silently sampled, truncated, or dropped.
- **OBS-INV-10:** Rebuilding indexes from canonical observations produces the
  same query results.

## Explicit non-responsibilities

- It does not schedule events, advance time, inject faults, or control run
  lifecycle.
- It does not define the semantics of network, message, database, key-value, or
  business operations; their owners define and emit those transitions.
- It does not prescribe UI layout, labels, localization, or animation.
- It does not replace production telemetry or initially export OpenTelemetry.
- It does not include host performance metrics in canonical history.
- It does not initially guarantee long-term storage or replay across schema
  versions.
- It does not guarantee secrecy from a user who can inspect all local browser
  state; the visibility policy controls product views and exports.

## Minimal examples

Fixtures pre-register the illustrated schemas and use a visible payload policy.
The examples demonstrate preservation of supplied trace metadata; full span
allocation and propagation are covered by CONTRACT-AC-6.

### Record and query a network event

```ts
sink.record({
  type: "network.request.sent",
  source: "payments",
  target: "payment-processor",
  traceId: "trace-91",
  eventId: "event:run-1:17",
  data: { requestId: "request-7", operation: "authorize" },
});

const trace = history.query({ traceId: "trace-91" });
assert.equal(trace.length, 1);
```

### Correlate a message delivery

```ts
const published = sink.record({
  type: "message.published",
  source: "orders",
  traceId: "trace-91",
  data: { messageId: "message-4" },
});

sink.record({
  type: "message.delivered",
  source: "message-bus",
  target: "inventory",
  traceId: "trace-91",
  causationId: published.id,
  data: { messageId: "message-4" },
});
```

### Isolate subscriber failure

```ts
history.subscribe(() => {
  throw new Error("projection failed");
});

const record = sink.record(validInput);
assert.equal(history.byId(record.id), record);
```

## Acceptance criteria

- **OBS-AC-1:** A valid input appends exactly one immutable record with current
  virtual time, next sequence, deterministic ID, schema version, and data.
- **OBS-AC-2:** Invalid type, time, identifier, cyclic data, function, symbol,
  or noncanonical number fails before history or allocator mutation.
- **OBS-AC-3:** Many observations at one simulation time preserve exact append
  order through unique increasing sequences.
- **OBS-AC-4:** Mutating input objects, returned records, nested data, query
  results, or exports cannot change canonical history.
- **OBS-AC-5:** Queries correctly combine time, type, component, trace, event,
  and entity filters without emitting observations.
- **OBS-AC-6:** Client actions, synchronous requests, published messages,
  deliveries, retries, and scheduled continuations retain the defined trace,
  span, parent, and causation relationships.
- **OBS-AC-7:** Visibility modes `visible`, `summary`, `redacted`, and `omitted`
  produce deterministic canonical data before storage.
- **OBS-AC-8:** Reaching the configured limit fails explicitly with
  `HISTORY_LIMIT_EXCEEDED`; the export preserves all committed records and one
  terminal failure explicitly identifying the rejected append.
- **OBS-AC-9:** A throwing subscriber preserves the committed record and all
  simulation state, emits only a host diagnostic, and does not notify that
  failed subscriber again when disabled.
- **OBS-AC-10:** Canonical export round-trips with schema version and exact
  order, and excludes every host-only diagnostic field.
- **OBS-AC-11:** Reset followed by the same inputs produces history equal to a
  fresh run.
- **OBS-AC-12:** Equal architecture, scenario, configuration, and seed produce
  equal canonical exports.
- **OBS-AC-13:** Appending/index insertion is amortized `O(1)` in history length,
  excluding validation/copying costs proportional to input size and number of
  entity references. The default configuration retains 100,000 observations in
  the supported browser baseline.
- **OBS-AC-14:** Rebuilt indexes return results equal to linear reference
  queries over canonical history.
- **OBS-AC-15:** Package and capability tests prove that the component has no
  UI, scenario, catalog, or assessment dependency and subscribers receive no
  simulation-control capability.
- **OBS-AC-16:** Successful append emits one `observation.appended` notification;
  subscriber failure emits only `observation.subscriber_failed`; neither enters
  canonical history.
- **OBS-AC-17:** Overflow during a normal transition and during failure reporting
  seals exactly one incomplete terminal export without another append attempt.
  Repeated identical sealing succeeds; conflicting sealing and later append fail.
- **OBS-AC-18:** Nested trace/span relationships and causation references survive
  each visibility mode; invalid references allocate nothing. A state-change
  schema preserves before/after evidence when configured for inspection.
- **OBS-AC-19:** Subscriber delivery occurs outside dispatch, suppresses
  unsubscribed/stale registrations, isolates throwing listeners, and rejects
  reentrant record/control/scheduling calls without changing canonical state.
- **OBS-AC-20:** Inclusive bounds, combined filters, empty results, unknown IDs,
  invalid filters, schema failures, and every visibility-policy branch have
  deterministic results without query-side mutations.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| OBS-INV-1, OBS-INV-3 | OBS-AC-1, OBS-AC-3 |
| OBS-INV-2 | OBS-AC-1, OBS-AC-2 |
| OBS-INV-4 | OBS-AC-4 |
| OBS-INV-5 | OBS-AC-6, OBS-AC-11, OBS-AC-12, OBS-AC-18 |
| OBS-INV-6 | OBS-AC-2, OBS-AC-7, OBS-AC-20 |
| OBS-INV-7 | OBS-AC-5, OBS-AC-9, OBS-AC-15, OBS-AC-19 |
| OBS-INV-8 | OBS-AC-10, OBS-AC-12 |
| OBS-INV-9 | OBS-AC-8, OBS-AC-17 |
| OBS-INV-10 | OBS-AC-14 |
| record | OBS-AC-1–4, OBS-AC-7, OBS-AC-8, OBS-AC-13, OBS-AC-16, OBS-AC-20 |
| all, query, byId | OBS-AC-4, OBS-AC-5, OBS-AC-14, OBS-AC-20 |
| export | OBS-AC-10–12, OBS-AC-17 |
| subscribe, Unsubscribe | OBS-AC-9, OBS-AC-16, OBS-AC-19 |
| sealFailure | OBS-AC-17 |

## Architectural alignment and decisions

Architecture §§25–27 define structured observations, immutable history, and
end-to-end traces. Vision §17 requires state inspection, and §27 asks students
to identify what happened and why. Correlation follows the shared contract;
runtime schemas supply the business meaning. [ADR-001](adr/001-deterministic-execution.md)
records the injected history ownership and terminal export decisions. There are
no unresolved contract decisions in this scope; cross-version replay is deferred.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| [Immutable execution history](../architecture.md#26-execution-history) | Canonical storage; terminal failure | OBS-AC-1–4, OBS-AC-8, OBS-AC-17 |
| [End-to-end traces](../architecture.md#27-trace-model) | Shared correlation contract | OBS-AC-6, OBS-AC-18 |
| [State inspection](../vision.md#17-timeline-and-debugging) | Visibility and inspection | OBS-AC-7, OBS-AC-18, OBS-AC-20 |
| [Independent UI state](../architecture.md#34-ui-state) | Subscriber isolation | OBS-AC-9, OBS-AC-15, OBS-AC-19 |

## References

- [Simulation Core specification](simulation-core.md)
- [Virtual Clock specification](virtual-clock.md)
- [Scheduler specification](scheduler.md)
- [DistLab vision](../vision.md)
- [DistLab architecture](../architecture.md)
- [DistLab glossary](../glossary.md)
