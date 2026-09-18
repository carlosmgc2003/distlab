# DistLab

> Distributed Systems & Microservices Simulator

## 1. Vision

DistLab is a browser-based educational simulator for designing, executing, observing, breaking, and debugging distributed systems.

Its goal is to make distributed-system behavior visible and experimentally understandable.

DistLab is inspired by the learning experience of network simulators such as Packet Tracer:

- build a system visually
- connect components
- run scenarios
- inspect communication
- pause execution
- advance step by step
- inject failures
- observe state changes
- diagnose incorrect behavior
- modify the design
- run the experiment again

DistLab focuses on distributed systems and microservice architecture rather than network protocols.

The fundamental objective is not to reproduce production infrastructure.

The objective is to reproduce the **semantics that matter when reasoning about distributed systems**.

---

# 2. Problem

Distributed systems are difficult to teach because many of their most important properties are invisible.

Inside a single process, execution is relatively intuitive:

```text
functionA()
    ↓
functionB()
    ↓
functionC()
```

A distributed system introduces boundaries:

```text
Service A
    │
    │ request
    ▼
Network
    │
    │ latency / failure / timeout
    ▼
Service B
```

Important questions become harder to answer:

- Did the request reach the service?
- Did the service change its state?
- Did the transaction commit?
- Was the response lost?
- Was a message delivered more than once?
- Why do different services currently disagree?
- What happens if a service crashes after commit?
- Did a retry repeat an operation?
- Can a timeout determine whether an operation succeeded?
- Which event caused a state transition?
- What happens when an external dependency becomes unavailable?

Real infrastructure can demonstrate these problems, but usually introduces substantial accidental complexity.

Teaching Saga should not require first configuring containers, databases, brokers, tracing systems, networking, credentials, and backend frameworks.

DistLab removes that accidental complexity.

---

# 3. Core Idea

DistLab provides a small deterministic distributed world.

Instead of reproducing real infrastructure products, it provides controlled educational models:

```text
Real system                   DistLab model

Database engine         →     Database
Redis / Valkey          →     KeyValueStore
RabbitMQ / Kafka        →     MessageBus
HTTP / network          →     VirtualNetwork
OS clock                →     VirtualClock
Process / container     →     ServiceRuntime
External SaaS/API       →     ExternalService
Browser/mobile/API      →     Client
```

These components reproduce only the observable semantics required by the learning scenarios.

For example, the simulated database may need:

- persistent service state
- tables
- transactions
- commit
- rollback
- constraints
- deterministic failure points
- visual inspection

It does not need:

- SQL parsing
- query planning
- indexes
- WAL
- MVCC
- vendor compatibility

DistLab models concepts, not products.

---

# 4. Target Audience

The primary audience is students learning:

- software architecture
- microservices
- distributed systems
- backend engineering
- resilient systems
- event-driven architecture

Secondary uses include:

- university exercises
- examinations
- architecture workshops
- technical training
- demonstrations
- interviews
- experimentation with distributed-system patterns

---

# 5. Reference Domain

DistLab starts with a generic digital commerce platform.

The domain is intentionally broader than payments.

It contains:

- read-heavy services
- transactional services
- ephemeral state
- concurrent resource allocation
- asynchronous workflows
- long-running business processes
- external dependencies
- human clients
- machine-to-machine clients

The reference domain exists to create useful distributed-system problems.

It is not intended to model one specific company or production architecture.

---

# 6. Internal Service Catalog

The initial reference architecture contains the following prefabricated services.

## Catalog

Owns product information.

Typical responsibilities:

- products
- descriptions
- prices
- availability information
- search-oriented reads

Useful for teaching:

- read-heavy services
- caching
- stale data
- cache invalidation
- replication/read-model concepts

---

## Customer

Owns customer business information.

Typical responsibilities:

- customer profile
- addresses
- preferences
- customer status

Useful for teaching:

- service ownership
- privacy boundaries
- synchronous dependencies
- profile propagation through events

Authentication itself is intentionally delegated to an external Identity Provider.

