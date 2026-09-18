# DistLab — Architecture

## 1. Architectural Goal

DistLab is a deterministic discrete-event simulator for distributed systems and microservice architectures.

The architecture must allow the simulator to control:

- time
- execution order
- clients
- internal services
- external services
- network communication
- message delivery
- service lifecycle
- persistent state
- ephemeral state
- failure injection
- observability

The simulation engine owns the distributed world.

No external infrastructure is required.

---

# 2. Fundamental Component Model

DistLab contains four major categories of runtime component.

```text
Client
Internal Service
External Service
Infrastructure Primitive
```

A typical architecture may look like:

```text
┌───────────────────┐
│   Customer App    │
│      Client       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│      Orders       │
│ Internal Service  │
└─────────┬─────────┘
          │
          │ message
          ▼
┌───────────────────┐
│    MessageBus     │
│ Infrastructure    │
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│     Payments      │
│ Internal Service  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Payment Processor │
│ External Service  │
└───────────────────┘
```

These component categories are semantically different and should remain explicit.

---

# 3. Architectural Principles

## 3.1 DistLab models semantics, not products

DistLab does not emulate specific infrastructure products.

Instead:

```text
Database engines      → Database
Redis / Valkey        → KeyValueStore
RabbitMQ / Kafka      → MessageBus
Network / HTTP        → VirtualNetwork
Process / container   → ServiceRuntime
External SaaS/API     → ExternalServiceRuntime
Web/mobile/API caller → ClientRuntime
System clock          → VirtualClock
```

Each model implements only the behavior required by supported educational scenarios.

---

## 3.2 Simulation owns time

Simulation code must never depend directly on wall-clock time.

Forbidden:

```ts
Date.now();
setTimeout(...);
setInterval(...);
```

Simulation code uses:

```ts
ctx.clock.now();
ctx.clock.sleep(...);
ctx.clock.schedule(...);
```

---

## 3.3 Simulation owns randomness

Direct use of:

```ts
Math.random()
```

inside simulation behavior is forbidden.

Random behavior must use a seeded generator.

Given the same:

```text
architecture
scenario
configuration
seed
```

execution must be reproducible.

---

## 3.4 Distributed interaction must be explicit

Components cannot communicate directly.

Internal synchronous interaction:

```text
Orders
   │
   ▼
VirtualNetwork
   │
   ▼
Payments
```

Interaction with an external dependency:

```text
Payments
   │
   ▼
VirtualNetwork
   │
   ▼
Payment Processor
```

Asynchronous interaction:

```text
Orders
   │
   ▼
MessageBus
   │
   ▼
Inventory
```

Clients also communicate through the simulated network:

```text
Customer App
    │
    ▼
VirtualNetwork
    │
    ▼
Orders
```

No runtime component may bypass these communication models.

---

# 4. Runtime Component Types

## 4.1 Client

A client initiates interaction with the distributed system.

Examples:

```text
Customer App
Backoffice
Warehouse App
Partner API Client
```

Clients may:

- send requests
- receive responses
- retry requests
- hold client-side identifiers
- receive callbacks or webhooks when appropriate

Clients do not own internal service state.

---

## 4.2 Internal Service

An internal service is controlled by the architecture being studied.

Examples:

```text
Catalog
Customer
Cart
Orders
Inventory
Payments
Fulfillment
Notifications
Reporting
```

Internal services may own:

- Database
- KeyValueStore
- endpoints
- message subscriptions
- business state
- background tasks

Students may configure or modify their behavior depending on the exercise.

---

## 4.3 External Service

An external service represents a dependency outside the organization's control.

Examples:

```text
Identity Provider
Payment Processor
Fraud / Risk Provider
Shipping Carrier
Messaging Provider
```

External services expose behavior but generally do not expose their internal implementation.

Their behavior may be configured by scenarios.

Examples:

```text
normal
slow
unavailable
rate-limited
ambiguous timeout
duplicate callback
delayed callback
```

---

## 4.4 Infrastructure Primitive

Infrastructure primitives implement distributed semantics.

Initial primitives:

```text
VirtualNetwork
MessageBus
Database
KeyValueStore
VirtualClock
Scheduler
```

These are not represented as vendor products.

---

# 5. High-Level Architecture

