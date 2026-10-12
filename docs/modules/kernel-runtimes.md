# Kernel runtimes

This reference describes the current implementation of seven modules in
`packages/kernel/src/`. It is intended for developers tracing runtime behavior
and composition boundaries. Shared API contracts come from `@distlab/contracts`
and `@distlab/contracts/kernel`; the linked specifications remain the design
source of truth. Scheduling, network transport, broker delivery, and history
storage are supplied dependencies, rather than implemented by these modules.

## Database (`database.ts`)

Source: [database.ts](../../packages/kernel/src/database.ts).
Specs: [Database](../spec/database.md),
[runtime semantics](../spec/adr/002-runtime-model-semantics.md).

### Lifecycle and API

`DeterministicDatabase` implements `Database`. `DatabaseOptions` supplies the
definition, named row-check functions, registration setup, virtual clock,
commit scheduling callback, operation controller, observation sink, current
task/event readers, and optional fault decision port. Construction copies and
validates the definition and initial rows, checks constraints, and registers
`database.<owner>.commit` and database observation schemas.

The handler API is `begin()` and the returned `Transaction`'s `get`, `scan`,
`insert`, `update`, `delete`, `commit`, and `rollback`. `begin()` requires an
active task belonging to the database owner and an active event, and permits
one open transaction per task. A transaction captures the committed snapshot,
base revision, process generation, reset epoch, and originating event.

`commit()` closes access to the open handle, creates a `ControlledOperation`,
and submits a commit event through the injected scheduling callback. It does
not publish changes immediately. `revision` and `inspect()` expose committed
state; inspection returns a detached projection sorted by table and row key.
`reset()` clears open/pending work, restores initial rows, resets revision and
transaction numbering, and advances the epoch to invalidate old handles.
`abandonGeneration(generation)` discards that generation's open and pending
transactions without resetting committed rows.

### Deterministic and fault semantics

Reads see the private snapshot plus staged writes. Scans and committed change
evidence are sorted; rows are canonically copied. Insert rejects existing keys,
update rejects absent keys, and delete returns whether a row existed. Updates
replace the row supplied by the caller. Unique constraints require every named
field and compare canonical tuples; named check functions must return booleans.

At commit dispatch, `database.commit` is probed before revision and constraint
checks. Only a failure effect is accepted here; selected failure completes the
operation with `COMMIT_FAILED`. Any database-wide revision mismatch rejects
with `TRANSACTION_CONFLICT`, including for a read-only transaction. Constraint
failure rejects before publication. Successful publication replaces committed
tables atomically; revision increases when a write was staged, even if later
staging removes its net effect. Success completes the operation with `null`.
Transaction observations carry event identity and the transaction origin's
correlation fields.

### Boundaries

Transaction use is checked against task identity, owner, generation, epoch, and
open status. Rollback is idempotent only for the owning task/generation after
rollback. The class also exposes adapter helpers (`active`, `table`, `key`,
`row`, `read`, `staged`, `submit`, `rollback`, `cleanup`, and `observe`) used by
the module-local transaction implementation; these are not extra `Database`
handler capabilities. Cleanup records rollback for still-open work. Commit
timing and controlled-operation lifetime belong to the injected adapters;
there is no cross-resource transaction in this module.

## Key-value store (`key-value-store.ts`)

Source: [key-value-store.ts](../../packages/kernel/src/key-value-store.ts).
Specs: [KeyValueStore](../spec/kv-store.md),
[runtime semantics](../spec/adr/002-runtime-model-semantics.md).

### Lifecycle and API

`DeterministicKeyValueStore` implements `KeyValueStore`.
`KeyValueStoreOptions` supplies the owned definition, virtual clock, scheduler,
observation/schema port, active-owner/event readers, dispatch-state reader,
and a validity check. Construction validates and canonically copies initial
entries, rejects duplicate keys, assigns generation zero, sorts initialization
by key, and registers KV observation schemas.

Handler methods are synchronous `get`, `set`, `delete`, `increment`, and
`compareAndSet`. Every method requires an active dispatch by the store owner.
Trusted composition uses `expiryEventType` (`kv.expiry.<owner>`), registers
`expire(event)`, then calls the idempotent `scheduleInitialExpiries()` before
scenario actions. `inspect()` returns sorted, detached live entries with their
generation and optional expiry time. This class has no reset method: its
resource lifetime spans service process generations within one attempt.

### Deterministic and fault semantics

