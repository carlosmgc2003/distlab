# DistLab Glossary

This glossary defines the terms used by DistLab's [vision](vision.md) and
[architecture](architecture.md). It describes DistLab's educational models,
not the complete behavior of similarly named production systems or products.

## Core Terms

**Acknowledgement (ACK)** — Confirmation that a consumer successfully
processed a delivered message. The `MessageBus` can use it to mark the message
as complete.

**Ambiguous timeout** — A timeout in which the caller cannot determine whether
the remote operation ran. For example, a payment processor may authorize a
payment even when its response is lost.

**Architecture Decision Record (ADR)** — A document that records a significant
architectural decision and its rationale. DistLab requires an ADR for changes
to fundamental simulation semantics.

**Architecture state** — The definition of the distributed system: clients,
services, connections, resources, subscriptions, configuration, and network
policies. It is separate from the state of a particular execution.

**Assessment engine** — The component that runs scenarios, evaluates
invariants, and reports results without requiring one prescribed solution
pattern.

**Backpressure** — A strategy for controlling work when producers create it
faster than consumers can process it.

**Business invariant** — A property that must remain true, or eventually
become true, regardless of implementation strategy. Examples include
`stock >= 0` and allowing no more than one fulfillment per order.

**Business state** — Domain data owned primarily by internal services, such as
orders, payments, inventory, carts, and reporting projections.

**Cache invalidation** — The process of removing or refreshing cached data when
its source changes so that stale values do not remain indefinitely.

**Circuit breaker** — A resilience pattern that temporarily stops calls to a
failing dependency and later probes whether it has recovered.

**Client** — An external actor that initiates interactions through the
`VirtualNetwork`. A client may retry requests and hold client-side identifiers,
but does not own internal service state.

**Client runtime** — The controlled execution environment for a client. It
provides simulated networking, time, and logging rather than direct access to
simulation internals.

**Commit** — The successful completion of a local database transaction, after
which its changes remain durable in the simulation even if the owning service
crashes.

**Compensation** — A business operation that counteracts an earlier completed
operation when a distributed workflow cannot continue. It is not a global
database rollback.

**Component** — An element that participates in a DistLab architecture. Runtime
components belong to one of four explicit categories: client, internal service,
external service, or infrastructure primitive.

**CQRS** — Command Query Responsibility Segregation, a pattern that separates
state-changing operations from read models. DistLab uses reporting projections
to teach this separation.

**Database** — A small, service-owned transactional state store that models
tables, constraints, reads, writes, commit, and rollback. It is not a SQL engine
or a vendor-specific database emulator.

**Dead-letter queue** — A destination for messages that cannot be processed
successfully after the applicable delivery or retry policy.

**Deduplication** — Detecting repeated requests or messages and preventing
their effects from being applied more than intended.

**Deterministic simulation** — Execution that produces the same result and
history for the same architecture, scenario, configuration, and seed.

**Discrete-event simulation** — A simulation model in which the scheduler
advances logical time from one queued event to the next instead of following
wall-clock time.

**Distributed interaction** — Communication across component boundaries. In
DistLab, synchronous interactions pass through `VirtualNetwork` and
asynchronous interactions pass through `MessageBus`; components cannot call one
another directly.

**Duplicate delivery** — Delivery of the same logical message more than once.
Consumers often need idempotency or deduplication to tolerate it.

**Event queue** — The simulation kernel's ordered collection of scheduled
events. Events are ordered first by simulation time and then by sequence number.

**Eventual consistency** — A model in which services or projections may
temporarily disagree but are expected to converge after messages and corrective
actions are processed.

**Execution history** — The immutable sequence of observations emitted during
a run. It drives timelines, traces, replay, debugging, animation, and assessment
diagnostics.

**External service** — A dependency outside the simulated organization's
control. Its contract and scenario-configured behavior are visible, while its
internal implementation is normally opaque to students.

