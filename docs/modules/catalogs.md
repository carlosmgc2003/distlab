# Catalogs module

`@distlab/catalogs` supplies versioned component models, assessment predicates,
and packaged scenario documents for developers and lesson authors. It sits above
`@distlab/contracts` and `@distlab/scenario`: the scenario engine resolves its
models and predicates, while the catalog owns the commerce behavior used in the
experiments. It does not implement the simulation kernel or browser controls.

The contracts and execution rules come from the [Scenario Engine
specification](../spec/scenario-engine.md), [MVP checkout
specification](../spec/mvp-catalog-scenario.md), and [runtime semantics
ADR](../spec/adr/002-runtime-model-semantics.md). The [commerce lesson
guide](../commerce-lessons.md) explains classroom comparisons in more detail.

## Source map and import boundaries

All paths in this table are relative to `packages/catalogs/`.

| Module | Responsibility |
| --- | --- |
| [`src/index.ts`](../../packages/catalogs/src/index.ts) | Public package barrel for checkout exports and the commerce barrel. |
| [`src/models.ts`](../../packages/catalogs/src/models.ts) | Four checkout runtime factories and `checkoutCatalog`. |
| [`src/descriptors.ts`](../../packages/catalogs/src/descriptors.ts) | Data-only model descriptors of the four checkout models. |
| [`src/peer.ts`](../../packages/catalogs/src/peer.ts) | Resolves a declared peer from component configuration or the descriptor default. |
| [`src/assessment.ts`](../../packages/catalogs/src/assessment.ts) | Six checkout predicates and `checkoutAssessment`. |
| [`src/scenarios.ts`](../../packages/catalogs/src/scenarios.ts) | Data-only checkout documents, document builder, and lesson copy. |
| [`src/commerce/index.ts`](../../packages/catalogs/src/commerce/index.ts) | Registers twenty-five commerce models, defines commerce assessment, and re-exports commerce scenario and Reliable Checkout data. |
| [`src/commerce/common.ts`](../../packages/catalogs/src/commerce/common.ts) | Shared payload/reply/transaction helpers and the commerce client factory. |
| [`src/commerce/retry.ts`](../../packages/catalogs/src/commerce/retry.ts) | Payment model with optional durable request idempotency. |
| [`src/commerce/saga.ts`](../../packages/catalogs/src/commerce/saga.ts) | Saga coordinator, configurable resource service, and external carrier. |
| [`src/commerce/outbox.ts`](../../packages/catalogs/src/commerce/outbox.ts) | Payment/outbox producer, finite relay, and notification consumer. |
| [`src/commerce/cqrs.ts`](../../packages/catalogs/src/commerce/cqrs.ts) | Order write model and asynchronous reporting read model. |
| [`src/commerce/circuit.ts`](../../packages/catalogs/src/commerce/circuit.ts) | Dependency service with optional circuit breaker and external risk provider. |
| [`src/commerce/notify.ts`](../../packages/catalogs/src/commerce/notify.ts) | Orders that confirms at checkout or after `NotificationSent`, a notification sender, and an external Messaging Provider. |
| [`src/commerce/cache.ts`](../../packages/catalogs/src/commerce/cache.ts) | Catalog with a cache-aside price cache and optional invalidation, a TTL cart, and Orders that records the price it used. |
| [`src/commerce/inventory.ts`](../../packages/catalogs/src/commerce/inventory.ts) | Inventory that reserves the last unit with check-then-act or with optimistic concurrency. |
| [`src/commerce/reliable.ts`](../../packages/catalogs/src/commerce/reliable.ts) | Reliable Checkout models: saga Orders with optional compensation and outbox, Inventory, Payments with optional retries and idempotency key, the Payment Processor, and Notifications with an optional inbox. |
| [`src/commerce/placeholder.ts`](../../packages/catalogs/src/commerce/placeholder.ts) | Placeholder service and external models that fill an empty design slot and answer `NOT_IMPLEMENTED`. |
| [`src/commerce/scenarios.ts`](../../packages/catalogs/src/commerce/scenarios.ts) | Data-only builder and names/type for seventeen commerce documents, their checks, and their overlay policies. |
| [`src/commerce/reliable-checkout.ts`](../../packages/catalogs/src/commerce/reliable-checkout.ts) | Data-only Reliable Checkout base document, its overlay policy and check classification, and the packaged assessment definition (`assessmentDefinitions`). |
| [`src/hosted.ts`](../../packages/catalogs/src/hosted.ts) | `hostedCatalogs`: the ADR-006 hosted catalog registry and the reserved packaged scenario names. Worker and headless tools only. |
| [`src/commerce/descriptors.ts`](../../packages/catalogs/src/commerce/descriptors.ts) | Data-only model descriptors of the twenty-five commerce models. |
| [`examples/commerce.ts`](../../packages/catalogs/examples/commerce.ts) | Headless CLI lesson runner with timeline, stepping, JSON export, and replay. |
| [`examples/scenario.ts`](../../packages/catalogs/examples/scenario.ts) | Headless `check` command for instructor scenario documents. |