```text
┌─────────────────────────────────────────────┐
│                    UI                       │
│                                             │
│ Canvas | Inspector | Timeline | State       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│             Application Layer               │
│                                             │
│ Architecture definitions                    │
│ Scenario Engine                             │
│ Assessment                                  │
│ Service Catalog                             │
│ Client Catalog                              │
│ External Service Catalog                    │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│              Runtime Models                 │
│                                             │
│ Client Runtime                              │
│ Internal Service Runtime                    │
│ External Service Runtime                    │
│ Virtual Network                             │
│ Message Bus                                 │
│ Database                                    │
│ KeyValueStore                               │
│ Fault Engine                                │
│ Observability                               │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│             Simulation Kernel               │
│                                             │
│ Virtual Clock                               │
│ Scheduler                                   │
│ Event Queue                                 │
│ Seeded Randomness                           │
│ Execution History                           │
└─────────────────────────────────────────────┘
```

---

# 6. Suggested Repository Structure

```text
apps/
  web/

packages/
  simulation-core/
  virtual-network/
  message-bus/

  runtimes/
    client-runtime/
    service-runtime/
    external-service-runtime/

  database/
  kv-store/
  fault-engine/
  observability/
  scenario-engine/
  assessment/

  catalogs/
    services/
    clients/
    external-services/

  shared/

examples/
  catalog-cache/
  checkout/
  duplicate-message/
  processor-timeout/
  inventory-concurrency/
  shipment-workflow/
  reporting-projection/
  saga/
  outbox/

docs/
  vision.md
  architecture.md
  glossary.md
  adr/
```

The exact package structure may evolve.

The semantic component boundaries are more important than the folder names.

---

# 7. Simulation Kernel

The simulation kernel is the lowest-level domain component.

It controls execution using discrete events.

Conceptually:

```ts
interface ScheduledEvent {
  id: string;

  time: SimulationTime;

  sequence: number;

  source?: ComponentId;

  target?: ComponentId;

  type: string;

  execute(): void | Promise<void>;
}
```

Events execute in deterministic order:

```text
simulation time
      ↓
sequence number
```

---

# 8. Simulation API

Conceptually:

```ts
interface Simulation {
  readonly time: SimulationTime;

  schedule(event: ScheduledEvent): void;

  step(): Promise<SimulationStep | undefined>;

  run(): Promise<void>;

  pause(): void;

  reset(): Promise<void>;
}
```

Possible future operations:

```ts
runUntil(time);
runUntil(predicate);
fastForward(duration);
snapshot();
restore(snapshot);
```

---

# 9. Virtual Clock

The virtual clock represents logical simulation time.

```ts
ctx.clock.now();

await ctx.clock.sleep(5_000);
```

`sleep(5_000)` means:

```text
resume execution at simulated time + 5000
```

No real five-second delay is required.

---

# 10. Virtual Network

All synchronous distributed communication passes through `VirtualNetwork`.

This includes:

```text
Client → Internal Service
Internal Service → Internal Service
Internal Service → External Service
External Service → Internal Service callback
```

Conceptually:

```ts
interface VirtualNetwork {
  request<TRequest, TResponse>(
    source: ComponentId,
    target: ComponentId,
    request: TRequest
  ): Promise<TResponse>;
}
```

A link may define:

```ts
interface NetworkPolicy {
  latency?: number;
  jitter?: number;
  timeout?: number;
  failureRate?: number;
}
```

The network may simulate:

- request delay
- response delay
- request loss
- response loss
- timeout
- disconnected component
- unavailable target

A timeout must not automatically imply that the remote operation failed.

---

# 11. Client Runtime

A client represents an external actor interacting with the system.

Conceptually:

```ts
defineClient({
  name: "customer-app",

  actions: {
    browseCatalog,
    addToCart,
    placeOrder,
    cancelOrder
  }
});
```

A client context may expose:

```ts
interface ClientContext {
  http: ClientHttp;
  clock: VirtualClock;
  log: ClientLogger;
}
```

Client behavior may include retry strategies.

This is useful for scenarios such as duplicate requests caused by impatient or retrying clients.

---

# 12. Internal Service Runtime

An internal service is a logical isolated actor.

Conceptually:

```ts
defineService({
  name: "orders",

  endpoints: {
    "POST /orders": createOrder
  },

  consumers: {
    PaymentAuthorized: handlePaymentAuthorized
  }
});
```