---

## Cart

Owns temporary shopping-session state.

Typical responsibilities:

- cart items
- quantities
- temporary selections
- expiration

Useful for teaching:

- ephemeral data
- TTL
- key-value storage
- session-like state
- expiration

---

## Orders

Owns the commercial order lifecycle.

Typical states may include:

```text
CREATED
PENDING_PAYMENT
CONFIRMED
CANCELLED
COMPLETED
```

Orders acts as an important coordination point in many scenarios.

Useful for teaching:

- business workflows
- orchestration
- state machines
- eventual consistency
- Saga

---

## Inventory

Owns stock and reservations.

Typical responsibilities:

- available stock
- reservation
- release
- reservation expiration

Useful for teaching:

- concurrency
- idempotency
- resource reservation
- race conditions
- optimistic coordination
- duplicate messages

---

## Payments

Owns the platform's payment state.

Typical responsibilities:

- payment intents
- authorization state
- capture state
- refund state
- interaction with external payment processors

Useful for teaching:

- timeout ambiguity
- idempotency
- external dependencies
- retries
- compensation
- reconciliation

Payments does not implement the banking network itself.

It relies on an external Payment Processor.

---

## Fulfillment

Owns the fulfillment lifecycle after an order is ready.

Typical responsibilities:

- preparation
- shipment request
- tracking reference
- fulfillment status

Useful for teaching:

- long-running workflows
- external carrier dependency
- delayed responses
- eventual consistency
- webhook-like interactions

---

## Notifications

Owns notification intent and delivery state.

Typical responsibilities:

- email notifications
- SMS notifications
- push-like messages
- delivery attempts

Useful for teaching:

- asynchronous consumers
- retry
- dead-letter behavior
- non-critical failures
- external provider integration

---

## Reporting

Maintains derived views of system activity.

Typical responsibilities:

- sales totals
- orders by status
- payment summaries
- product activity
- operational metrics

Reporting primarily consumes events rather than owning transactional workflows.

Useful for teaching:

- CQRS
- projections
- eventual consistency
- replay
- slow consumers
- stale read models

---

# 7. Why This Service Set Is Balanced

The initial catalog intentionally contains different architectural characteristics.

```text
Catalog         read-heavy
Customer        entity ownership
Cart            ephemeral state
Orders          workflow coordination
Inventory       concurrency and reservations
Payments        uncertain external operations
Fulfillment     long-running external workflow
Notifications   asynchronous side effects
Reporting       event-driven projections
```

This allows exercises to explore different distributed-system problems without forcing every scenario through the same architectural pattern.

---

# 8. External Services

Some important capabilities exist outside the simulated organization's control.

DistLab represents these as `ExternalService` components.

External services are part of the distributed system but are not internally modifiable by the student unless the scenario explicitly permits configuration.

They can be slow, unavailable, inconsistent, or return uncertain outcomes.

---

## Identity Provider

Provides authentication and identity tokens.

Examples in real systems might include hosted identity platforms or enterprise identity providers.

Possible behaviors:

- authenticate
- issue token
- validate token
- token expiration
- temporary unavailability

Useful for teaching:

- authentication boundaries
- dependency on external identity
- token expiration
- availability assumptions

---

## Payment Processor

Represents an external payment gateway, acquirer, or processor.

Typical operations:

```text
authorize
capture
refund
getPaymentStatus
```

Possible behaviors:

- accepted payment
- rejected payment
- slow response
- timeout before execution
- timeout after execution
- duplicate request handling
- temporary outage

This component is especially useful for demonstrating that:

```text
timeout != payment failed
```

---

## Fraud / Risk Provider

Evaluates transactions before certain operations proceed.

Possible operations:

```text
evaluateTransaction
```

Possible responses:

```text
APPROVE
REVIEW
REJECT
```

Useful for teaching:

- synchronous external dependencies
- timeout strategies
- fallback behavior
- circuit breakers
- business consequences of unavailable dependencies

---

## Shipping Carrier

Represents an external logistics provider.

