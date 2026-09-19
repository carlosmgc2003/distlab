# Message Bus Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`MessageBus` owns asynchronous publication, queue/topic routing, delivery
attempts, acknowledgements, and bounded redelivery. It exposes duplicate effects
and consumer competition without implementing a vendor broker.

## Architectural alignment and decisions

This refines [architecture §19](../architecture.md#19-message-bus) and
[vision §11](../vision.md#11-core-learning-goals). Delivery policies are recorded
in [ADR-002](adr/002-runtime-model-semantics.md). Exactly-once effects require
consumer logic; retention/replay of acknowledged messages and dynamic topology
are deferred. There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §19: queues/topics/ACK | Operation semantics and errors | BUS-AC-1–3 |
| Vision §11: duplicates | Invariants | BUS-AC-4 |
| Architecture §38: deterministic order | Owned state | BUS-AC-5 |

## Public API

Shared values/capabilities follow [contracts](contracts.md), time follows
[Virtual Clock](virtual-clock.md), and outcomes use its `OperationOutcome` type.

```ts
interface DestinationDefinition {
  id: string;
  kind: "queue" | "topic";
  deliveryDelay: Duration;
  ackTimeout: Duration;
  retryDelay: Duration;
  maxAttempts: number;
  capacity: number;
}
interface BusMessage { type: string; body: CanonicalValue; }
interface Delivery {
  messageId: string;
  deliveryId: string;
  destination: string;
  attempt: number;
  message: Readonly<BusMessage>;
}
interface MessageBus {
  publish(destination: string, message: BusMessage): ControlledOperation;
}
interface MessageReceiver {
  ready(): boolean;
  accept(delivery: Readonly<Delivery>): void;
}
interface MessageBusController {
  subscribe(destination: string, consumer: ComponentId,
    receiver: MessageReceiver): void;
  acknowledge(deliveryId: string, outcome: "ack" | "nack"): void;
  consumerChanged(consumer: ComponentId): void;
}
```

The root injects clock, trusted scheduling/operation/correlation ports, seeded
randomness through the fault port, and observations. Destination names are
unique; delays are nonnegative, ACK timeout positive, and maxAttempts/capacity
positive safe integers. Normalized defaults are delay/retryDelay 0, ACK timeout
1000 ms, maxAttempts 3, capacity 10000. Only service tasks receive owner-bound
publish capabilities; runtime adapters receive the controller. Subscriptions
are unique by destination/consumer, initialization-only, and sealed before any
event is scheduled. Receiver readiness is pure adapter state, never user code.

### Operation semantics and errors

`publish` validates destination, nonempty message type, and canonical body
before allocating an operation and scheduling broker admission at current time.
The task yields; admission success resumes with `{messageId}`. This confirms
broker acceptance, not consumption. Invalid inputs/capabilities are terminal
`INVALID_MESSAGE_OPERATION`; full capacity is modeled `BUS_CAPACITY_EXCEEDED`.
No partial fan-out occurs on capacity rejection. Broker admission is atomic and
has no network leg in this baseline.

A queue creates one routing record shared by its competing subscribers. A topic
creates one independent record per subscription in registration order. A topic
without subscribers accepts publication and records zero recipients. Topic
subscriptions are durable for the run, including when their service is crashed.
Capacity counts nonterminal routing records per destination, including in-flight
records; dead letters are separately retained for inspection until reset.

Each routing record enters QUEUED. Dispatch selects the oldest eligible record
by publication order and an available queue consumer using round-robin
registration order, advancing the cursor only on successful reservation. Topic
records target their fixed subscriber. One active reservation per subscription
limits in-flight work; other records wait without busy-poll events. When no
consumer is ready, the record stays queued. `consumerChanged` or settlement
schedules one coalesced dispatch event. A queued message without scheduled work
does not keep the kernel alive; assessment may report incomplete business work.

Reservation increments attempt and enters IN_FLIGHT, schedules arrival after
deliveryDelay and ACK timeout relative to arrival (timeout inserted first).
Fault delay is added before calculating that timeout. A dropped arrival still
expires its ACK timeout. If the consumer is no longer ready at arrival, treat
the attempt as NACK. Runtime handlers run in separate controlled tasks; the
bus never invokes consumer business code inline.

`acknowledge` is adapter-only during dispatch. ACK terminalizes that routing
record; NACK/timeout releases its reservation and schedules retry after
retryDelay. At maxAttempts, move it to DEAD instead. A successful handler return
ACKs, an uncaught modeled handler error NACKs, and a crash abandons delivery to
its ACK timeout. Unknown IDs are terminal `INVALID_DELIVERY`; acknowledgements
for settled/expired attempts are recorded as stale and cannot acknowledge a
newer attempt. Exact-time ACK loses to the previously inserted timeout.

Fault duplication creates additional delivered copies of an attempt with
distinct delivery IDs and spans, the same message ID, and the same ACK deadline.
They bypass the ordinary one-reservation limit only for that faulted attempt.
The first valid copy settlement determines the attempt; other settlements are
stale. Already-running duplicate handlers may still commit effects. Redelivery
always allocates new delivery IDs; business idempotency keys remain unchanged.
Finite fault delays can reorder arrivals without changing scheduler ordering.

No public publication cancellation exists. ACK does not undo another handler's
commit; retries may duplicate effects after an ACK is lost or arrives late.
Capacity, drop, and exhaustion are modeled outcomes. Observation/registration,
identity overflow, or scheduling errors terminate the run.

## Owned state

Destinations/subscriptions, publication counter, delivery counter, routing
records, reservations, round-robin cursors, deadline/retry handles, and dead
letters. Counters start at zero and use distinct namespaced IDs; overflow fails
before mutation. State and payloads are detached canonical values; receivers and
capabilities are outside serialization. Per-record states are PUBLISHED,
QUEUED, IN_FLIGHT, ACKED, NACKED, RETRY, DROPPED, and DEAD. PUBLISHED/NACKED/RETRY
may be recorded transitions within one dispatch; DROPPED describes an individual
copy, whose parent attempt still awaits timeout or another copy's settlement.

Service crashes do not reset the bus. Simulation reset restores empty queues,
dead letters, counters, and cursors with fresh subscriptions; old capabilities
are revoked. Serializable bus state alone cannot restore suspended consumers.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `message.published` | Admission | Message ID, destination, message, recipient count |
| `message.queued` | Routing record created | Message ID, routing ID, subscriber if topic |
| `message.delivered` | Copy reaches consumer | Message/delivery/routing IDs, consumer, attempt |
| `message.dropped` | Copy lost | IDs, reason |
| `message.acknowledged` | ACK accepted | IDs, consumer |
| `message.nacked` | NACK accepted | IDs, reason |
| `message.retry.scheduled` | Timeout/NACK with attempts left | Routing ID, previous attempt, due time |
| `message.dead` | Attempts exhausted | Routing ID, message ID, attempts, reason |
| `message.ack.stale` | Late/duplicate settlement | Delivery ID, requested outcome |
| `message.publish.rejected` | Capacity rejection | Destination, code |

The bus owns these schemas; routing state changes accompany before/after state
fields. Publication creates a child span; every delivery copy/redelivery creates
a child of that publication, with retry-trigger causation where applicable.
Visibility follows [Observability](observability.md), as does terminal sink
failure without recursive appends or global rollback. Playback adds no records.

## Invariants

- **BUS-INV-1:** Queue routing selects one ordinary consumer per attempt; topics
  settle each subscription independently.
- **BUS-INV-2:** Only a live delivery may settle its routing attempt.
- **BUS-INV-3:** Attempts/capacity are bounded; duplicates never imply exactly-once effects.
- **BUS-INV-4:** Equal inputs produce equal routing, IDs, history, and final state.

## Explicit non-responsibilities

- Consumer inboxes, automatic business deduplication, and distributed commits.
- Log offsets, broker clustering, dynamic subscription changes, and real brokers.
- Remote request/response transport, owned by `VirtualNetwork`.

## Minimal examples

### Publish an event

```ts
function* publish(events: MessageBus): ControlledTask {
  yield events.publish("orders", {
    type: "OrderCreated", body: { orderId: "o1" },
  });
}
```

### Commit followed by crash

```text
Consumer commits its business change, then crashes before ACK.
The ACK deadline expires; attempt 2 carries the same message ID.
An inbox row can detect the duplicate; the bus does not remove its effects.
```

## Acceptance criteria

- **BUS-AC-1:** Construct/register queues and topics; publish verifies competing
  round-robin routing, independent fan-out ACKs, no-subscriber topics, and capacity.
- **BUS-AC-2:** Return, modeled exception, NACK, timeout, and exhaustion produce
  ACK/retry/DEAD transitions, bounded attempts, and reservation release.
- **BUS-AC-3:** Crash/unavailable consumers retain backlog; readiness notification
  resumes dispatch without polling; equal-time and stale ACKs obey the contract.
- **BUS-AC-4:** Delay/drop/duplicate faults preserve message identity, use distinct
  delivery spans, and demonstrate duplicate business effects without an inbox.
- **BUS-AC-5:** Fresh/reset runs match; invalid definitions, capability reuse,
  alias mutation, counter overflow, and failed observation cannot corrupt a run.
- **BUS-AC-6:** Outbox commit followed by publish rejection preserves the row;
  retry can publish twice. No direct consumer calls or host timers are used.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| BUS-INV-1 | BUS-AC-1, BUS-AC-3 |
| BUS-INV-2 | BUS-AC-2–4 |
| BUS-INV-3 | BUS-AC-1, BUS-AC-2, BUS-AC-4, BUS-AC-6 |
| BUS-INV-4 | BUS-AC-5 |
| Construction, subscribe, reset | BUS-AC-1, BUS-AC-5 |
| publish | BUS-AC-1, BUS-AC-5, BUS-AC-6 |
| acknowledge, consumerChanged | BUS-AC-2–5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Service Runtime](service-runtime.md), [Fault Engine](fault-engine.md)
