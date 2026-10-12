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
| [`src/assessment.ts`](../../packages/catalogs/src/assessment.ts) | Six checkout predicates and `checkoutAssessment`. |
| [`src/scenarios.ts`](../../packages/catalogs/src/scenarios.ts) | Data-only checkout documents, document builder, and lesson copy. |
| [`src/commerce/index.ts`](../../packages/catalogs/src/commerce/index.ts) | Registers eleven commerce models, defines commerce assessment, and re-exports commerce scenario data. |
| [`src/commerce/common.ts`](../../packages/catalogs/src/commerce/common.ts) | Shared payload/reply/transaction helpers and the commerce client factory. |
| [`src/commerce/retry.ts`](../../packages/catalogs/src/commerce/retry.ts) | Payment model with optional durable request idempotency. |
| [`src/commerce/saga.ts`](../../packages/catalogs/src/commerce/saga.ts) | Saga coordinator, configurable resource service, and external carrier. |
| [`src/commerce/outbox.ts`](../../packages/catalogs/src/commerce/outbox.ts) | Payment/outbox producer, finite relay, and notification consumer. |
| [`src/commerce/cqrs.ts`](../../packages/catalogs/src/commerce/cqrs.ts) | Order write model and asynchronous reporting read model. |
| [`src/commerce/circuit.ts`](../../packages/catalogs/src/commerce/circuit.ts) | Dependency service with optional circuit breaker and external risk provider. |
| [`src/commerce/scenarios.ts`](../../packages/catalogs/src/commerce/scenarios.ts) | Data-only builder and names/type for ten commerce documents. |
| [`examples/commerce.ts`](../../packages/catalogs/examples/commerce.ts) | Headless CLI lesson runner with timeline, stepping, JSON export, and replay. |

The two `scenarios.ts` modules import only the `CanonicalValue` type from
`@distlab/contracts`. Their functions construct serializable inputs; they do not
instantiate models or run simulations. Main-thread browser code may import these
modules directly. The package root and `commerce/index.ts` also reach runtime
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
| `checkoutScenario(variant)` | Returns a `CanonicalValue` document for `"normal"` or `"response-lost"`. |
| `normalCheckout`, `responseLostCheckout` | Preconstructed checkout documents. |
| `checkoutLesson` | Read-only title and explanation strings indexed by checkout variant. |
| `commerceCatalog` | `ScenarioCatalog` with ID `commerce.lessons`, version `1.0.0`. |
| `commerceAssessment` | `ScenarioAssessment` with version `1.0.0`. |
| `commerceScenario(name)` | Returns a `CanonicalValue` document for a `CommerceLessonName`. |
| `commerceLessonNames` | Ordered tuple of the ten supported commerce names. |
| `CommerceLessonName` | Type-only union derived from that tuple. |

Both catalogs implement `find(name, version)` with an exact model-name/version
match and `versions(name)` with the available versions. An unknown model or
version resolves to `undefined`; an unknown name has an empty version list.
Every registered component model currently has version `1.0.0` and an empty
`checks` registry. The individual commerce model constants and helpers are not
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

All six predicates have version `1.0.0`. Both documents use the first three;
the normal document adds the authorized check, and the response-lost document
adds the unknown and disagreement checks. Their assertions use `eventually`
mode. Unknown predicate IDs resolve to `undefined`.

## Commerce models

`src/commerce/index.ts` registers the following eleven models. Repeated service
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
share workloads, fault schedules, and seeds, changing model configuration and
expected checks.