The two `scenarios.ts` modules import only contract types from
`@distlab/contracts`. Their functions construct serializable inputs; they do not
instantiate models or run simulations. The two `descriptors.ts` modules import
only the `ModelDescriptor` type and export plain descriptor values. Main-thread
browser code may import these four modules directly. `commerce/reliable-checkout.ts`
is data-only in the same way; the browser does not import it until the assessment
view (#97) adds it to the boundary test's list. The package root and `commerce/index.ts` also reach runtime
factories and belong in the worker or headless composition path.

The [package manifest](../../packages/catalogs/package.json) declares only the
root export, `@distlab/catalogs`; it does not declare public subpath exports for
individual model or data modules. The browser's direct source imports are an
internal workspace boundary, enforced by the [boundary
tests](../../apps/web/tests/boundaries.test.ts). Runtime construction stays in
`apps/web/src/worker/`, as specified by the [Application
Boundary](../spec/application-boundary.md#packaged-scenario-hosting).

## Public exports and catalog lookup

| Export | Purpose |
| --- | --- |
| `checkoutCatalog` | `ScenarioCatalog` with ID `mvp.checkout`, version `1.0.0`. |
| `checkoutAssessment` | `ScenarioAssessment` with version `1.0.0`. |
| `checkoutCatalogV11`, `checkoutAssessmentV11` | `mvp.checkout@1.1.0`: the same models, with the `1.1.0` checkout assessment whose checks name their components (#148). |
| `checkoutScenario(variant)` | Returns a `CanonicalValue` document for `"normal"` or `"response-lost"`. |
| `normalCheckout`, `responseLostCheckout` | Preconstructed checkout documents. |
| `checkoutLesson` | Read-only title and explanation strings indexed by checkout variant. |
| `checkoutDescriptors`, `commerceDescriptors` | Data-only `ModelDescriptor` lists, one per registered model version. |
| `commerceCatalog` | `ScenarioCatalog` with ID `commerce.lessons`, version `1.0.0`. |
| `commerceAssessment` | `ScenarioAssessment` with version `1.0.0`. |
| `commerceScenario(name)` | Returns a `CanonicalValue` document for a `CommerceLessonName`. |
| `checkoutCatalogReference`, `commerceCatalogReference` | Data-only `CatalogReference` of each packaged lesson's hosted catalog, exported from the two `scenarios.ts` modules. |
| `hostedCatalogs` | `HostedCatalogRegistry` pairing `checkoutCatalog` with `checkoutAssessment` and `commerceCatalog` with `commerceAssessment`; its `reservedNames` are every packaged scenario name. |
| `commerceLessonNames` | Ordered tuple of the seventeen supported commerce names. |
| `CommerceLessonName` | Type-only union derived from that tuple. |

Both catalogs implement `find(name, version)` with an exact model-name/version
match and `versions(name)` with the available versions. An unknown model or
version resolves to `undefined`; an unknown name has an empty version list.
Every registered component model currently has version `1.0.0` and an empty
`checks` registry. Each catalog model is its data-only descriptor plus `checks`
and `instantiate` ([ADR-005](../spec/adr/005-architecture-editor.md#model-descriptors-and-peers)),
and the [descriptor tests](../../packages/catalogs/tests/descriptors.test.ts)
prove that each model equals its descriptor.

### Peers and options

A model never names the components it calls in code. Each outbound dependency is
a declared **peer**: the model reads the bound component ID from the
configuration field named after the peer and falls back to the descriptor
default. The defaults equal the IDs the packaged documents use, and those
documents omit the fields, so no packaged document or export changed.

| Model | Peer: kinds, calls, default | Options (boolean, default `false`) |
| --- | --- | --- |
| `distlab.customer-app` | `orders`: service, `POST /orders`, `orders` | — |
| `distlab.payments` | `processor`: external, `POST /authorize`, `payment-processor` | — |
| `commerce.saga` | `inventory` and `payments`: service, `POST /apply` and `POST /compensate`, same ID; `carrier`: external, `POST /ship`, `carrier` | `compensate` |
| `commerce.dependency` | `target`: service or external, `POST /check`, `risk` | `breaker` |
| `commerce.payment` | — | `idempotent` |
| `commerce.outbox-payment` | — | `outbox` |
| `commerce.notifications` | — | `idempotent` |

`commerce.client` declares no peers: each `request` action names its own target
and endpoint in the workload. `commerce.saga-resource` reads `forward` and
`compensated` rows from configuration; they are lesson data, not behavior
options, because no `LessonParameterDomain` describes a row. The individual commerce model constants and helpers are not
re-exported by the package root.

## Checkout models

`src/models.ts` defines these models for the shared four-component topology:

| Model | Kind and interface | Owned behavior/state |
| --- | --- | --- |
| `distlab.customer-app` | Client action `checkout` | Validates `cartId`, `customerId`, and a positive safe-integer `amount`; stores the request, calls Orders, and stores the reply body as its outcome. |
| `distlab.orders` | Service endpoint `POST /orders` | Allocates order/message IDs, commits a `CREATED` order and an outbox row together, then publishes `OrderCreated` and returns the order ID. |
| `distlab.payments` | Service consumer `OrderCreated` | Deduplicates by broker message ID in `inbox`; commits an `AUTHORIZING` payment before requesting authorization; commits the observed result afterward. |
| `distlab.payment-processor` | External operation `POST /authorize` | Appends an approved authorization to its ledger and declares the authorization list as externally visible state. |

Orders owns `orders` and `outbox` tables; Payments owns `payments` and `inbox`.
The checkout outbox records intent but has no relay or crash-recovery mechanism
in this model. Payments records `AUTHORIZED`, `APPROVED`, and the returned
authorization ID on success. A `NETWORK_TIMEOUT` instead produces `UNKNOWN`,
the timeout outcome, and a null authorization ID. Other errors propagate.
The processor commits its effect independently of response delivery, so a lost
response can leave an approved provider authorization beside an unknown local
payment. This follows the timeout semantics in
[ADR-002](../spec/adr/002-runtime-model-semantics.md).

### Checkout documents

Both documents start Orders and Payments at virtual time 0, then submit
`cart-1` for `customer-1` with amount 5000. They use the same architecture:
Customer App → Orders, the `OrderCreated` topic → Payments, and Payments →
Payment Processor. There are no KV stores.

| Variant | Document name | Seed | Fault and expected result |
| --- | --- | --- | --- |
| `normal` | `checkout-normal@1` | `mvp-normal-001` | No fault; Payments records `AUTHORIZED`. |
| `response-lost` | `checkout-processor-response-lost@1` | `mvp-response-lost-001` | One probability-1 `network.response` drop from processor to Payments for `POST /authorize`; provider authorization commits, then Payments records `UNKNOWN` after timeout. |

The current builder uses 20 ms request and response latency on the client link,
5 ms message delivery delay, 30 ms processor latency, and 1000 ms network
timeouts. Checkout assertions use finite 2000 ms deadlines. These are virtual
durations chosen to expose asynchronous boundaries.

The [MVP specification's JSON
fixture](../spec/mvp-catalog-scenario.md#response-lost-checkout-scenario) uses zero
latencies and a 1001 ms deadline. It also lists a `mvp.reproducible-run`
assertion that the current assessment does not register. This reference describes
the implementation's timing and predicate set; reproducibility is checked by
the catalog tests through fresh, reset, and stepped runs. The specification
remains the source of truth for contract names and intended guarantees.

### Checkout assessment

`src/assessment.ts` reads detached assessment projections: committed database
rows, stored observations, and the processor's declared visible authorizations.
Each predicate returns `pass` plus canonical evidence, without changing state.

| Predicate ID | Parameters | Passing condition |
| --- | --- | --- |
| `mvp.order-created-once` | `orderId` | Exactly one matching Orders row has state `CREATED`. |
| `mvp.order-created-published-once` | `orderId`, `destination` | Exactly one stored `message.published` observation matches the destination and order in the message body. |
| `mvp.processor-authorized-once` | `orderId`, `amount` | Exactly one visible provider authorization matches the order, amount, and `APPROVED` status. |
| `mvp.payments-unknown` | `orderId` | The payment has `UNKNOWN`/`NETWORK_TIMEOUT` and history contains exactly one timeout sourced from Payments. |
| `mvp.authorization-disagreement-visible` | `orderId` | One provider authorization exists while the local payment is `UNKNOWN` with a null authorization ID. |
| `mvp.payments-authorized` | `orderId` | The payment is `AUTHORIZED` with a string authorization ID. |

All six predicates have version `1.0.0` in `checkoutAssessment` and read the
packaged component IDs: `payment-processor`, `payments` (its database and the
timeout source), and `orders`. Both documents use the first three;
the normal document adds the authorized check, and the response-lost document
adds the unknown and disagreement checks. Their assertions use `eventually`
mode. Unknown predicate IDs resolve to `undefined`.

`checkoutAssessmentV11` (version `1.1.0`, hosted as `mvp.checkout@1.1.0`) has the
same six checks. Each also accepts optional `processor`, `payments`, and `orders`
parameters naming the components it judges, defaulting to the packaged IDs, so
an assertion without them gives the `1.0.0` status and evidence. A present ID
parameter that is not a non-empty string fails the check with evidence
`{ invalidParameters: [...] }`. Packaged lessons and starter files stay on
`1.0.0`; a scenario document that renames its components names `1.1.0` (#148).

## Commerce models

`src/commerce/index.ts` registers the following twenty-five models. Repeated service
instances share a model definition but receive fresh factory-created handlers.

| Source | Model | Interface and behavior |
| --- | --- | --- |
| `common.ts` | `commerce.client` | Client action `request`; one attempt by default, two when input `retry` is true. Records reply bodies by `label`; on timeout records `UNKNOWN`, and waits 1 virtual ms before a retry. |
| `retry.ts` | `commerce.payment` | Service `POST /pay`; commits a payment, optionally with a previous result keyed by `idempotencyKey` when configuration `idempotent` is true. A repeated key then returns the original result. |
| `saga.ts` | `commerce.saga` | Service `POST /checkout`; creates an order, applies Inventory and Payments operations, then requests shipment. A shipment timeout records `NEEDS_COMPENSATION`; configuration `compensate` enables delayed refund, release, and cancellation. |
| `saga.ts` | `commerce.saga-resource` | Service `POST /apply` and `POST /compensate`; saves configuration `forward` or `compensated` into its own `state` table at `order-1`. Used separately by Inventory and Payments. |
| `saga.ts` | `commerce.carrier` | External `POST /ship`; declares the shipped order ID as visible state and returns `SHIPPED`. The packaged saga fault prevents admission of the shipment request. |
| `outbox.ts` | `commerce.outbox-payment` | Service `POST /pay` commits a payment and, with configuration `outbox`, a pending outbox row in one transaction. `POST /relay` schedules one background relay tick to publish pending `PaymentApproved` events and then mark them sent. |
| `outbox.ts` | `commerce.notifications` | Service consumer `PaymentApproved`; inserts notification intent. Configuration `idempotent` commits an inbox entry with the notification and ignores duplicate business `eventId` values. |
| `cqrs.ts` | `commerce.order-write` | Service `POST /paid` commits `PAID`/version 1 and publishes `OrderUpdated`; `GET /order` returns its own order row. |
| `cqrs.ts` | `commerce.order-read` | Service `GET /order` and consumer `OrderUpdated`; updates a separate local order projection from the delivered event. |
| `circuit.ts` | `commerce.dependency` | Service `POST /check`; calls configuration `target` and records dependency metrics in KV. Configuration `breaker` enables the circuit policy. Used by API, Orders, and Payments. |
| `circuit.ts` | `commerce.risk` | External `POST /check`; returns `APPROVED`, with empty internal and visible state. |
| `notify.ts` | `commerce.notify-orders` | Service `POST /checkout` and consumer `NotificationSent`; commits the order and publishes `OrderPlaced`. Configuration `decoupled` commits `CONFIRMED` at checkout; otherwise the order stays `PENDING` until `NotificationSent` confirms it. |
| `notify.ts` | `commerce.notify-sender` | Service consumer `OrderPlaced`; sends through peer `provider` (default `messaging`), then commits a `SENT` row and publishes `NotificationSent`. It does not catch a send timeout, so the uncaught `NETWORK_TIMEOUT` NACKs the delivery and the destination's `maxAttempts` bounds the retries. A provider error reply (`EXTERNAL_UNAVAILABLE`, `EXTERNAL_RATE_LIMITED`) is logged as `notification.rejected` and its code rethrown, which NACKs the same way (#126). |
| `notify.ts` | `commerce.messaging-provider` | External `POST /send`; appends the order ID to its `sent` list, which is also its visible state, and returns `SENT`. |
| `cache.ts` | `commerce.cache-catalog` | Service `GET /price` and `POST /price`; owns tables `prices` and `price-history` and a KeyValueStore. A read returns the cached `price:<sku>` entry, or reads the database and caches it for configuration `ttl` (default 100). A change commits the current price and a history row with `validFrom` in one transaction. Configuration `invalidate` then deletes the cached key. |
| `cache.ts` | `commerce.cache-cart` | Service `POST /cart` and `GET /cart`; keeps `cart:<id>` in its KeyValueStore for configuration `ttl` (default 30) and records that deadline in the cart as `expiresAt`. A read of an expired cart returns `EXPIRED`. |
| `cache.ts` | `commerce.cache-orders` | Service `POST /checkout`; reads the cart through peer `cart` and the price through peer `catalog`. It commits a `REJECTED` row for an expired cart, or a `PLACED` row with the price, its version and source, the cart's `expiresAt`, and `checkedOutAt`. A timed-out or failed call returns `UNAVAILABLE` without a row. |
| `inventory.ts` | `commerce.inventory` | Service `POST /reserve`; owns tables `stock` and `reservations`. It reads the SKU's stock row and answers `OUT_OF_STOCK` when `stock` is below 1, waits 5 ms, then decrements `stock`, increments `version`, and inserts an `ACTIVE` reservation in one commit. Without configuration `optimistic`, the read is a closed snapshot and the write is a fresh transaction that decrements the stock it finds then. With `optimistic`, the read and the write share one transaction; on `TRANSACTION_CONFLICT` it re-reads once. |
| `reliable.ts` | `commerce.reliable-orders` | Service `POST /checkout` and `POST /relay`; owns tables `orders` and `outbox`; publishes `OrderConfirmed`. Commits the order `PENDING`, then calls peer `inventory` `POST /reserve` and peer `payments` `POST /authorize`. A step that times out or fails records `NEEDS_COMPENSATION`; configuration `compensate` instead undoes the attempted steps in reverse order (`POST /void`, then `POST /release`) and records `CANCELLED`. On success it commits `CONFIRMED`, waits 10 ms, and publishes; with configuration `outbox` the confirming commit records the event and only the relay publishes it. |
| `reliable.ts` | `commerce.reliable-inventory` | Service `POST /reserve` and `POST /release`; owns table `reservations`. Release of an order with no `RESERVED` row answers `NONE`. |
| `reliable.ts` | `commerce.reliable-payments` | Service `POST /authorize` and `POST /void`; owns table `payments`; calls peer `processor`. Configuration `idempotent` sends the order ID as `idempotencyKey`; configuration `retries` (0–3) repeats an authorization that timed out. After the last timeout it records `UNKNOWN` and rethrows `NETWORK_TIMEOUT`; a processor error reply is rethrown as its code. |
| `reliable.ts` | `commerce.reliable-processor` | External `POST /authorize` and `POST /void`. Its visible `authorizations` list records each authorization's order, key, and `APPROVED` or `VOIDED` status. A repeated idempotency key returns the existing authorization; `POST /void` voids an order's approved ones. |
| `reliable.ts` | `commerce.reliable-notifications` | Service consumer `OrderConfirmed`; owns tables `notifications` and `inbox`; sends through peer `provider` (default `messaging`). A provider error reply rethrows its code and a send timeout propagates, so either NACKs (#126). Configuration `idempotent` ignores an event ID already in the inbox. It acknowledges 5 ms after recording the send. |
| `placeholder.ts` | `commerce.placeholder-service` | Placeholder (ADR-005) for an empty service slot. Registers the endpoints listed in configuration `interface` (none when absent) and answers each with an error reply `{ code: "NOT_IMPLEMENTED" }`. Consumes, publishes, and stores nothing. |
| `placeholder.ts` | `commerce.placeholder-external` | Placeholder for an empty external slot. Exposes the operations listed in configuration `interface` and answers each with the same `NOT_IMPLEMENTED` error reply, without changing its empty state or visible state. |

`common.ts` also exports `record` and `text` validation helpers, `timeout` for
recognizing `NETWORK_TIMEOUT`, `ok` for successful replies, and generator helper
`save` for inserting/updating a row and yielding its local commit. These are
internal catalog utilities, not new runtime capabilities.

The outbox producer exposes a 10 ms gap after its payment commit. Without an
outbox it publishes directly after that gap; a crash abandons the continuation.
With an outbox, the explicit relay tick handles persisted intent after restart.
The notification consumer waits 5 virtual ms after commit so the injected copy
arrives while acknowledgement is pending. Publication and marking an outbox row
sent remain separate operations; the model does not promise exactly-once delivery.

The circuit breaker is a catalog policy over `VirtualNetwork`, not a new network
primitive. It opens after two consecutive failures, waits at least 30 virtual ms
before admitting a half-open probe, and allows one such probe at a time. A
successful probe closes it; a failed probe reopens it. Rejected calls return
`UNAVAILABLE` with reason `CIRCUIT_OPEN`; timeouts become `UNAVAILABLE` with reason
`TIMEOUT`. Metrics at KV key `dependency` include `state`, `calls`, `rejected`,
`failed`, `succeeded`, `active`, `peakActive`, and `totalWait`. This avoids database
transaction contention in the dependency experiment.

### Packaged commerce documents

Every document has version 1, name `<lesson>@1`, seed `commerce-classroom-1`,
start time 0, and explicit service startup actions. Configuration retains up to
100000 observations with default visible history. Builders declare topology,
owned resources, actions, faults, and assertions as data. Paired experiments
share workloads, fault schedules, and seeds, changing model configuration.

`commerceChecks(name)` classifies every packaged assertion, in document order,
as a **business invariant** or a **scenario expectation** with a student-facing
label (#96). Every lesson of a family states each invariant identically (same
ID, predicate, parameters, mode, and time), so PASS means HOLDS and FAIL means
VIOLATED whatever the design or design choice. Expectations confirm the setup
and may differ within a pair. Catalog tests check that every assertion is
classified and that each family shares its invariants.

| Lesson name | Experiment | Business invariants (VIOLATED in this lesson) |
| --- | --- | --- |
| `retry-unsafe` | Drop the first payment response, time out at 20 ms, and retry with the same key. The second payment row commits at t=22, and the run ends at t=23. | `one-payment-per-order` (violated) |
| `retry-idempotent` | Same loss and retry with durable previous-result lookup; one payment row exists when the run ends at t=23. | `one-payment-per-order` |
| `saga-uncompensated` | Drop the shipment request. At t=30 and t=60 the order needs compensation, inventory remains reserved, and payment remains unrefunded. | `failed-order-cancelled`, `failed-order-releases-inventory`, `failed-order-refunded` (all violated) |
| `saga-compensated` | Same shipment failure and visible inconsistency at t=30; by t=60 the order is cancelled, inventory released, and payment refunded. Compensation uses separate local transactions. | The same three |
| `dual-write` | Crash Payments at t=5 after its payment commit and before direct publication. The payment survives restart, but no outbox or notification exists at t=50. | `payment-survives-restart`, `one-notification-per-payment` (violated), `payment-event-published` (violated) |
| `outbox-unsafe-consumer` | Same crash, durable outbox, restart at t=15/16, and relay request at t=17. One injected duplicate produces two notification rows by t=50; the outbox row is marked sent. | The same three; `one-notification-per-payment` violated |
| `outbox-idempotent` | Same durable relay and duplicate delivery; the consumer inbox leaves one notification row by t=50. | The same three |
| `outbox-notifications-gap` | Same inputs as `outbox-idempotent`, but `notifications` is a placeholder slot with no database and no subscription. The relay publishes `PaymentApproved` and nothing receives it, so no notification row exists at t=50. The lesson's architecture allowance lets a student fill the slot with `commerce.notifications`, attach its database, and subscribe it ([ADR-005](../spec/adr/005-architecture-editor.md)). | The same three; `one-notification-per-payment` violated until the design fills the gap |
| `cqrs-delayed` | Delay the first `OrderUpdated` delivery by 40 ms. At t=10 Orders is `PAID` and Reporting is `PENDING`; at t=60 both are `PAID`. Early and late client reads expose the difference. | `write-remains-paid`, `read-converged` |
| `cascade-unprotected` | Delay Payments → Risk requests by 60 ms while the rule is active before t=60, beyond the 20 ms link timeout. Sixteen incoming checks cause 16 downstream calls, 13 failures, and peak active work of 10. | `bounded-waiting` (violated) |
| `cascade-breaker` | Same workload and delay with Payments' breaker enabled. At t=120 it is closed and drained: 5 downstream calls, 3 failures, 2 successes, 11 rejections, and peak active work of 3. | `bounded-waiting` |
| `notifications-unbounded` | Drop every Notifications → Messaging send before t=80, beyond the 10 ms link timeout. Orders waits for `NotificationSent`, and `OrderPlaced` allows 50 attempts. The sixth attempt succeeds at t=83, and the order is confirmed at t=85. | `order-confirmed-despite-notification-failure`, `failed-notification-dead-lettered`, `bounded-notification-retries` (all violated) |
| `notifications-dlq` | Same outage. Orders confirms at checkout, and `OrderPlaced` allows 3 attempts. The third NACK moves the message to DEAD at t=44, where it stays in the dead-letter queue. | The same three |
| `cache-stale-price` | No injected fault. The price read at t=1 is cached until t=101. The back office raises it from 1000 to 1200 at t=11, but checkout at t=25 is served the cached 1000. Both carts expire at t=31, so cart-2's checkout at t=43 is rejected. | `order-priced-at-checkout` (violated), `no-expired-cart-checkout` |
| `cache-invalidated` | Same workload. The price change deletes the cached key, so checkout misses the cache and charges 1200. | The same two |
| `inventory-oversell` | No injected fault. The Customer App and the Partner API (one more millisecond of request latency) reserve the last unit of sku-1 at t=0. Both checks read stock=1, and the separate writes commit at t=6 and t=7, leaving stock -1 and two ACTIVE reservations. | `stock-never-negative`, `one-reservation-per-unit` (both violated) |
| `inventory-optimistic` | Same workload. The partner's commit at t=7 is rejected with `TRANSACTION_CONFLICT`; it re-reads stock=0 and answers `OUT_OF_STOCK`. | The same two |

The remaining checks are scenario expectations: the saga state at t=30, the
outbox documents' committed payment, absent notification, and outbox row at
t=6, the CQRS reads at t=10, the cascade dependency and API metrics at
t=120, the empty Notifications table at t=60, and the cache lessons' raised
price at t=15 and rejected cart-2 checkout at t=60, and the inventory lessons'
unchanged last unit at t=3.

Business invariants come in two kinds (#163):

- A **safety invariant** forbids a state, so it uses `mode: "always"`: the
  predicate runs after initialization and after every event boundary, fails at
  the first boundary that violates it, and passes when the run completes. No
  design choice or student fault can move its violation past a check time.
  These are `one-payment-per-order` (at most one payment row),
  `bounded-waiting` (`peakActive` at most 3), `bounded-notification-retries`,
  `order-priced-at-checkout`, `no-expired-cart-checkout`,
  `stock-never-negative`, and `one-reservation-per-unit`. Their predicates
  hold before the first write.
- A **deadline invariant** requires a state to be reached, so it keeps
  `mode: "at"` with the time by which the lesson's design must have reached it:
  the three saga invariants (t=60), the three outbox invariants (t=50), the two
  CQRS invariants (t=60), and `order-confirmed-despite-notification-failure`
  (t=50) and `failed-notification-dead-lettered` (t=60). An `always` assertion
  cannot state them, because they are false until the design acts.

Scenario expectations keep `at`. A catalog test runs every lesson at each
combination of its parameters' domain edges, and with a delayed request on each
link, and checks that no invariant passes while its predicate is false on the
final state.

### Commerce assessment

`commerceAssessment.find` resolves only twelve version-`1.0.0` predicates:

- `commerce.rows` takes `owner`, `table`, `count`, `key`, and `expected`. It
  requires the exact table row count and compares each expected field against
  the selected row. Evidence contains the table rows. An empty `expected`
  object permits a count-only assertion. An owner without a database, such as
  an unfilled design slot, or a missing table has no rows. With a numeric
  `maximum` instead, it passes while the table has at most that many rows and
  ignores `count`, `key`, and `expected`; this form holds before the first
  commit, so an `always` assertion can use it.
- `commerce.metrics` takes `owner` and `expected`, `maximum`, or both. It
  reads that owner's KV entry named `dependency` and returns the metrics as
  evidence. Each `expected` field is compared by equality. Each `maximum` field
  must be a number at most the given bound; while the owner has no `dependency`
  entry, nothing has been measured and the bound holds.
- `commerce.attempts` takes `destination` and `maximum`. It passes when no
  routing record of that destination has an attempt above `maximum`. Evidence
  lists each record's message ID, state, and attempt.
- `commerce.dead-letters` takes `destination` and `attempts`. Every record that
  reached `attempts` without an ACK must be `DEAD` and listed among the bus's
  dead letters. Evidence lists those records and the dead-lettered message IDs.
- `commerce.pricing` takes `owner`, `table`, `catalog`, and `history`. Each
  `PLACED` order row must carry the price of the `catalog` owner's `history`
  row for its SKU with the latest `validFrom` at or before the order's
  `checkedOutAt`. Evidence lists each order's charged and valid price.
- `commerce.live-carts` takes `owner` and `table`. Each `PLACED` order row must
  have `checkedOutAt` before the `cartExpiresAt` of the cart it used. Evidence
  lists both times per order.
- `commerce.stock` takes `owner` and `table`. Every row's `stock` must be a
  number of at least 0. Evidence lists each SKU's stock and version.
- `commerce.reservations` takes `owner`, `stock`, and `reservations`. Each
  stock row's SKU may have at most `units` reservations with status `ACTIVE`.
  Evidence lists each SKU's units and active reservation IDs.
- `commerce.charges` takes `processor` and `maximum`. No order may hold more
  than `maximum` `APPROVED` authorizations in the processor's visible state.
  Evidence counts approved authorizations per order.
- `commerce.unconfirmed-charges` takes `processor`, `owner`, and `table`. Every
  `APPROVED` authorization must belong to an order whose row is `CONFIRMED`.
  Evidence lists each approved authorization with its order's status.
- `commerce.notifications` takes `provider`, `owner`, and `table`. No order may
  appear more than once in the provider's visible `sent` list, and every
  `CONFIRMED` order must appear exactly once. Evidence lists each order's status
  and send count.
- `commerce.final-orders` takes `owner`, `table`, and `states`. Every order row's
  status must be one of `states`. Evidence lists each order's status.

Commerce documents use `always` assertions for safety invariants and `at`
assertions, at their declared virtual times, for everything else. The
assessment component in `@distlab/scenario` owns scheduling, statuses, and
boundary evaluation; the catalog predicates only inspect projections.

### Reliable Checkout

`reliableCheckoutScenario` (`reliable-checkout@1`) is the fault-free base lesson
of the Reliable Checkout assessment ([Assessment](../spec/assessment.md), #97).
Its five design choices are declared in `reliableCheckoutOverlayPolicy`, every
assertion is a business invariant in `reliableCheckoutChecks`, and
`reliableCheckoutAssessment` holds the six suite rows. It is catalog only: it is
not one of the packaged lessons the worker accepts or the Lesson chooser lists
until the assessment view. `tests/reliable-checkout.test.ts` validates every
packaged definition (ASSESS-AC-2) and pins the expected-outcomes matrix
(ASSESS-AC-4).

## Headless example and verification

From the repository root with dependencies installed and Node.js 22.12+:

```sh
npm run lesson -- retry-unsafe
npm run lesson -- retry-idempotent --replay
npm run lesson -- saga-compensated --step
npm run --silent lesson -- outbox-idempotent --json
npm run lesson -- outbox-notifications-gap --replay
npm run scenario -- check examples/scenarios/processor-response-lost.json
npm test -w @distlab/catalogs
npm run test:boundaries
```

The root `lesson` script builds the packages and runs `examples/commerce.ts`.
That example creates a `DeterministicScenarioEngine` with the commerce catalog
and assessment, then opens a harness around the chosen document's session.
Normal output includes a filtered timeline of logs, faults, network/message
boundaries, database commits, and external commits, followed by final status,
time, state, results, and digest.

`--json` prints the full harness export, including history, without the textual
timeline. `--step` accepts Enter for one scheduler event, `run`, `state`, `reset`,
and `quit`. `--json` and `--step` cannot be combined. `--replay` works with either
mode: once a run is completed, it resets, runs again, and uses `compareExports`
to verify equivalence. Invalid names/flags set exit code 1; failed simulation or
FAIL results also set exit code 1, and replay mismatch throws.

The root `scenario` script builds the packages and runs `examples/scenario.ts`.
`check <file>` resolves the path from the directory where npm was invoked,
checks the file size before reading it, and validates the text against
`hostedCatalogs` with `validateScenarioDocument`. It prints each diagnostic as
`<path> <code>` and exits with code 1, or runs the scenario once and prints the
title, name, seed, catalog reference, digest, final status, `runId`, and each
assertion result with its presentation label. A failing assertion is the
document's finding and keeps exit code 0; a run that does not complete exits
with 1. [`examples/scenarios/processor-response-lost.json`](../../examples/scenarios/processor-response-lost.json)
is the vision §19 example from ADR-006 and a permanent fixture (DOC-AC-1).

The [document tests](../../packages/catalogs/tests/document.test.ts) cover that
fixture, every packaged lesson wrapped as a starter document (DOC-AC-2), digest
and `runId` identity across fresh runs, Reset, and reformatting (DOC-AC-3),
policy and allowance integrity at import (DOC-AC-6), versioning against the
hosted registry (DOC-AC-7), and the `check` command.

The [checkout tests](../../packages/catalogs/tests/checkout.test.ts) cover model
versions, both documents, authorization outcomes, commit/drop/timeout ordering,
and fresh/reset/step equivalence. The [commerce
tests](../../packages/catalogs/tests/commerce.test.ts) cover all seventeen documents,
paired inputs, compensation order, duplicate handling, CQRS convergence,
breaker load reduction, bounded and unbounded notification retries, stale and
invalidated cached prices with cart TTL expiry, concurrent reservations that
oversell or lose a commit conflict, atomic payment/outbox commit rejection, and replay.
The [design tests](../../packages/catalogs/tests/design.test.ts) cover the
placeholder models, the integrity of every architecture allowance (ARCH-AC-6),
and the gap lesson's empty, reference, and rejected designs.

## Extending a catalog or lesson

1. For a new experiment with existing models, add a data-only document builder
   and an explicit name/variant. Keep behavior choices in recorded configuration,
   actions, and fault rules. Use finite assertion times/deadlines and explicit
   service startup actions; document the expected failure as well as recovery.
2. For new behavior, add a data-only `ModelDescriptor` with accurate kind,
   actions, endpoints, consumers, operations, publications, peers, storage, and
   options to a `descriptors.ts` module. Build the `ScenarioModel` from it plus
   `checks` and `instantiate`, and register it in the appropriate catalog. Read
   every called component through `peer()`, never as a literal ID. Keep per-process mutable state inside `instantiate`
   so restarts/reset construct fresh handlers. Use the service-owned DB or KV
   for state that must survive a process crash.
3. Use shared types from `@distlab/contracts` and `@distlab/scenario`. Handlers
   use synchronous work or controlled generator operations, virtual time, and
   seeded randomness. Components communicate through modeled HTTP or messaging
   ports and access only their own storage; see
   [ADR-001](../spec/adr/001-deterministic-execution.md).
4. Add stable predicate IDs and versions when the existing checks do not express
   the property. Return canonical evidence from authorized projections without
   scheduling, mutation, or reconstructing redacted payloads. A history-based
   predicate needs the relevant stored fields to be visible to assessment.
5. Preserve existing versioned lesson behavior when adding models or documents.
   Validate new inputs and compare fresh, reset, and stepped exports. For paired
   lessons, also verify equal seeds, workloads, and fault schedules.
6. Browser support requires explicit host admission and student projection work;
   adding a catalog document alone does not authorize it. The host accepts only
   the two packaged checkout documents and seventeen packaged commerce lessons.
   Keep factory imports in the worker and data-only imports on the main thread.
   Student projections expose business rows, live KV entries with their expiry, client outcomes,
   declared external-visible facts, delivery records, and assertions; raw tasks
   and provider counters stay host-only. Read simulation counters directly as
   required by [ADR-003](../spec/adr/003-boundary-counters.md).

Changes to contract shapes or architectural guarantees require the corresponding
spec/design documentation updates. Catalogs remain a layer of the single DistLab
domain, using the [shared glossary](../glossary.md).
