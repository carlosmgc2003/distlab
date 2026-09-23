# Virtual Network Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`VirtualNetwork` models request and response transport between clients, internal
services, and external services. It owns delivery and caller deadlines, not
remote business effects or retry decisions. Webhooks use this same transport.

## Architectural alignment and decisions

This refines [architecture §10](../architecture.md#10-virtual-network) and
[vision §11](../vision.md#11-core-learning-goals): a lost response may hide a
successful payment. [ADR-002](adr/002-runtime-model-semantics.md) records the
initial transport policies. Generator operations follow
[ADR-001](adr/001-deterministic-execution.md).

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §10: modeled communication | Public API | NET-AC-1, NET-AC-6 |
| Vision §11: ambiguous timeout | Operation semantics and errors | NET-AC-2 |
| Architecture §38: determinism | Invariants | NET-AC-3, NET-AC-4 |

Deferred: streaming, sockets, bandwidth, transport retransmission, and real HTTP.
There are no unresolved decisions for this baseline.

## Public API

Common identities, canonical values, errors, operations, and correlation are
defined in [contracts](contracts.md); time types in [Virtual Clock](virtual-clock.md).

```ts
interface NetworkPolicy {
  requestLatency: Duration;
  responseLatency: Duration;
  jitter: Duration;
  timeout: Duration;
  failureRate: number;
}
interface NetworkRequest {
  target: ComponentId;
  endpoint: string;
  body: CanonicalValue;
}
interface NetworkReply {
  status: "ok" | "error";
  body: CanonicalValue;
}
interface VirtualNetwork {
  request(request: NetworkRequest): ControlledOperation;
}
interface NetworkReceiver {
  accept(requestId: OperationId, request: Readonly<NetworkRequest>): void;
}
interface NetworkController {
  register(target: ComponentId, receiver: NetworkReceiver): void;
  reply(requestId: OperationId, reply: NetworkReply): void;
}
```

The composition root constructs one network with directed link policies, a
clock, trusted scheduler/operation/correlation ports, observation sink, seeded
random port, and the fault decision port. Missing policy fields normalize to
zero latency/jitter/loss and a 1000 ms timeout. Timeout must be positive;
failure rate is finite in `[0, 1]`. Links and targets must exist at initialization.
Every caller receives an owner-bound `VirtualNetwork`; only trusted runtime
adapters receive `NetworkController`. Registration is initialization-only,
unique per target, and sealed before scheduling. Receivers enqueue controlled
target work through their adapter, never invoke another component inline.

The headless kernel wires this through the optional factory `network` setting
(`targets`, directed `links`, and optional fault-decision port). Its initializer
exposes `networkFor`, `networkController`, `enqueueNetworkWork`, and
`networkInFlight` to trusted adapters. The enqueue method schedules a
target-owned handler at the current virtual time and carries the delivery
correlation. A receiver may provide an `admit` check that returns
`TARGET_UNAVAILABLE` or `ENDPOINT_NOT_FOUND`; the transport sends that code
as an error reply. This adapter hook does not change the public
`NetworkReceiver.accept` contract.

### Operation semantics and errors

`request` is legal only in an active controlled task. Validate endpoint,
canonical body, target, configured directed link, and time arithmetic before
allocation; invalid input is terminal `INVALID_NETWORK_REQUEST`. Allocate an
operation, detach the request, record `network.request.sent`, then schedule
the deadline before transport delivery. The caller must yield the operation.
No caller-selectable source or trace can impersonate another component.

Each request leg and response leg samples delay and loss once at send time.
In that order, draw jitter only when nonzero and loss only when strictly between
zero and one. Jitter is a uniform integer in `[0, jitter]` added to the leg's
base latency; loss occurs when the next uniform `[0, 1)` draw is below the rate.
Draws use the kernel seeded stream in event execution order. Apply fault effects
after these samples, using [Fault Engine](fault-engine.md). There is no reverse
link lookup for a reply: both legs use the original link policy.

At request arrival, check target admission. An unavailable
target or unknown endpoint returns an error reply through the response leg;
request loss or a send-time disconnection decision produces no reply. Runtime
adapters translate these
admission failures to `TARGET_UNAVAILABLE` or `ENDPOINT_NOT_FOUND` error bodies.
The transport returns the canonical `{status, body}` reply as operation success;
only deadline expiry settles the operation as modeled failure `NETWORK_TIMEOUT`.

`reply` is adapter-only, legal during dispatch, and accepts the first reply for
an admitted request. Unknown IDs or malformed replies are terminal
`INVALID_NETWORK_REPLY`; repeated replies are ignored without draws or events.
Response delay/loss is independent of whether the remote effect committed.
At arrival, record receipt and settle once. At deadline, record timeout and
settle failure. Equal-time races use scheduler sequence: the preallocated
deadline wins at its exact time. Successful receipt cancels the pending deadline.

Timeout never cancels target work, rolls back state, or retries. A late reply
is recorded as late and cannot resume the caller again. Caller crash detaches
its wait via the runtime termination policy; already-sent requests still run.
No public request-cancellation operation is provided. Invalid capability use,
scheduler overflow, or observation failure is terminal, not a network timeout.

## Owned state

Immutable link definitions and receiver registrations; pending request records,
sampled leg decisions, reply/deadline handles, settlement flags, and correlation.
The operation ID is the request ID; no separate random identifier is allocated.
Copies follow canonical-value rules. Completed requests retain only metadata
needed to recognize late replies until the run ends. No additional configured
network capacity limit exists in this baseline; kernel limits still apply.

Reset constructs fresh registrations and empty in-flight state with the same
inputs and seed; old ports and callbacks reject `STALE_CAPABILITY`. Exportable
records omit receiver functions and capabilities and are not a complete snapshot.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `network.request.sent` | Accepted send | Request ID, endpoint, body, deadline |
| `network.request.delivered` | Target admission attempted | Request ID, target |
| `network.request.dropped` | Request leg discarded | Request ID, reason |
| `network.response.sent` | First target reply | Request ID, status, body |
| `network.response.dropped` | Response leg discarded | Request ID, reason |
| `network.response.received` | Response arrival | Request ID, status, body, late flag |
| `network.request.timedout` | Live deadline expires | Request ID, deadline |

These are canonical records with network-owned schemas. Source/target and
correlation remain envelope fields. Requests create child spans; responses use
that span and reference the request observation. State transitions precede their
corresponding observations; sent observations precede delivery scheduling.
Payload visibility follows [Observability](observability.md); failures terminate
through its separate terminal export without recursive logging or rollback.
Playback emits no network records.

## Invariants

- **NET-INV-1:** Distributed request handlers run only after modeled delivery.
- **NET-INV-2:** A caller settles once; timeout says nothing about remote commit.
- **NET-INV-3:** Delivery decisions and races depend only on normalized inputs,
  seeded draws, and scheduler order.

## Explicit non-responsibilities

- Business idempotency, authentication, retry, and compensation.
- Message subscription/delivery semantics, owned by `MessageBus`.
- Real network access, wall-clock waits, and global transaction rollback.

## Minimal examples

### Successful request

```ts
function* browse(http: VirtualNetwork): ControlledTask {
  const reply = yield http.request({
    target: "catalog", endpoint: "GET /products", body: null,
  });
  // reply is the canonical { status, body } envelope.
}
```

### Ambiguous timeout

```text
t=0: payment request sent; deadline=100
t=10: processor authorizes payment
t=20: response is dropped
t=100: caller receives NETWORK_TIMEOUT; authorization remains
```

## Acceptance criteria

- **NET-AC-1:** Construct/register two targets and issue a request; request and
  response latency are honored, and the caller receives a detached reply once.
- **NET-AC-2:** Drop a response after commit, then deliver a late reply; timeout
  fires once, commit survives, and late receipt does not resume the task.
- **NET-AC-3:** Test zero latency, exact-deadline arrival, jitter, loss rates 0/1,
  disconnection, unavailable target, and absent endpoint with the stated ordering.
- **NET-AC-4:** Equal inputs across two runs/reset yield equal state/history and
  draws; old capabilities fail without affecting reused IDs.
- **NET-AC-5:** Reject malformed input, duplicate registration, invalid replies,
  and overflow; duplicate replies are no-ops. Sink failure seals the run.
- **NET-AC-6:** Verify client → service → external callback paths, correlation,
  owner restrictions, and absence of native timers, promises, and real networking.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| NET-INV-1 | NET-AC-1, NET-AC-6 |
| NET-INV-2 | NET-AC-2, NET-AC-3 |
| NET-INV-3 | NET-AC-3, NET-AC-4 |
| Construction, register, reset | NET-AC-1, NET-AC-4, NET-AC-5 |
| request | NET-AC-1–6 |
| reply | NET-AC-1, NET-AC-2, NET-AC-5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Service Runtime](service-runtime.md), [External Service Runtime](external-service-runtime.md)
- [Scheduler](scheduler.md), [Simulation Core](simulation-core.md)
