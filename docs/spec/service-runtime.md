# Service Runtime Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`ServiceRuntime` binds an internal service's handlers to owned resources and
controlled execution. It manages admission, lifecycle, and task cleanup while
preserving isolation and already-committed effects.

## Architectural alignment and decisions

This refines [architecture §§12–14](../architecture.md#12-internal-service-runtime)
and [vision §11](../vision.md#11-core-learning-goals). Lifecycle and trusted task
termination are specified in [ADR-002](adr/002-runtime-model-semantics.md).
Native async handlers remain excluded by [ADR-001](adr/001-deterministic-execution.md).
Hot reload, autoscaling, and arbitrary JavaScript sandboxing are deferred.
There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §12: controlled context | Public API | SVC-AC-1, SVC-AC-4 |
| Architecture §14: lifecycle/crash durability | Operation semantics and errors | SVC-AC-2, SVC-AC-3 |
| Vision §11: independent state | Invariants | SVC-AC-4, SVC-AC-5 |

## Public API

Common types follow [contracts](contracts.md). Resource interfaces are defined
in [Database](database.md), [KeyValueStore](kv-store.md),
[Message Bus](message-bus.md), [Virtual Network](virtual-network.md), and
[Virtual Clock](virtual-clock.md).

```ts
interface RuntimeLogger {
  write(level: "debug" | "info" | "warn" | "error",
    message: string, data?: CanonicalValue): void;
}
interface ServiceContext {
  db?: Database;
  kv?: KeyValueStore;
  events: MessageBus;
  http: VirtualNetwork;
  clock: VirtualClock;
  log: RuntimeLogger;
}
type ServiceTask<R> = Generator<ControlledOperation, R, CanonicalValue>;
type EndpointHandler = (body: CanonicalValue, ctx: ServiceContext)
  => NetworkReply | ServiceTask<NetworkReply>;
type ConsumerHandler = (delivery: Readonly<Delivery>, ctx: ServiceContext)
  => void | ControlledTask;
type BackgroundHandler = (data: CanonicalValue, ctx: ServiceContext)
  => void | ControlledTask;
interface ServiceDefinition {
  id: ComponentId;
  version: string;
  endpoints: Readonly<Record<string, EndpointHandler>>;
  consumers: Readonly<Record<string, ConsumerHandler>>;
  background: Readonly<Record<string, BackgroundHandler>>;
}
type ServiceState = "STARTING" | "RUNNING" | "PAUSED" | "CRASHED" | "STOPPED";
interface ServiceRuntime {
  readonly state: ServiceState;
}
interface ServiceController {
  transition(next: ServiceState): void;
}
```

Construction resolves versioned definitions from a catalog and injects only
assigned resources plus trusted receiver, scheduler, and task-lifecycle ports.
Definitions contain code, not scenario data; version IDs enter normalized inputs.
Validate names, resource ownership, endpoint uniqueness, subscription bindings,
and background event types before registering handlers/schemas. Catalog handlers
never receive `ServiceController`, writable peer state, or the simulation object.
Consumer keys name configured bus destinations. Background handlers are
owner-bound local work scheduled explicitly by scenario setup or service code.

### Operation semantics and errors

The initial state is STARTING. A scenario lifecycle action moves it to RUNNING
before admitting work. There are no implicit startup delays or automatic restarts.

| From | Allowed next states |
| --- | --- |
| STARTING | RUNNING, CRASHED, STOPPED |
| RUNNING | PAUSED, CRASHED, STOPPED |
| PAUSED | RUNNING, CRASHED, STOPPED |
| CRASHED | STARTING, STOPPED |
| STOPPED | STARTING |

Transition to the current state is an idempotent no-op. Other transitions are
terminal `INVALID_SERVICE_TRANSITION`. The controller is callable only by trusted
scheduled lifecycle/fault dispatch, never a host UI mutation. A transition takes
effect atomically at that event boundary and notifies bus readiness.

Only RUNNING admits new endpoints, consumers, or background work. Requests to
other states receive a modeled `TARGET_UNAVAILABLE` reply. Bus deliveries follow
bus NACK/admission rules; local background triggers are skipped with a record.
PAUSED prevents new work but permits already-admitted tasks and their wakes to
finish. It is distinct from pausing the entire simulation, which dispatches
nothing. There is no additional runtime queue or concurrency limit: separate
tasks may interleave at yields, never within a synchronous continuation.

Endpoint adapters validate the returned `NetworkReply` and send it through the
network. Consumer return ACKs its delivery. A task's uncaught modeled operation
failure becomes an error reply, NACK, or a failed background-task observation.
Unexpected exceptions, native promises, invalid yields, invalid replies, and
capability violations remain terminal simulator errors; they do not masquerade
as a modeled crash. Runtime code may catch modeled failures explicitly.

On CRASHED or STOPPED, trusted cleanup runs in task-ID allocation order:
invalidate affected waits/wakes, revoke task resource capabilities, discard
uncommitted transactions, abandon generators without `finally`, and remove tasks
from the kernel tracker. Local pending background work is cancelled. In-flight
network requests from or to those tasks are not unsent; abandoned inbound
requests time out and outbound target work may continue. Bus deliveries await
their ACK deadline. This is kernel lifecycle bookkeeping, not an operation
completion calling user code during crash. No old task resumes after restart.

Committed Database and unexpired KeyValueStore state survive. STARTING after a
crash creates fresh handler instances from the catalog and clears volatile
per-process state, retaining transport/resource state. Catalog constructors must
not retain attempt/process state in global closures. Log writes validate/detach
data and record synchronously; they never perform host I/O.

## Owned state

Lifecycle, process generation, registered handler instances, task membership,
and owned local trigger handles. Database/KV/network/bus remain their own sources
of truth. Process generation fences stale capabilities and is deterministic;
run-attempt revocation additionally prevents reuse after reset.

Reset rebuilds STARTING state, empty tasks, and fresh resources from initial
inputs, unlike restart. Inspection exposes detached lifecycle/task summaries.
Live generators and definitions are not serializable snapshots. Runtime handler
work must be bounded; no resource preemption of infinite user loops is promised.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `service.lifecycle.changed` | Valid nontrivial transition | Before/after state, process generation, reason |
| `service.handler.started` | Work admitted | Kind, handler name, task/request/delivery reference |
| `service.handler.completed` | Normal return | Handler reference, outcome |
| `service.handler.failed` | Uncaught modeled failure | Handler reference, stable code |
| `service.handler.abandoned` | Crash/stop cleanup | Handler reference, reason |
| `service.work.skipped` | Inactive local trigger | Handler name, lifecycle |
| `runtime.log` | Controlled log write | Level, message, optional data |

Runtime-owned schemas use service entity references and active correlation;
network/bus adapters propagate incoming spans. Lifecycle actions retain their
scenario/fault cause. Records follow state transitions, with no business payload
invented by the runtime. Visibility and nonrecursive terminal observation failure
follow [Observability](observability.md); playback controls add no such events.

## Invariants

- **SVC-INV-1:** A service receives only its assigned resources and local scheduling.
- **SVC-INV-2:** Crash cannot erase committed effects or resume a dead process task.
- **SVC-INV-3:** Lifecycle admission and continuation order are deterministic.

## Explicit non-responsibilities

- Implementing domain invariants, recovery strategies, or transactions across services.
- Emulating containers, threads, processes, or an operating system.
- Defining catalog business handlers or exposing global simulation mutation.

## Minimal examples

### Endpoint with a local transaction

```ts
function* create(body: CanonicalValue, ctx: ServiceContext): ServiceTask<NetworkReply> {
  const tx = ctx.db!.begin();
  tx.insert("orders", "o1", { input: body });
  yield tx.commit();
  return { status: "ok", body: { orderId: "o1" } };
}
```

### Crash between effects

```text
commit event → durable order
crash event → endpoint task abandoned, response absent
restart events → STARTING → RUNNING; durable order remains
```

## Acceptance criteria

- **SVC-AC-1:** Construct/register handlers and run endpoint, consumer, background,
  and logging paths with controlled suspension, replies, ACKs, and correlation.
- **SVC-AC-2:** Exercise every lifecycle-table edge, duplicate transition, invalid
  edge, paused admission, and completion of work admitted before PAUSED.
- **SVC-AC-3:** Crash/stop before and after commit cancel local wakes, discard open
  transactions, leave remote effects and ACK deadlines alive, and prevent old
  generators/finally blocks from running after restart.
- **SVC-AC-4:** Cross-owner access, stale handles, promises, bad yields, and
  unexpected errors terminate; modeled failures become reply/NACK/task failure.
- **SVC-AC-5:** Fresh/reset execution matches; restart retains DB/KV while reset
  restores initial values. Sink failure preserves commits and seals the run.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| SVC-INV-1 | SVC-AC-1, SVC-AC-4 |
| SVC-INV-2 | SVC-AC-3, SVC-AC-5 |
| SVC-INV-3 | SVC-AC-1, SVC-AC-2, SVC-AC-5 |
| Construction, handler registration/dispatch, reset | SVC-AC-1, SVC-AC-4, SVC-AC-5 |
| state, transition | SVC-AC-2, SVC-AC-3 |
| RuntimeLogger.write | SVC-AC-1, SVC-AC-4, SVC-AC-5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Simulation Core](simulation-core.md), [Scenario Engine](scenario-engine.md)
