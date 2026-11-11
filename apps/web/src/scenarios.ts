// This catalog module contains scenario data and lesson copy only, never model factories.
import type { AssessmentDefinition, LessonOverlayPolicy, ScenarioDefinition } from "@distlab/contracts";
import { detached } from "./protocol.ts";
import { checkoutCatalogReference, checkoutLesson, checkoutOverlayPolicy, normalCheckout, responseLostCheckout } from "../../../packages/catalogs/src/scenarios.ts";

import { commerceCatalogReference, commerceChecks, commerceLessonNames, commerceOverlayPolicy, commerceScenario } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { reliableCheckoutAssessment, reliableCheckoutChecks, reliableCheckoutOverlayPolicy, reliableCheckoutScenario } from "../../../packages/catalogs/src/commerce/reliable-checkout.ts";

export { checkoutLesson };

const commerceCopy = {
  "retry-unsafe": ["Retry without idempotency", "A timeout does not prove that a payment failed. Expect two payments after retry.", "retry-idempotent"],
  "retry-idempotent": ["Retry with idempotency", "The same lost response and retry produce one payment and the original result.", "retry-unsafe"],
  "saga-uncompensated": ["Saga: no compensation", "Shipment fails after reservation and payment. Inspect the inconsistent service states.", "saga-compensated"],
  "saga-compensated": ["Saga: compensate", "Observe refund → release inventory → cancel order, after independent commits.", "saga-uncompensated"],
  "dual-write": ["Dual write: lost event", "The payment survives a crash, but no downstream notification is created.", "outbox-unsafe-consumer"],
  "outbox-unsafe-consumer": ["Outbox: duplicate consumer effects", "The durable outbox recovers publication, but duplicate delivery creates two notifications.", "outbox-idempotent"],
  "outbox-idempotent": ["Outbox: idempotent consumer", "Two deliveries produce one notification: outbox and inbox solve different problems.", "outbox-unsafe-consumer"],
  "outbox-notifications-gap": ["Outbox: design the notifications consumer", "Payments' outbox publishes PaymentApproved, but Notifications is an empty slot: nothing receives the event, so no notification is created. Fill the slot, give it a database, and subscribe it.", "outbox-idempotent"],
  "cqrs-delayed": ["CQRS: delayed read model", "At t=10 Orders is PAID while Reporting is PENDING. At t=60 both are PAID.", ""],
  "cascade-unprotected": ["Cascading failure: unprotected", "A slow risk provider causes 13 dependency timeouts and a peak of 10 waiting payment requests.", "cascade-breaker"],
  "cascade-breaker": ["Cascading failure: circuit breaker", "Follow CLOSED → OPEN → HALF_OPEN → CLOSED. Risk calls fall from 16 to 5; rejected calls are not successes.", "cascade-unprotected"],
  "notifications-unbounded": ["Notifications: retry until it works", "The Messaging Provider is unreachable until t=80. Orders waits for the notification, so the order stays PENDING while the send is retried 6 times.", "notifications-dlq"],
  "notifications-dlq": ["Notifications: bounded retry and dead-letter queue", "The order is confirmed at checkout. After 3 failed attempts the notification goes to the dead-letter queue for inspection.", "notifications-unbounded"],
  "cache-stale-price": ["Cache: stale price after a price change", "The back office raises the price at t=10, but Catalog serves the price it cached at t=1 until t=101, so the order placed at t=25 is charged the old price. Cart cart-2 expires at t=31.", "cache-invalidated"],
  "cache-invalidated": ["Cache: invalidate on price change", "The price change deletes the cached price, so checkout reads the new price from the database. The expired cart is still rejected.", "cache-stale-price"],
  "inventory-oversell": ["Inventory: oversell the last unit", "The Customer App and the Partner API both reserve the last unit at t=0. Both checks read stock=1 before either write, and each write is a separate transaction, so both commit and stock ends at -1.", "inventory-optimistic"],
  "lease-unfenced": ["Leases: a stale writer after expiry", "Two report workers take a 10 ms lease in a shared key-value store: a set-if-absent that expires, then an increment for the token. Worker-1's write is held up past its lease, worker-2 takes the lease with token 2 and writes, then worker-1's late write overwrites it.", "lease-fenced"],
  "lease-fenced": ["Leases: fencing tokens", "The same delayed write, but storage remembers the largest lease token it has accepted and rejects worker-1's token 1 after worker-2's token 2.", "lease-unfenced"],
  "clock-last-write-wins": ["Clocks: last write wins with a skewed clock", "Two regions replicate a document title by last-writer-wins. Region eu's clock runs 25 ms ahead, so the editor in us reads Draft, saves Final, sees SAVED, and Final is silently discarded.", "clock-lamport"],
  "clock-lamport": ["Clocks: Lamport timestamps", "The same edits, stamped with Lamport clocks. The edit made after reading Draft gets the larger stamp, so both regions keep Final whatever the wall clocks say.", "clock-last-write-wins"],
  "inventory-optimistic": ["Inventory: optimistic concurrency", "The same race, but the check and the write share one transaction. The partner's commit fails the version check at t=7, Inventory re-reads stock=0, and the partner gets OUT_OF_STOCK.", "inventory-oversell"],
} as const;