| Lesson name | Experiment and expected checks |
| --- | --- |
| `retry-unsafe` | Drop the first payment response, time out at 20 ms, and retry with the same key. Two payment rows exist at t=30. |
| `retry-idempotent` | Same loss and retry with durable previous-result lookup; one payment row exists at t=30. |
| `saga-uncompensated` | Drop the shipment request. At t=30 and t=60 the order needs compensation, inventory remains reserved, and payment remains unrefunded. |
| `saga-compensated` | Same shipment failure and visible inconsistency at t=30; by t=60 the order is cancelled, inventory released, and payment refunded. Compensation uses separate local transactions. |
| `dual-write` | Crash Payments at t=5 after its payment commit and before direct publication. The payment survives restart, but no outbox or notification exists at t=50. |
| `outbox-unsafe-consumer` | Same crash, durable outbox, restart at t=15/16, and relay request at t=17. One injected duplicate produces two notification rows by t=50; the outbox row is marked sent. |
| `outbox-idempotent` | Same durable relay and duplicate delivery; the consumer inbox leaves one notification row by t=50. |
| `cqrs-delayed` | Delay the first `OrderUpdated` delivery by 40 ms. At t=10 Orders is `PAID` and Reporting is `PENDING`; at t=60 both are `PAID`. Early and late client reads expose the difference. |
| `cascade-unprotected` | Delay Payments → Risk requests by 60 ms while the rule is active before t=60, beyond the 20 ms link timeout. Sixteen incoming checks cause 16 downstream calls, 13 failures, and peak active work of 10. |
| `cascade-breaker` | Same workload and delay with Payments' breaker enabled. At t=120 it is closed and drained: 5 downstream calls, 3 failures, 2 successes, 11 rejections, and peak active work of 3. |

The cascade assertions also verify API work has drained at t=120. The outbox
documents check the committed payment, pending outbox, and absent notifications
at t=6 before checking recovery. A PASS in an unsafe lesson means its expected
failure was observed; it is not a claim that the architecture is safe.

### Commerce assessment

`commerceAssessment.find` resolves only two version-`1.0.0` predicates:

- `commerce.rows` takes `owner`, `table`, `count`, `key`, and `expected`. It
  requires the exact table row count and compares each expected field against
  the selected row. Evidence contains the table rows. An empty `expected`
  object permits a count-only assertion.
- `commerce.metrics` takes `owner` and `expected`. It reads that owner's KV
  entry named `dependency`, compares each expected field by equality, and returns
  the metrics as evidence.

Commerce documents use `at` assertions at their declared virtual times. The
assessment component in `@distlab/scenario` owns scheduling, statuses, and
boundary evaluation; the catalog predicates only inspect projections.

## Headless example and verification

From the repository root with dependencies installed and Node.js 22.12+:

```sh
npm run lesson -- retry-unsafe
npm run lesson -- retry-idempotent --replay
npm run lesson -- saga-compensated --step
npm run --silent lesson -- outbox-idempotent --json
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

The [checkout tests](../../packages/catalogs/tests/checkout.test.ts) cover model
versions, both documents, authorization outcomes, commit/drop/timeout ordering,
and fresh/reset/step equivalence. The [commerce
tests](../../packages/catalogs/tests/commerce.test.ts) cover all ten documents,
paired inputs, compensation order, duplicate handling, CQRS convergence,
breaker load reduction, atomic payment/outbox commit rejection, and replay.

## Extending a catalog or lesson

1. For a new experiment with existing models, add a data-only document builder
   and an explicit name/variant. Keep behavior choices in recorded configuration,
   actions, and fault rules. Use finite assertion times/deadlines and explicit
   service startup actions; document the expected failure as well as recovery.
2. For new behavior, define a versioned `ScenarioModel` with accurate kind,
   actions, endpoints, consumers, operations, and checks, then register it in
   the appropriate catalog. Keep per-process mutable state inside `instantiate`
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
   the two packaged checkout documents and ten packaged commerce lessons.
   Keep factory imports in the worker and data-only imports on the main thread.
   Student projections expose business rows, KV metrics, client outcomes,
   declared external-visible facts, delivery records, and assertions; raw tasks
   and provider counters stay host-only. Read simulation counters directly as
   required by [ADR-003](../spec/adr/003-boundary-counters.md).

Changes to contract shapes or architectural guarantees require the corresponding
spec/design documentation updates. Catalogs remain a layer of the single DistLab
domain, using the [shared glossary](../glossary.md).