A service receives a controlled context:

```ts
interface ServiceContext {
  db: Database;
  kv: KeyValueStore;

  events: ServiceMessageBus;
  http: ServiceHttpClient;

  clock: VirtualClock;

  log: ServiceLogger;
}
```

Internal services must not access global simulation internals.

---

# 13. External Service Runtime

External services behave differently from internal services.

They expose contracts and scenario-controlled behavior.

Conceptually:

```ts
defineExternalService({
  name: "payment-processor",

  operations: {
    authorize,
    capture,
    refund,
    getStatus
  }
});
```

A scenario may configure an operation:

```yaml
payment-processor:
  authorize:
    result: success
    latency: 500
    dropResponse: true
```

The internal implementation of an external service should normally remain opaque to students.

Students observe:

- request
- response
- timeout
- callback
- externally visible state when appropriate

but do not debug its internal algorithm.

---

# 14. Service Lifecycle

Internal services should eventually support:

```text
STARTING
RUNNING
PAUSED
CRASHED
STOPPED
```

A crash affects future processing without corrupting the simulation itself.

Example:

```text
Payments

RUNNING
   ↓
DB COMMIT
   ↓
CRASHED
```

Committed state remains committed.

---

# 15. External Service Availability

External services may expose simpler lifecycle states:

```text
AVAILABLE
DEGRADED
UNAVAILABLE
RATE_LIMITED
```

Scenario behavior can change over simulated time.

Example:

```text
t=0       Payment Processor AVAILABLE
t=5000    Payment Processor UNAVAILABLE
t=15000   Payment Processor AVAILABLE
```

---

# 16. Database

The DistLab database is a small transactional state store.

It is not a relational database emulator.

Its purpose is to model:

- service-owned persistent state
- tables
- reads
- inserts
- updates
- deletes
- local transactions
- commit
- rollback
- simple constraints

Possible API:

```ts
interface Database {
  table<T>(name: string): Table<T>;

  transaction<T>(
    operation: (tx: Transaction) => T | Promise<T>
  ): Promise<T>;
}
```

SQL is intentionally outside the initial design.

---

# 17. Database Ownership

Databases belong to internal services.

Example:

```text
Catalog
  └── CatalogDB

Orders
  └── OrdersDB

Payments
  └── PaymentsDB

Inventory
  └── InventoryDB
```

A service should access only its assigned database.

External services may maintain opaque internal state, but this should not use the same student-facing database abstraction unless an exercise explicitly requires visibility.

---

# 18. KeyValueStore

The key-value store is a small model for ephemeral or coordination state.

Possible API:

```ts
interface KeyValueStore {
  get<T>(key: string): T | undefined;

  set<T>(
    key: string,
    value: T,
    options?: SetOptions
  ): boolean;

  delete(key: string): boolean;

  increment(key: string): number;

  compareAndSet<T>(
    key: string,
    expected: T,
    next: T
  ): boolean;
}
```

Possible options:

```ts
interface SetOptions {
  ttl?: number;
  ifAbsent?: boolean;
}
```

It supports scenarios involving:

- Cart expiration
- cache
- TTL
- idempotency keys
- deduplication
- counters
- locks
- leases
- compare-and-set

---

# 19. Message Bus

The message bus is a generic educational messaging model.

It is not RabbitMQ, Kafka, NATS, or MQTT.

Core concepts:

```text
Message
Destination
Topic
Queue
Subscription
Consumer
Delivery
Acknowledgement
```

Conceptual API:

```ts
interface MessageBus {
  publish(
    destination: string,
    message: Message
  ): void;

  subscribe(
    destination: string,
    consumer: ConsumerId,
    handler: MessageHandler
  ): Subscription;
}
```

Possible message states:

```text
PUBLISHED
QUEUED
IN_FLIGHT
ACKED
NACKED
RETRY
DROPPED
DEAD
```

The simulator should support:

- duplicate delivery
- delayed delivery
- dropped messages
- acknowledgement
- negative acknowledgement
- redelivery
- competing consumers
- pub/sub
- ordering changes

---

# 20. Reference Service Catalog

The initial internal service catalog contains:

```text
Catalog
Customer
Cart
Orders
Inventory
Payments
Fulfillment
Notifications
Reporting
```

Templates should declare:

- endpoints
- commands
- produced messages
- consumed messages
- database structure
- valid state transitions
- configurable behaviors
- invariants

