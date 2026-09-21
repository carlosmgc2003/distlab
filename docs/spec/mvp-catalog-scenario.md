# MVP Catalog and Checkout Scenario Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-21 |
| Related issues | #3 |

## Responsibility

This specification fixes the versioned catalog and the reference faulted checkout
lesson for the first usable MVP. It is intentionally small: Customer App, Orders,
Payments, and Payment Processor only.

## Component models

All model versions are part of `RunInputs.modelVersions`.

| Component ID | Kind | Catalog model | Version | Owned state |
| --- | --- | --- | --- | --- |
| `customer-app` | client | `distlab.customer-app` | `1.0.0` | Current checkout request/outcome |
| `orders` | service | `distlab.orders` | `1.0.0` | `orders` DB tables: `orders`, `outbox` |
| `payments` | service | `distlab.payments` | `1.0.0` | `payments` DB tables: `payments`, `inbox` |
| `payment-processor` | external | `distlab.payment-processor` | `1.0.0` | Provider authorization ledger |

## Endpoints and messages

- Customer App action `checkout` sends `POST /orders` to `orders` with
  `{ cartId, customerId, amount }`.
- Orders endpoint `POST /orders` inserts one order with state `CREATED`, inserts
  an outbox row, commits, publishes `OrderCreated`, and replies
  `{ orderId, state: "CREATED" }`.
- MessageBus destination `OrderCreated` is a topic. Its message body is
  `{ orderId, customerId, amount }`. Payments is the only MVP subscriber.
- Payments handles `OrderCreated` once per message ID using its `inbox` table,
  inserts a payment with state `AUTHORIZING`, commits, then sends
  `POST /authorize` to `payment-processor` with `{ paymentId, orderId, amount }`.
- Payment Processor endpoint `POST /authorize` commits an authorization to its
  ledger before forming a response. With a normal response it returns
  `{ authorizationId, status: "APPROVED" }`.
- Payments marks the payment `AUTHORIZED` only after receiving the processor
  response. If the response times out, it records `UNKNOWN` and does not infer
  rollback or denial.

## Reference topology

```text
customer-app -> orders -> MessageBus(OrderCreated) -> payments -> payment-processor
```

Network links exist for `customer-app -> orders` and `payments ->
payment-processor`. The bus subscription is from `OrderCreated` to `payments`.
No Inventory, Fulfillment, Notifications, Reporting, Cart, Catalog, or alternate
provider is part of the MVP scenario.

## Response-lost checkout scenario

Scenario ID: `checkout-processor-response-lost@1`.

The following is the complete normalized fixture. Numbers used for times and
durations are validated as `SimulationTime`/`Duration` during normalization.
Actions at the same time are scheduled in listed order, so the two service
startup transitions occur before checkout.