Possible operations:

```text
createShipment
cancelShipment
getTrackingStatus
```

It may also generate asynchronous tracking events.

Useful for teaching:

- long-running external workflows
- asynchronous callbacks
- delayed state
- external eventual consistency

---

## Messaging Provider

Represents external email/SMS delivery infrastructure.

Possible operations:

```text
sendEmail
sendSMS
```

Possible behaviors:

- accepted
- rejected
- rate limited
- temporary outage
- delayed delivery

Useful for teaching:

- retry
- non-critical external failures
- rate limiting
- dead-letter behavior

---

# 9. External Actors and Clients

DistLab distinguishes internal services from entities that initiate interactions with the system.

These entities do not own internal platform state.

They interact through APIs, commands, user actions, or external callbacks.

---

## Customer App

Represents a web or mobile application used by a customer.

Typical actions:

```text
browse catalog
manage cart
place order
view order
cancel order
```

It may communicate with several services indirectly through the system's exposed interfaces.

---

## Backoffice

Represents an administrative or operational client.

Typical actions:

```text
inspect order
cancel order
refund payment
modify catalog
inspect customer
```

Useful for scenarios involving:

- concurrent actions
- administrative overrides
- manual compensation
- operational workflows

---

## Warehouse App

Represents software used during order preparation.

Typical actions:

```text
accept fulfillment
mark prepared
report missing stock
dispatch shipment
```

This provides a second human-driven workflow independent of the customer.

---

## Partner API Client

Represents another organization's system interacting machine-to-machine.

Typical actions:

```text
create order
query order
receive webhook
request cancellation
```

Useful for teaching:

- API contracts
- retries
- idempotency keys
- duplicate requests
- webhook delivery
- partner availability

---

# 10. Example Reference Architecture

A moderately complete scenario may look like:

```text
                         ┌──────────────────┐
                         │   Customer App   │
                         └────────┬─────────┘
                                  │
                                  ▼
          ┌─────────┐       ┌─────────┐
          │ Catalog │       │  Cart   │
          └─────────┘       └────┬────┘
                                 │
                                 ▼
                            ┌────────┐
                            │ Orders │
                            └───┬────┘
                                │
                      OrderCreated
                                │
                        ┌───────▼───────┐
                        │  Message Bus  │
                        └───┬─────┬─────┘
                            │     │
                    ┌───────┘     └────────┐
                    ▼                      ▼
              ┌──────────┐           ┌───────────┐
              │ Payments │           │ Inventory │
              └────┬─────┘           └───────────┘
                   │
                   ▼
          ┌───────────────────┐
          │ Payment Processor │
          │     external      │
          └───────────────────┘
```

A larger workflow could continue through:

```text
InventoryReserved
        │
        ▼
Fulfillment
        │
        ▼
Shipping Carrier
```

while:

```text
Notifications
Reporting
```

consume events asynchronously.

---

# 11. Core Learning Goals

DistLab should help students experience the fundamental properties of distributed systems.

## Independent state

Each service owns its data.

```text
Orders
  └── OrdersDB

Payments
  └── PaymentsDB

Inventory
  └── InventoryDB
```

Services interact through explicit distributed boundaries.

---

## Remote communication can fail

A call may experience:

- latency
- timeout
- request loss
- response loss
- disconnection
- dependency outage

---

## Timeout does not imply failure

Example:

```text
Payments
    │
    │ authorize
    ▼
Payment Processor
    │
    ├── AUTHORIZED
    │
    X response lost
```

Payments observes:

```text
TIMEOUT
```

The processor may already contain an authorized transaction.

---

## Messages may be delivered more than once

Example:

```text
OrderConfirmed #91
OrderConfirmed #91
```

Consumers must frequently tolerate duplicate delivery.

---

## State may temporarily disagree

Example:

```text
Orders         CONFIRMED
Payments       AUTHORIZED
Inventory      RESERVED
Reporting      PENDING_UPDATE
Fulfillment    NOT_STARTED
```

Temporary inconsistency may be expected.