**External service runtime** — The controlled environment that executes an
external service's operations, latency, availability, callbacks, and configured
failure behavior.

**Failure injection** — Deliberately applying a modeled fault—such as delay,
drop, duplication, timeout, crash, disconnection, reordering, or rate
limiting—to an observable operation.

**Fault engine** — The runtime model that matches simulation events against
fault rules and applies their effects reproducibly.

**Idempotency** — The property that repeating an operation with the same
identity does not apply its business effect more than once.

**Inbox** — A consumer-side pattern that records handled message identifiers so
duplicate deliveries can be detected and safely ignored.

**Infrastructure primitive** — A purpose-built model that provides distributed
semantics without emulating a vendor product. Initial primitives are
`VirtualNetwork`, `MessageBus`, `Database`, `KeyValueStore`, `VirtualClock`, and
`Scheduler`.

**Internal service** — A logical, isolated service controlled by the
architecture under study. It may own business state, endpoints, subscriptions,
background tasks, a `Database`, and a `KeyValueStore`.

**KeyValueStore** — A small model for ephemeral or coordination state. It
supports operations and concepts such as TTL, set-if-absent, counters,
compare-and-set, idempotency keys, locks, and leases.

**Latency** — Simulated elapsed time between communication events. Network and
external-service policies can add fixed or variable latency without causing a
real-time wait.

**Lease** — Time-limited ownership of a resource or coordination role. A lease
must be renewed or expires according to the `VirtualClock`.

**Local transaction** — An atomic transaction within one service-owned
`Database`. DistLab does not provide an automatic transaction or rollback
across services.

**Message** — A unit of asynchronous communication published to a queue or
topic and delivered to one or more consumers by the `MessageBus`.

**MessageBus** — A generic asynchronous messaging model supporting publish and
subscribe, queues, topics, acknowledgements, redelivery, competing consumers,
duplicates, delays, drops, and ordering changes.

**Negative acknowledgement (NACK)** — A consumer's indication that a delivered
message was not processed successfully. The bus may redeliver or dead-letter
the message according to its policy.

**Network policy** — Configuration that controls a virtual link's latency,
jitter, timeout, and failure rate.

**Observability** — The structured visibility into requests, messages, state
changes, database operations, faults, and component lifecycle events that makes
a distributed execution inspectable.

**Observation** — A structured record of a meaningful simulation operation,
including its simulation time, source, optional target, type, data, and trace
identifier where applicable.

**Optimistic concurrency** — A coordination strategy that detects conflicting
updates when a write is attempted rather than preventing all concurrent work in
advance.

**Projection** — A derived read model built from system activity, commonly by
consuming events. A projection can lag behind its source state.

**Rate limiting** — Restricting how many operations a component accepts over a
period of simulated time.

**Redelivery** — Delivering a message again after an earlier attempt was not
acknowledged or did not complete successfully.

**Replay** — Reconstructing or re-examining execution from recorded events or a
saved state. Deterministic execution makes replay reproducible.

**Retry** — Repeating an operation after a failure or uncertain outcome. A
retry can create duplicates, so it is commonly paired with idempotency.

**Rollback** — Reverting the uncommitted changes of a local database
transaction. It does not undo already committed work in other services.

**Saga** — A distributed workflow composed of local transactions and, when
necessary, compensating actions rather than one global transaction.

**Scenario** — A reproducible experiment that defines an architecture, initial
business state, client actions, external behavior, network policies, faults,
configuration, seed, assertions, and invariants as needed.

**Scenario engine** — The application-layer component that interprets and runs
scenarios independently of the UI.

**Scheduler** — The simulation-kernel component that orders and executes queued
events according to virtual time and deterministic sequence.

**Seed** — An input value that initializes controlled pseudo-random behavior so
the same run can be reproduced.

**Seeded randomness** — Pseudo-random behavior obtained from the simulation's
seeded generator. Simulation code must use it instead of `Math.random()`.

