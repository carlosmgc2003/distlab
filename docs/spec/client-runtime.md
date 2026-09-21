# Client Runtime Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`ClientRuntime` executes external actors' actions and callback endpoints. It
models caller knowledge, retries, and stable client identifiers without exposing
internal service state or bypassing the network.

## Architectural alignment and decisions

This refines [architecture §11](../architecture.md#11-client-runtime) and
[vision §9](../vision.md#9-external-actors-and-clients). The controlled execution
boundary follows [ADR-001](adr/001-deterministic-execution.md); action isolation
and retry policy follow [ADR-002](adr/002-runtime-model-semantics.md).
Browser sessions, real authentication, and client crash simulation are deferred.
There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §11: actions and retries | Public API | CLIENT-AC-1, CLIENT-AC-2 |
| Architecture §4.1: no internal state ownership | Invariants | CLIENT-AC-4 |
| Vision §11: ambiguous outcomes | Minimal examples | CLIENT-AC-2 |

## Public API

Common types follow [contracts](contracts.md); networking and time follow their
component specs. `ServiceTask`, `EndpointHandler`, and `RuntimeLogger` shapes
are defined in [Service Runtime](service-runtime.md); client handlers use the
client context below rather than the service context.

```ts
interface ClientState {
  get(key: string): CanonicalValue | undefined;
  set(key: string, value: CanonicalValue): void;
}
interface ClientContext {
  http: VirtualNetwork;
  clock: VirtualClock;
  log: RuntimeLogger;
  state: ClientState;
}
type ClientAction = (data: CanonicalValue, ctx: ClientContext)
  => CanonicalValue | ServiceTask<CanonicalValue>;
type ClientCallback = (body: CanonicalValue, ctx: ClientContext)
  => NetworkReply | ServiceTask<NetworkReply>;
interface ClientDefinition {
  id: ComponentId;
  version: string;
  actions: Readonly<Record<string, ClientAction>>;
  callbacks: Readonly<Record<string, ClientCallback>>;
  initialState: Readonly<Record<string, CanonicalValue>>;
}
interface ClientController {
  start(actionId: string, action: string, data: CanonicalValue): void;
}
```

Construction resolves a versioned definition, validates unique nonempty action
and callback names and canonical state, and injects owner-bound network, clock,
correlation, logging, scheduling, and task ports. Callback registration occurs
through `NetworkController` before setup is sealed. Only the scenario adapter
receives `ClientController`; the UI cannot start an unrecorded action mid-run.
Client state stores only client-owned values such as cart IDs, retry counts,
and observed outcomes, never references to server objects.

### Operation semantics and errors

`start` is invoked during the scheduled scenario action dispatch. Action IDs are
unique scenario identities; duplicate IDs, unknown names, malformed data, or
out-of-dispatch invocation fail terminally with `INVALID_CLIENT_ACTION`, without
starting work. Each action detaches its data, allocates a root trace/span,
records start, and runs a separate controlled task through the adapter. Return
records a canonical result; it does not imply all downstream work completed.

Requests yield network operations. Timeouts and other modeled failures may be
caught by the action. An uncaught modeled failure marks only that action failed;
it does not crash a service or terminate unrelated actions. Unexpected exceptions,
native promises, unsupported returns, and capability errors terminate the run.
Callback handlers are admitted only by network delivery and return replies via
that same request. An uncaught modeled callback error produces an error reply.

There are no automatic retries. Catalog behavior declares bounded attempts and
virtual-time backoff, includes those settings in scenario inputs, and preserves
business idempotency keys when desired. Each retry is a new network operation
and child span under the original action trace. A timeout never changes a client
result into proof that the server did nothing. Separate action invocations get
distinct traces even when they carry the same business identifier.

Multiple actions/callbacks may interleave at controlled yields. Synchronous
`state.get/set` is atomic, validates nonempty keys/canonical values, and copies
data; reads return undefined for absence. Writes are last-in-scheduler-order
wins, without hidden transactions. Invalid access is terminal
`INVALID_CLIENT_STATE`. Values are shared among this client's tasks only.
The initial contract has no client-specific queue/capacity or cancel operation.
Reset or terminal simulator failure abandons tasks through the core rules.

## Owned state

Client key/value state, action IDs/status/results, and action/callback task
membership. Statuses are RUNNING, COMPLETED, or FAILED, with stable modeled error
codes for failure. Server truth is owned by services, never inferred into this
state without a response/callback or explicit client computation.

Reset restores initial state, clears outcomes, recreates definitions, and revokes
old capabilities. Canonical projections contain detached state/outcomes but
exclude handlers/generators; they are not executable snapshots. Inspectors may
read projections but cannot use them to mutate or resume a client.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `client.action.started` | Action admitted | Action ID, name, input |
| `client.action.completed` | Normal action return | Action ID, result |
| `client.action.failed` | Uncaught modeled failure | Action ID, stable error |
| `client.state.changed` | Successful set | Key, tagged before/after values |
| `client.callback.started` | Network callback admitted | Request ID, endpoint |
| `client.callback.completed` | Callback returns or modeled failure | Request ID, outcome |
| `runtime.log` | Controlled log write | Level, message, optional data |

Client schemas preserve action roots, network callback spans, and earlier
observation causation. The shared runtime log schema is registered once by the
composition root. State absence uses `{present:false}`; presence uses
`{present:true,value:...}`. Visibility and sink failure follow
[Observability](observability.md); failure never recursively logs or erases
server commits. Playback and inspector reads add no canonical history.

## Invariants

- **CLIENT-INV-1:** Clients interact with other components only through the network.
- **CLIENT-INV-2:** Retry and observed outcome are explicit; timeout is ambiguous.
- **CLIENT-INV-3:** Action ordering, client state, IDs, and traces are reproducible.

## Explicit non-responsibilities

- Service databases, KV resources, bus consumers, or privileged fault injection.
- Real UI events, browser requests, credentials, or wall-clock waits.
- Automatic retry, deduplication, and knowledge of hidden provider state.

## Minimal examples

### Client-owned request identity

```ts
function* place(data: CanonicalValue, ctx: ClientContext): ServiceTask<CanonicalValue> {
  ctx.state.set("pending-order", "o1");
  return yield ctx.http.request({
    target: "orders", endpoint: "POST /orders", body: data,
  });
}
```

### Explicit retry scenario

```text
Action A sends order o1 with idempotency key k1 and times out.
After virtual backoff, A sends o1/k1 again under the same trace.
The server's implementation determines whether one or two effects occur.
```

## Acceptance criteria

- **CLIENT-AC-1:** Construct/start an action and receive a callback through the
  network; detached results, state, logging, and root/child spans are correct.
- **CLIENT-AC-2:** Lost response and bounded virtual backoff retry preserve the
  configured business key; action failure is local and never asserts rollback.
- **CLIENT-AC-3:** Concurrent actions/callbacks update local state in event order;
  fresh/reset runs match and old capabilities cannot mutate the new run.
- **CLIENT-AC-4:** Reject duplicate/unknown actions, invalid state/data/returns,
  cross-owner access, and native async; no DB, KV, bus, or real network is exposed.
- **CLIENT-AC-5:** A sink failure after server commit seals the run without
  recursive client logging or business rollback; no action runs from playback.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| CLIENT-INV-1 | CLIENT-AC-1, CLIENT-AC-4 |
| CLIENT-INV-2 | CLIENT-AC-2 |
| CLIENT-INV-3 | CLIENT-AC-1, CLIENT-AC-3 |
| Construction, start, callback dispatch, reset | CLIENT-AC-1–5 |
| ClientState.get / set | CLIENT-AC-1, CLIENT-AC-3, CLIENT-AC-4 |
| RuntimeLogger.write | CLIENT-AC-1, CLIENT-AC-5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Scenario Engine](scenario-engine.md), [External Service Runtime](external-service-runtime.md)
