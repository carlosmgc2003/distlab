// This catalog module contains scenario data and lesson copy only, never model factories.
import type { ScenarioDefinition } from "@distlab/contracts";
import { detached } from "./protocol.ts";
import { checkoutLesson, normalCheckout, responseLostCheckout } from "../../../packages/catalogs/src/scenarios.ts";

import { commerceLessonNames, commerceScenario } from "../../../packages/catalogs/src/commerce/scenarios.ts";

export { checkoutLesson };

const commerceCopy = {
  "retry-unsafe": ["Retry without idempotency", "A timeout does not prove that a payment failed. Expect two payments after retry.", "retry-idempotent"],
  "retry-idempotent": ["Retry with idempotency", "The same lost response and retry produce one payment and the original result.", "retry-unsafe"],
  "saga-uncompensated": ["Saga: no compensation", "Shipment fails after reservation and payment. Inspect the inconsistent service states.", "saga-compensated"],
  "saga-compensated": ["Saga: compensate", "Observe refund → release inventory → cancel order, after independent commits.", "saga-uncompensated"],
  "dual-write": ["Dual write: lost event", "The payment survives a crash, but no downstream notification is created.", "outbox-unsafe-consumer"],
  "outbox-unsafe-consumer": ["Outbox: duplicate consumer effects", "The durable outbox recovers publication, but duplicate delivery creates two notifications.", "outbox-idempotent"],
  "outbox-idempotent": ["Outbox: idempotent consumer", "Two deliveries produce one notification: outbox and inbox solve different problems.", "outbox-unsafe-consumer"],
  "cqrs-delayed": ["CQRS: delayed read model", "At t=10 Orders is PAID while Reporting is PENDING. At t=60 both are PAID.", ""],
  "cascade-unprotected": ["Cascading failure: unprotected", "A slow risk provider causes 13 dependency timeouts and a peak of 10 waiting payment requests.", "cascade-breaker"],
  "cascade-breaker": ["Cascading failure: circuit breaker", "Follow CLOSED → OPEN → HALF_OPEN → CLOSED. Risk calls fall from 16 to 5; rejected calls are not successes.", "cascade-unprotected"],
} as const;

export const scenarios = [
  { id: "normal", family: "checkout", title: checkoutLesson.normal.title, description: checkoutLesson.normal.explanation, compare: "response-lost", scenario: detached(normalCheckout) },
  { id: "response-lost", family: "checkout", title: checkoutLesson["response-lost"].title, description: checkoutLesson["response-lost"].explanation, compare: "normal", scenario: detached(responseLostCheckout) },
  ...commerceLessonNames.map(id => ({ id, family: "commerce" as const, title: commerceCopy[id][0], description: commerceCopy[id][1], compare: commerceCopy[id][2], scenario: detached(commerceScenario(id)) })),
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