**Service lifecycle** — The modeled operational state of an internal service:
`STARTING`, `RUNNING`, `PAUSED`, `CRASHED`, or `STOPPED`.

**Service runtime** — The controlled execution environment for an internal
service. It exposes assigned storage, messaging, networking, virtual time, and
logging while preserving service isolation.

**Simulation kernel** — The lowest-level domain component. It owns logical
time, scheduling, the event queue, seeded randomness, and execution history.

**Simulation state** — The mutable state of a run, including current time,
queued events, component lifecycles, external availability, network state,
messages, faults, and random-generator state.

**Simulation time** — Logical time controlled by `VirtualClock`; it can advance
without waiting for the equivalent amount of wall-clock time.

**Snapshot** — A serializable capture of the simulation state that can support
future replay, rewind, execution forks, comparisons, and save/load operations.

**State ownership** — The rule that each internal service owns and directly
accesses only its assigned business data and database.

**Subscription** — The association between a `MessageBus` destination and a
consumer that should receive messages from it.

**Timeout** — The caller's observation that an operation did not produce a
response within its configured simulated duration. A timeout alone does not
prove that the remote operation failed.

**Trace** — A correlated view of related operations across clients, internal
services, external services, messages, and infrastructure. A `traceId` links
the observations that belong to the same distributed interaction.

**Transaction** — A group of database operations that commits or rolls back as
one local unit.

**Transactional outbox** — A pattern that records an intended outgoing message
in the same local transaction as a business-state change, then publishes it
asynchronously.

**TTL (time to live)** — A simulated duration after which an entry, such as a
cart value or coordination key, expires.

**UI state** — Presentation-only state such as selection, viewport, zoom, open
panels, timeline position, and editor state. It must remain independent from
simulation semantics.

**VirtualClock** — The abstraction that owns simulation time. Simulation code
uses it for the current time, sleeping, and scheduling instead of `Date.now()`,
`setTimeout()`, or `setInterval()`.

**VirtualNetwork** — The model through which all synchronous distributed
communication passes. It can simulate latency, loss, timeout, disconnection,
and unavailable targets.

**Wall-clock time** — Real elapsed time measured by the browser or operating
system. Simulation behavior must not depend on it.

**Webhook** — An asynchronous callback sent over the `VirtualNetwork`, often
from an external service or to a partner client.

## Reference Components

### Internal Services

| Component | Responsibility |
| --- | --- |
| `Catalog` | Owns product information and supports read-heavy and caching scenarios. |
| `Customer` | Owns customer business information, addresses, preferences, and status. |
| `Cart` | Owns temporary shopping-session state and expiration behavior. |
| `Orders` | Owns the commercial order lifecycle and commonly coordinates workflows. |
| `Inventory` | Owns stock, reservations, releases, and reservation expiration. |
| `Payments` | Owns platform payment state and interactions with external payment processors. |
| `Fulfillment` | Owns preparation and shipment workflows after an order is ready. |
| `Notifications` | Owns notification intent, delivery state, and delivery attempts. |
| `Reporting` | Builds derived views and operational projections from events. |

### Clients

| Component | Responsibility |
| --- | --- |
| `Customer App` | Represents a customer-facing web or mobile application. |
| `Backoffice` | Represents an administrative or operational client. |
| `Warehouse App` | Represents software used by staff during order preparation and dispatch. |
| `Partner API Client` | Represents another organization's machine-to-machine integration. |

### External Services

| Component | Responsibility |
| --- | --- |
| `Identity Provider` | Authenticates identities and issues or validates tokens. |
| `Payment Processor` | Authorizes, captures, refunds, and reports payment status. |
| `Fraud / Risk Provider` | Evaluates transactions and returns approval, review, or rejection decisions. |
| `Shipping Carrier` | Creates and cancels shipments and reports tracking state. |
| `Messaging Provider` | Accepts or rejects external email and SMS delivery requests. |