Templates must remain independent of UI code.

---

# 21. Reference Client Catalog

The initial client catalog contains:

```text
Customer App
Backoffice
Warehouse App
Partner API Client
```

Clients should define:

- supported actions
- target interfaces
- optional retry behavior
- authentication behavior when relevant

Clients should remain reusable between scenarios.

---

# 22. Reference External Service Catalog

The initial external-service catalog contains:

```text
Identity Provider
Payment Processor
Fraud / Risk Provider
Shipping Carrier
Messaging Provider
```

External service templates define:

- exposed operations
- possible responses
- state visible to scenarios
- failure modes
- latency profiles
- callback behavior where relevant

---

# 23. Fault Engine

Faults operate on observable simulation operations.

Possible fault targets include:

```text
client request
network request
network response
message delivery
database transaction
database commit
internal service lifecycle
external service operation
external callback
```

Conceptually:

```ts
interface FaultRule {
  match(
    event: SimulationEvent
  ): boolean;

  apply(
    event: SimulationEvent
  ): FaultEffect;
}
```

Initial effects:

```text
delay
drop
duplicate
timeout
fail
crash
disconnect
reorder
rate-limit
```

---

# 24. Deterministic Fault Injection

Fault execution must be reproducible.

Example:

```text
t=100  Payments → Processor authorize
t=120  Processor AUTHORIZED
t=121  response dropped
t=2121 Payments timeout
```

The same architecture, scenario, and seed must reproduce this execution.

---

# 25. Observability

Every meaningful operation should emit structured observation events.

Conceptually:

```ts
interface Observation {
  id: string;

  time: SimulationTime;

  traceId?: string;

  source: ComponentId;

  target?: ComponentId;

  type: ObservationType;

  data?: unknown;
}
```

Examples:

```text
client.action.started

service.started
service.crashed

external.request.received
external.operation.completed

network.request.sent
network.request.received
network.response.sent
network.timeout

message.published
message.queued
message.delivered
message.acked
message.redelivered

db.transaction.started
db.row.inserted
db.row.updated
db.transaction.committed
db.transaction.rolled_back

kv.set
kv.expired

fault.injected
```

---

# 26. Execution History

Observations form an immutable execution history.

Example:

```text
t=0      customer.place_order
t=10     network.request.sent
t=20     orders.request.received
t=25     db.transaction.started
t=30     db.transaction.committed
t=35     message.published
t=50     message.delivered
t=60     payments.external_request.sent
t=90     processor.authorization.completed
t=91     network.response.dropped
```

Execution history drives:

- timeline
- traces
- animation
- debugging
- assessment diagnostics
- replay

---

# 27. Trace Model

Distributed operations should support correlation.

Example:

```text
traceId: trace-91

Customer App
  └─ PlaceOrder
      └─ Orders
          └─ OrderCreated
              └─ Payments
                  └─ Payment Processor
              └─ Inventory
              └─ Reporting
```

Tracing includes clients and external services, not only internal microservices.

---

# 28. Scenario Engine

A scenario describes an experiment.

It may define:

```text
architecture
initial business state
client actions
external-service behavior
network policies
fault rules
seed
assertions
invariants
```

Example:

```yaml
name: payment-response-lost

seed: 1234

actions:
  - client: customer-app
    action: place-order
    data:
      orderId: order-42
      amount: 15000

external:
  payment-processor:
    authorize:
      result: success
      dropResponse: true

expect:
  invariants:
    - order-not-charged-twice
```

The scenario engine must not depend on the UI.

---

# 29. Invariants

Invariants describe properties that must hold independently of implementation strategy.

Examples:

```text
stock >= 0

capturedAmount(order) <= order.total

activeReservations(order) <= 1

fulfillments(order) <= 1
```

Some properties are eventual:

```text
IF order.status == CANCELLED

THEN EVENTUALLY

payment.status != CAPTURED
```

External interactions may also participate in invariants:

```text
processor.authorizations(
  idempotencyKey
) <= 1
```

---

# 30. Assessment Engine

The assessment engine executes scenarios and evaluates properties.

```text
Student Architecture
        │
        ▼
Assessment Scenarios
        │
        ▼
Simulation
        │
        ▼
Invariant Evaluation
        │
        ▼
Results
```

Example:

```text
Happy path                     PASS
Duplicate client request       PASS
Duplicate OrderCreated         FAIL
Inventory unavailable          PASS
Processor response lost        FAIL
Messaging Provider down        PASS
```

Assessment should avoid prescribing specific patterns.

---

# 31. Architecture State

Architecture state describes:

```text
clients
internal services
external services
connections
resources
configuration
subscriptions
network policies
```

This is separate from execution state.

---

# 32. Simulation State

Simulation state includes:

```text
current time
event queue
component lifecycle
external-service availability
network state
messages in flight
message queues
fault state
random generator state
```

---

# 33. Business State

Business state belongs primarily to internal services.

Examples:

```text
products
customers
carts
orders
payments
inventory
shipments
notifications
reporting projections
```

External systems may maintain limited scenario-visible state such as:

```text
external authorization created
shipment registered
message accepted
```

---

# 34. UI State

UI state includes:

```text
selected component
viewport
zoom
open panels
timeline position
editor state
```

UI state must remain independent from simulation semantics.

---

# 35. Snapshots

The architecture should allow simulation snapshots.

A snapshot may contain:

```text
clock
scheduler
client state
service lifecycle
external-service state
database state
KV state
message-bus state
network state
random generator state
```

This enables future:

```text
replay
rewind
fork execution
comparison
save/load
```

---

# 36. UI Architecture

The initial application may use:

```text
┌────────────┬────────────────────────┬─────────────┐
│ Palette    │                        │ Inspector   │
│            │                        │             │
│ Clients    │        Canvas          │ Config      │
│ Services   │                        │ State       │
│ External   │                        │ Faults      │
│ Infra      │                        │             │
├────────────┴────────────────────────┴─────────────┤
│ Timeline | Messages | Logs | Traces | State       │
└───────────────────────────────────────────────────┘
```

The palette should visually distinguish:

```text
Clients
Internal Services
External Services
Infrastructure
```

---

# 37. Dependency Direction

The intended dependency direction is approximately:

```text
simulation-core
      ↑
      │
 ┌────┼────────────────────┐
 │    │                    │
network               message-bus
database              kv-store
fault-engine          observability
 │    │                    │
 └────┼────────────────────┘
      ↑
runtime models
      ↑
scenario-engine
      ↑
catalogs
assessment
      ↑
web
```

Low-level packages must never depend on UI.

Circular dependencies are forbidden.

---

# 38. Core Determinism Constraints

Simulation behavior must not directly use:

```text
Date.now
Math.random
setTimeout
setInterval
fetch
external network calls
browser clock
```

Instead use controlled abstractions:

```text
VirtualClock
SeededRandom
VirtualNetwork
Scheduler
```

---

# 39. Testing Philosophy

Simulation components must be testable without the UI.

Tests should prefer:

```text
construct architecture
configure scenario
run simulation
inspect history/state
assert invariants
```

Real-time sleeps are forbidden in simulation tests.

---

# 40. Architectural Change Policy

An ADR is required when modifying fundamental semantics including:

- event scheduling
- virtual time
- message delivery
- network behavior
- transaction behavior
- state ownership
- deterministic execution
- client semantics
- external-service semantics
- service isolation
- snapshot semantics
- package dependency direction

Agents must not change these implicitly.

---

# 41. Initial Architectural Decisions

DistLab initially adopts:

1. Browser-first execution.
2. TypeScript implementation.
3. Deterministic discrete-event simulation.
4. Virtual simulation time.
5. Seeded randomness.
6. Generic simulated network.
7. Generic simulated message bus.
8. Small purpose-built transactional database.
9. Small purpose-built key-value store.
10. Explicit distinction between clients, internal services, and external services.
11. Prefabricated catalogs for all three categories.
12. Structured observability events.
13. Serializable simulation state where practical.
14. Scenario-driven external behavior and fault injection.
15. Invariant-oriented assessment.
16. UI separated from simulation semantics.
17. No dependency on real infrastructure products.
18. No Kubernetes simulation in the initial scope.

---

# 42. Architectural Rule of Thumb

Before introducing a dependency, component, or abstraction, ask:

> Which distributed-system behavior does this make possible to observe, teach, or evaluate?

If there is no clear educational answer, the feature probably does not belong in the core.

DistLab should remain intentionally smaller than the distributed systems it teaches.