/**
 * Overlay policies are the same data-only values the worker enforces from its own
 * catalog (ADR-004). The panel reads them to offer only allowed faults; the
 * worker never accepts a policy from the main thread. Each lesson names its hosted
 * catalog, so a starter scenario file can be built from this data alone (ADR-006).
 */
export const scenarios = [
  { id: "normal", family: "checkout", catalog: checkoutCatalogReference, title: checkoutLesson.normal.title, description: checkoutLesson.normal.explanation, compare: "response-lost", scenario: detached(normalCheckout), policy: checkoutOverlayPolicy("normal") as LessonOverlayPolicy },
  { id: "response-lost", family: "checkout", catalog: checkoutCatalogReference, title: checkoutLesson["response-lost"].title, description: checkoutLesson["response-lost"].explanation, compare: "normal", scenario: detached(responseLostCheckout), policy: checkoutOverlayPolicy("response-lost") as LessonOverlayPolicy },
  ...commerceLessonNames.map(id => ({ id, family: "commerce" as const, catalog: commerceCatalogReference, title: commerceCopy[id][0], description: commerceCopy[id][1], compare: commerceCopy[id][2], scenario: detached(commerceScenario(id)), policy: commerceOverlayPolicy(id), checks: commerceChecks(id) })),
] as const;

export type PackagedScenario = (typeof scenarios)[number];

/** These imported, complete fixtures are validated by the worker before display.
 * The cast bridges the catalog's CanonicalValue serialization to the shared static type;
 * no untrusted scenario or runtime model is normalized on the main thread.
 */
export function packagedMetadata(choice: PackagedScenario): ScenarioDefinition {
  return choice.scenario as unknown as ScenarioDefinition;
}

/** Labels name the recorded fault input. They do not choose a hidden runtime branch. */
export function experimentLabel(choice: PackagedScenario): string {
  return choice.family === "commerce" ? choice.title : choice.id === "response-lost" ? "Lost processor response" : "Normal checkout";
}

/**
 * Packaged assessments (#97, D-7): a definition and its base lesson's packaged
 * document, policy, and check labels, all data. The Lesson chooser lists them in
 * their own group. Running one sends ordinary loads of the base document.
 */
export const assessments = [
  { id: "reliable-checkout", title: reliableCheckoutAssessment.title, definition: reliableCheckoutAssessment as AssessmentDefinition,
    description: "Run one design of your own against six fault scenarios. A scenario passes when every business invariant holds.",
    scenario: detached(reliableCheckoutScenario), policy: reliableCheckoutOverlayPolicy as LessonOverlayPolicy, checks: reliableCheckoutChecks },
] as const;

export type PackagedAssessment = (typeof assessments)[number];