---

## There is no automatic global rollback

A failure may require compensation:

```text
Payment AUTHORIZED
Inventory FAILED

        ↓

Refund Payment
Cancel Order
```

---

## External dependencies are outside local control

The platform may behave correctly while:

```text
Payment Processor unavailable
Shipping Carrier slow
Identity Provider unavailable
Messaging Provider rate limited
```

Students should reason about where resilience belongs.

---

# 12. Product Experience

A typical activity should follow:

```text
DESIGN
  ↓
RUN
  ↓
OBSERVE
  ↓
BREAK
  ↓
INSPECT
  ↓
EXPLAIN
  ↓
MODIFY
  ↓
RUN AGAIN
```

---

# 13. Visual Architecture

Users compose systems from reusable components.

Three broad categories should be visually distinguishable:

```text
Internal Services
External Services
Clients / Actors
```

For example:

```text
Customer App
     │
     ▼
Orders ────────→ Payments ────────→ Payment Processor
  │
  │ events
  ▼
Message Bus
  │
  ├────────→ Inventory
  ├────────→ Notifications ───────→ Messaging Provider
  └────────→ Reporting
```

Requests and messages should be visible while they move through the system.

---

# 14. Educational Infrastructure Models

DistLab provides small purpose-built models.

## Database

Supports:

- tables
- insert
- update
- delete
- query
- transaction
- commit
- rollback
- simple constraints

---

## KeyValueStore

Supports concepts such as:

- cache
- TTL
- atomic set
- set-if-absent
- counters
- compare-and-set

---

## MessageBus

Supports:

- publish
- subscribe
- queue
- topic
- consumer
- acknowledgement
- negative acknowledgement
- redelivery
- duplicate delivery
- delayed delivery
- dropped delivery

---

## VirtualNetwork

Supports:

- request
- response
- latency
- timeout
- loss
- disconnection
- unavailable component

---

## VirtualClock

Controls simulation time.

Users can:

```text
Run
Pause
Step
Fast Forward
Reset
```

without depending on wall-clock time.

---

# 15. Deterministic Simulation

A fundamental property of DistLab is deterministic execution.

Given the same:

```text
architecture
scenario
configuration
random seed
```

DistLab must produce the same execution.

Example:

```text
seed: 839271

t=0      Customer places order
t=12     Orders COMMIT
t=18     OrderCreated
t=31     Payments calls Processor
t=42     Processor authorizes
t=45     Processor response lost
t=2045   Payments retry/status check
```

This execution must be reproducible.

---

# 16. Failure Injection

Failures are first-class elements.

Students or instructors should be able to inject:

```text
Crash Service

Add Latency

Disconnect

Drop Request

Drop Response

Drop Message

Duplicate Message

Delay Message

Reorder Messages

Database Failure

External Service Failure

Slow Consumer

Rate Limit

Timeout
```

Failures may target:

```text
internal service
external service
network link
message delivery
database operation
client request
```

---

# 17. Timeline and Debugging

Every important operation should be represented in a timeline.

Example:

```text
t=100   Customer → Orders: CreateOrder
t=105   Orders DB BEGIN
t=108   Order inserted
t=110   Orders DB COMMIT
t=115   OrderCreated published
t=130   OrderCreated → Payments
t=135   Payments → Processor: authorize
t=150   Processor: AUTHORIZED
t=151   Response dropped
t=2150  Payments performs status check
```

Students should be able to inspect:

- client action
- request
- message
- service
- external dependency
- database
- state before
- state after
- trace
- fault involved

---

# 18. Distributed Patterns

DistLab should support teaching patterns through problems rather than through named checkboxes.

Target concepts include:

```text
Retry
Timeout
Idempotency
Circuit Breaker
Saga
Compensation
Transactional Outbox
Inbox
Dead Letter Queue
Backpressure
CQRS
Eventual Consistency
Optimistic Concurrency
Distributed Lock
Cache Invalidation
Webhook Delivery
```

The problem should appear before the solution pattern.

---