```json
{
  "version": 1,
  "name": "checkout-processor-response-lost@1",
  "seed": "mvp-response-lost-001",
  "startTime": 0,
  "architecture": {
    "components": [
      { "id": "customer-app", "kind": "client", "model": "distlab.customer-app", "version": "1.0.0", "configuration": {} },
      { "id": "orders", "kind": "service", "model": "distlab.orders", "version": "1.0.0", "configuration": {} },
      { "id": "payments", "kind": "service", "model": "distlab.payments", "version": "1.0.0", "configuration": {} },
      { "id": "payment-processor", "kind": "external", "model": "distlab.payment-processor", "version": "1.0.0", "configuration": {} }
    ],
    "links": [
      { "source": "customer-app", "target": "orders", "policy": { "requestLatency": 0, "responseLatency": 0, "jitter": 0, "timeout": 1000, "failureRate": 0 } },
      { "source": "payments", "target": "payment-processor", "policy": { "requestLatency": 0, "responseLatency": 0, "jitter": 0, "timeout": 1000, "failureRate": 0 } }
    ],
    "databases": [
      { "owner": "orders", "tables": [{ "name": "orders", "unique": [["orderId"]], "checks": [] }, { "name": "outbox", "unique": [["messageId"]], "checks": [] }], "initial": { "orders": {}, "outbox": {} } },
      { "owner": "payments", "tables": [{ "name": "payments", "unique": [["paymentId"]], "checks": [] }, { "name": "inbox", "unique": [["messageId"]], "checks": [] }], "initial": { "payments": {}, "inbox": {} } }
    ],
    "stores": [],
    "destinations": [{ "id": "OrderCreated", "kind": "topic", "deliveryDelay": 0, "ackTimeout": 1000, "retryDelay": 0, "maxAttempts": 3, "capacity": 10000 }],
    "subscriptions": [{ "destination": "OrderCreated", "consumer": "payments" }]
  },
  "external": [{ "target": "payment-processor", "operation": "POST /authorize", "behavior": { "latency": 0, "degradedExtraLatency": 0, "dropResponse": false, "parameters": {} } }],
  "faults": [{ "id": "drop-first-processor-authorize-response", "point": "network.response", "source": "payment-processor", "target": "payments", "name": "POST /authorize", "from": 0, "probability": 1, "maxApplications": 1, "effect": { "kind": "drop" } }],
  "actions": [
    { "id": "start-orders", "at": 0, "kind": "service", "target": "orders", "state": "RUNNING" },
    { "id": "start-payments", "at": 0, "kind": "service", "target": "payments", "state": "RUNNING" },
    { "id": "checkout-cart-1", "at": 0, "kind": "client", "target": "customer-app", "action": "checkout", "data": { "cartId": "cart-1", "customerId": "customer-1", "amount": 5000 } }
  ],
  "assertions": [
    { "id": "order-created-once", "predicate": "mvp.order-created-once", "parameters": { "orderId": "order-1" }, "mode": "eventually", "deadline": 1001 },
    { "id": "order-created-published-once", "predicate": "mvp.order-created-published-once", "parameters": { "orderId": "order-1", "destination": "OrderCreated" }, "mode": "eventually", "deadline": 1001 },
    { "id": "processor-authorized-once", "predicate": "mvp.processor-authorized-once", "parameters": { "orderId": "order-1", "amount": 5000 }, "mode": "eventually", "deadline": 1001 },
    { "id": "payments-unknown-after-timeout", "predicate": "mvp.payments-unknown", "parameters": { "orderId": "order-1" }, "mode": "eventually", "deadline": 1001 },
    { "id": "disagreement-inspectable", "predicate": "mvp.authorization-disagreement-visible", "parameters": { "orderId": "order-1" }, "mode": "eventually", "deadline": 1001 },
    { "id": "reproducible-run", "predicate": "mvp.reproducible-run", "parameters": { "expectedRandomDrawCount": 0 }, "mode": "at", "at": 1001 }
  ],
  "configuration": { "startTime": 0, "historyLimit": 100000, "visibility": { "defaultMode": "visible", "byType": {}, "summaryFields": {} }, "models": {} }
}
```

The composition root adds `kernel.random: "xoshiro128ss-splitmix32-v1"` and the
four component model versions to `RunInputs.modelVersions`. This fixture uses no
probabilistic network behavior, so its expected random draw count is zero.
Orders allocates `order-1` and Payments allocates `payment-1` from their
per-service counters, both beginning at zero on construction/reset.

Required assertions:

1. An order is created exactly once.
2. `OrderCreated` is published exactly once to the `OrderCreated` destination.
3. The processor ledger contains exactly one approved authorization for the
   order amount.
4. Payments reaches `UNKNOWN` for the payment because the processor response was
   lost and the caller deadline elapsed.
5. The disagreement is inspectable: provider projection shows the authorization,
   while the Payments projection shows no confirmed authorization ID.
6. Re-running with the same inputs and seed produces the same observations,
   projections, random draw indexes, and assertion results.

The failure is not a failed checkout in the customer-facing Orders service. It is
an educational ambiguous-outcome run: external work committed, but the local
Payments service cannot prove it because the response was lost.

## Deferred catalog items

Catalog browsing, customer profiles, carts, inventory reservation, fulfillment,
notifications, reporting projections, retries, idempotency-key remediation,
multiple processors, and non-payment providers are deferred. Introducing any of
these requires a versioned catalog addition and must not alter the above scenario
silently.

## Acceptance coverage

- **MVP-CAT-AC-1:** The four component definitions, versions, endpoints,
  destination, owned tables/state transitions, and provider behavior are present
  in normalized inputs.
- **MVP-CAT-AC-2:** The first processor response is dropped by a recorded fault
  selector, not by UI mutation or hidden code.
- **MVP-CAT-AC-3:** The six reference assertions evaluate deterministically for
  equal architecture, scenario, configuration, model versions, and seed.

## References

- [Application Boundary](application-boundary.md)
- [Scenario Engine](scenario-engine.md)
- [Virtual Network](virtual-network.md)
- [Message Bus](message-bus.md)
- [External Service Runtime](external-service-runtime.md)