Keys are nonempty strings; values must be canonical. TTL is a positive safe
integer measured from virtual `now`. An entry expires at `now >= expiresAt`.
Handler operations lazily remove expired entries and record expiration even
before the scheduled expiry handler executes. Inspection filters expired
entries without removing them or recording expiration.

`set` optionally requires absence. `compareAndSet` uses an explicit presence
tag and canonical value equality. A failed condition returns `false` and emits
condition-failure evidence. Successful set/CAS replaces any prior TTL with the
supplied TTL, or clears it when omitted. Delete returns `false` for absence.
Increment starts absent counters at zero, rejects non-safe-integer values and
overflow, and preserves an existing absolute expiry time.

Writes advance a per-key generation, cancel the previous expiry handle, and
arm any new expiry. Expiry checks the stored generation, so an old event cannot
remove a replacement. Read, change, condition-failure, and expiration evidence
are recorded with service identity and available correlation fields. There is
no fault decision port in this module.

### Boundaries

The scheduler owns event order and cancellation. The supplied `check()` guards
trusted expiry/inspection as well as handler operations. Store methods expose
no transaction or controlled wait; DB and KV changes are independent. Process
restart does not itself restore initial KV values; attempt reconstruction is
the surrounding composition's responsibility.

## Client runtime (`client-runtime.ts`)

Source: [client-runtime.ts](../../packages/kernel/src/client-runtime.ts).
Specs: [Client Runtime](../spec/client-runtime.md),
[Virtual Network](../spec/virtual-network.md).

### Lifecycle and API

`DeterministicClientRuntime` takes `ClientRuntimeOptions`: ID/version resolver,
runtime setup, active-owner/event readers, and the scenario adapter's event
type. Construction validates action/callback handlers and canonical initial
state, rejects overlapping action and callback names, registers action/callback
events and observation schemas, and registers the client as a network target.
A new simulation attempt constructs a new instance; there is no reset method.

`dispatch(event, context, invoke)` temporarily supplies a `ClientController`
with `start(actionId, action, input)`. This is legal only for the exact active
scenario event owned by this client and cannot nest. IDs cannot be reused.
Start schedules `client.<id>.action` at zero virtual delay with sequential
client trace/span IDs and records the action as `RUNNING`.
`actionEventType` exposes that registered type. `inspect()` projects copied
state, action views (`RUNNING`, `COMPLETED`, or `FAILED`, plus result/code), and
currently executing callback request IDs. `ClientActionView` is exported.

### Deterministic and fault semantics

Action handlers return canonical results directly or through generators
yielding `ControlledOperation`s. Callback handlers return a canonical
`NetworkReply` with exactly `status` and `body`. Promises and async iterators
are rejected as `UNCONTROLLED_ASYNC`. Uncaught modeled error codes mark actions
failed or produce callback error replies; other errors propagate. Adapter
violations latch failure through `setup.failTask`, so catching one in user code
does not turn it into successful completion.

Action and callback execution, state changes, and logs emit observations linked
to the handler event. Callback admission rejects unknown endpoints; accepted
callbacks enqueue separate runtime work. Callback replies and timeouts are
handled through the modeled network. The runtime has no fault selector or
automatic retry loop; scenario actions or handler code must request another
attempt explicitly.

### Boundaries

`ClientContext` exposes copied state `get`/`set`, `log.write`, `http.request`,
and virtual clock `now`/`sleep`. Clock `schedule` is rejected. Capabilities
check active owner and setup validity; the controller is usable only inside
scenario dispatch. Clients receive no DB or broker port from this context.
Transport, deadlines, and controlled-task driving belong to setup/network.

## Service runtime (`service-runtime.ts`)

Source: [service-runtime.ts](../../packages/kernel/src/service-runtime.ts).
Specs: [Service Runtime](../spec/service-runtime.md),
[Message Bus](../spec/message-bus.md),
[runtime semantics](../spec/adr/002-runtime-model-semantics.md).

### Lifecycle and API

`DeterministicServiceRuntime` takes `ServiceRuntimeOptions`: ID/version resolver,
runtime setup, task-lifecycle controller reader, owner reader, publishing port,
optional broker controller, DB/KV resources, resource-abandon callback, and
active-event reader for fault crashes. Construction resolves handlers, starts
in `STARTING` at process generation zero, and registers lifecycle, endpoint,
consumer, and background events. Consumers require a broker controller.

Public accessors are `state`, `processGeneration`, `lifecycleEventType`, and
`backgroundEventType`; `inspect()` exposes lifecycle and tracked work.
Lifecycle events carry `{ next, reason? }`, defaulting reason to `scenario`.
Permitted transitions are:

| From | To |
| --- | --- |
| `STARTING` | `RUNNING`, `CRASHED`, `STOPPED` |
| `RUNNING` | `PAUSED`, `CRASHED`, `STOPPED` |
| `PAUSED` | `RUNNING`, `CRASHED`, `STOPPED` |
| `CRASHED` | `STARTING`, `STOPPED` |
| `STOPPED` | `STARTING` |

A lifecycle event requesting the current state is a no-op after reason
validation. Trusted `crash(event)` requires the exact active event and owner,
and rejects an already-crashed service. Returning to `STARTING` resolves fresh
handlers; the resolver is responsible for supplying fresh instances. Attempt
reset constructs a new runtime.

### Deterministic and fault semantics

Network admission and broker readiness require `RUNNING`. Pause does not
abandon admitted work. Endpoint and consumer dispatch ignore payloads from an
old generation; background dispatch outside `RUNNING` records skipped work.
Endpoints reply through the network. Consumers acknowledge successful work
with ACK and uncaught modeled failure with NACK. Background handlers and
consumers must return `undefined`; endpoints return replies. All three support
controlled generators; promises and async iterators are rejected.

On entry to `CRASHED` or `STOPPED` from a state other than `CRASHED`, the runtime
records handler abandonment, cancels locally scheduled background handles,
discards uncommitted DB work, calls trusted resource cleanup and kernel task
abandonment, and increments generation. `CRASHED` to `STOPPED` does not repeat
that cleanup. Committed DB state is not reset by this cleanup. Open transactions
also roll back when their handler finishes. Modeled failures remain catchable;
adapter violations latch task failure. Lifecycle and handler evidence inherit
event correlation fields.

### Boundaries

`ServiceContext` exposes guarded `http.request`, `events.publish`, virtual clock
`now`/`sleep`, logs, and optional DB/KV ports. Scheduling is restricted to this
service's background event type and tracks handles for crash cleanup. DB/KV
proxies enforce owner, generation, and setup validity. The runtime does not
cancel independent remote work or implement broker redelivery; those effects
belong to network, broker, and task-lifecycle owners. No fault-rule selection
occurs here: `crash` is the injected lifecycle effect boundary.

## External service runtime (`external-service-runtime.ts`)

Source: [external-service-runtime.ts](../../packages/kernel/src/external-service-runtime.ts).
Specs: [External Service Runtime](../spec/external-service-runtime.md),
[Virtual Network](../spec/virtual-network.md).

### Lifecycle and API

`DeterministicExternalServiceRuntime` implements `ExternalRuntime`.
`ExternalServiceRuntimeOptions` supplies a definition, setup, owner/event
readers, scenario event type, optional initial availability, and initialization
configuration callback. Construction copies initial private state, sets visible
state to `null`, defaults availability to `AVAILABLE`, and initializes each
operation with zero latency, zero degraded extra latency, no response drop,
and `null` parameters. It registers arrival/completion/callback handlers and
external observation schemas. Reset constructs a new instance.

The initialization callback and guarded `dispatch(event, invoke)` receive an
`ExternalController` with `configure(operation, behavior)` and
`setAvailability(state)`. Dispatch requires the exact active scenario event,
matching owner, and no nested controller dispatch. The registered scenario type
cannot equal an internal provider event type. Accessors expose `availability`
and `scenarioEventType`. `inspect()` returns `ExternalInspection` (availability
and copied visible state). Trusted `boundary()` returns `ExternalBoundary`,
adding admitted, rejected, effect, suppressed-response, scheduled-callback,
and callback-timeout counts.

### Deterministic and fault semantics

`UNAVAILABLE` and `RATE_LIMITED` reject arrivals with modeled error replies;
unknown operation names also receive an error reply. Accepted requests capture
body, behavior, and availability before enqueuing arrival work. Later
configuration changes affect new admissions. Captured `DEGRADED` adds configured
extra latency; completion is scheduled using virtual time.

At completion, the operation's synchronous `apply` receives copies of request
body, current private state, and captured parameters. Its canonical decision
must contain exactly `nextState`, `reply`, `visibleChanges`, and `callbacks`.
Callback plans validate nonnegative delays, request shape, target identifiers,
and declared network links before publication. Completion replaces private
state and the visible projection with the returned values, records the effect,
and schedules callbacks in declared order. Visible changes are assigned as a
new projection, not merged into prior visible state.