# 19. Scenarios

An instructor can define a scenario containing:

- architecture
- initial state
- client actions
- external-service behavior
- failures
- configuration
- seed
- invariants

Example:

```yaml
name: processor-response-lost

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
      response: drop

expect:
  invariants:
    - order-not-charged-twice
```

---

# 20. Business Invariants

Assessment should focus on properties rather than implementation choices.

Examples:

```text
stock >= 0

capturedAmount(order) <= order.total

one active reservation per order

an order must not produce duplicate fulfillment

a cancelled order must eventually have no captured payment
```

Some invariants may involve external interactions:

```text
one external payment authorization per idempotency key
```

---

# 21. Assessment

DistLab should eventually support examination activities.

Example:

```text
Reliable Checkout

Requirements

• Services own independent state.
• A customer must not be charged twice.
• Inventory may temporarily fail.
• Payment Processor may return an ambiguous timeout.
• Messaging Provider may be unavailable.
• Distributed transactions are forbidden.
• The system must eventually reach a valid business state.
```

Automated scenarios may produce:

```text
Happy path                       PASS
Duplicate OrderCreated           FAIL
Inventory unavailable            PASS
Processor response lost          FAIL
Notification provider down       PASS
Crash after local commit         FAIL
```

Different solutions may pass if they preserve the required properties.

---

# 22. Product Principles

## Behavioral realism over infrastructure realism

Model the properties students need to reason about.

## Internal and external boundaries both matter

Failure does not stop at service-to-service communication.

External dependencies are part of distributed-system design.

## Determinism over uncontrolled randomness

Failures must be reproducible.

## Architecture over framework knowledge

DistLab teaches distributed systems rather than a particular framework.

## Visibility over hidden behavior

Important state transitions and interactions must be observable.

## Failure as normal behavior

Failures are part of distributed execution.

## Small educational primitives

Every model should implement only what supported scenarios require.

## Progressive complexity

Simple exercises should not require understanding every available component.

---

# 23. Non-Goals

DistLab is not initially intended to:

- emulate PostgreSQL
- emulate Redis
- emulate RabbitMQ
- emulate Kafka
- emulate Kubernetes
- emulate real payment networks
- emulate real shipping networks
- run production microservices
- execute arbitrary backend applications
- replace Docker Compose
- benchmark infrastructure
- reproduce real network stacks
- reproduce vendor-specific APIs

DistLab is a distributed-system simulator.

---

# 24. Browser-First

The initial product should execute entirely in the browser.

The implementation should favor:

- TypeScript
- serializable state
- deterministic algorithms
- local persistence when needed
- zero required external infrastructure

The browser should be sufficient to:

```text
Open exercise
      ↓
Run simulation
      ↓
Inject failure
      ↓
Inspect system
      ↓
Reset
```

---

# 25. Future Domains

The initial domain is digital commerce, but the simulator should not become structurally dependent on commerce terminology.

Future service catalogs might model:

- banking
- logistics
- healthcare
- IoT
- media processing
- identity platforms
- reservation systems

The simulation primitives should remain domain-independent.

---

# 26. Future Distributed-System Topics

DistLab may eventually extend beyond microservices into:

- replication
- leader/follower models
- partitioning
- consensus concepts
- distributed locks
- leases
- cache consistency
- load balancing
- backpressure
- stream processing
- service discovery

These should build on the same simulation kernel.

---

# 27. Definition of Success

DistLab succeeds if a student can inspect a distributed execution and answer:

- Who initiated this interaction?
- Which service received it?
- Which external dependency was involved?
- What happened?
- In what order?
- Which state changed?
- Which message was delivered?
- Was anything duplicated?
- Was a response lost?
- Where did the failure occur?
- What does each service actually know?
- Which business invariant was violated?
- Why did the system become inconsistent?
- How can the architecture recover?

The desired educational outcome is not:

> The student knows the definition of Saga.

It is:

> The student can recognize a distributed consistency problem, understand the available information at each boundary, and design a system that preserves its business invariants under failure.