`dropResponse` suppresses the reply after committing the effect and scheduling
callbacks. It leaves the caller's deadline to the network. Callback generators
yield network requests; a returned reply records `reply` completion, while
`NETWORK_TIMEOUT` records `timeout` and increments its counter. Other errors
propagate. Availability changes do not cancel already-admitted effects or
callbacks. Changes, admissions, rejection, effects, suppression, and callback
progress emit external observations.

### Boundaries

Service code reaches this provider through `VirtualNetwork`. Private state,
admission records, behavior maps, and scheduled handles are absent from both
inspection projections; boundary counters are intended for trusted assessment.
Configuration is scenario-controlled, with setup validity checks and terminal
failure on controller misuse. This module does not evaluate fault rules;
scheduled availability faults reach its guarded controller via an adapter.

## Fault engine (`fault-engine.ts`)

Source: [fault-engine.ts](../../packages/kernel/src/fault-engine.ts).
Specs: [Fault Engine](../spec/fault-engine.md),
[Seeded Random](../spec/seeded-random.md).

### Lifecycle and API

`DeterministicFaultEngine` implements `FaultDecisionPort` and `FaultController`.
`FaultEngineOptions` supplies immutable rules, component IDs, virtual clock,
seeded random port, observation/schema sink, optional dispatch/event guards,
and trusted crash/availability effect ports. Construction validates component
and rule uniqueness, effect compatibility, and overlapping duplicate rules,
then initializes candidate/application counts and registers fault schemas.

`evaluate(probe)` returns a combined decision; `apply(fault)` invokes a scheduled
lifecycle effect. `decisionPort()` and `controller()` return generation-bound
wrappers. `inspect()` exposes rule counters, evaluated probe identities, and
applied fault IDs. `reset(ports?)` clears counters and identities, advances the
capability generation, and optionally replaces attempt ports and registers
schemas on their observation sink. It does not itself reset the supplied RNG.

### Deterministic and fault semantics

Probes support `network.request`, `network.response`, `message.delivery`, and
`database.commit`. A `(point, subjectId)` identity can be evaluated only once
per attempt. Rules are visited in declaration order, filtering point,
source/target/name, and the half-open virtual interval `[from, until)`.
Matching candidates advance ordinal counts even when occurrence or application
limits prevent selection. Eligible rules use no random draw at probability
zero or one; other probabilities draw from `fault.<ruleId>`.

Selected delays add with overflow checks; drop/disconnect set `drop`; commit
failure sets `fail`. Duplicate delivery sets additional copies and spacing,
but drop zeros both in the returned decision. Duplication is restricted to
message delivery (at most 16 additional copies), disconnect to network
requests, and failure to database commits. Potentially overlapping duplicate
rules are rejected during construction. Match and selection observations
record candidate/application ordinals.

Scheduled crash and external-availability faults validate their target effect
port. Reapplying an already-applied ID is a no-op after validation. The ID is
recorded as applied only after the synchronous target port succeeds, followed
by applied evidence. Optional dispatch/event guards are enforced when supplied;
old wrapper capabilities fail after reset.

### Boundaries

The engine selects transport/commit effects but does not deliver messages,
change committed rows, or schedule lifecycle transitions. Their owners apply
the returned decision; injected ports perform lifecycle effects. Rules remain
fixed across reset. Deterministic replay depends on supplying the same rules,
probe order, virtual clock inputs, and seeded stream.

## Runtime log schema (`runtime-log.ts`)

Source: [runtime-log.ts](../../packages/kernel/src/runtime-log.ts).
Specs: [Observability](../spec/observability.md),
[Service Runtime](../spec/service-runtime.md),
[Client Runtime](../spec/client-runtime.md).

### Lifecycle and API

The sole export, `registerRuntimeLogSchema(setup: SimulationSetup): void`, is
an internal shared helper called by service and client constructors. A
module-level `WeakSet` makes registration idempotent for each setup object.
There is no logger instance, reset method, or package-root re-export here.

### Deterministic and fault semantics

The helper registers `RuntimeObservationTypes.Log`. Its validator accepts a
non-array object with required `level` and `message`, optional `data`, and no
other keys. Level must be `debug`, `info`, `warn`, or `error`; message must be a
string. The validator consumes no time or randomness and selects no faults.

### Boundaries

This module validates log data shape only. Client and service context adapters
validate calls, copy optional data, and record event/correlation-linked log
observations. Canonical observation storage, visibility, capacity, and ordering
belong to the observation sink/history implementation.
