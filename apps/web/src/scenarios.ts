// This catalog module contains scenario data and lesson copy only, never model factories.
import type { ScenarioDefinition } from "@distlab/contracts";
import { detached } from "./protocol.ts";
import { checkoutLesson, normalCheckout, responseLostCheckout } from "../../../packages/catalogs/src/scenarios.ts";

export const scenarios = [
  { id: "normal", title: checkoutLesson.normal.title, scenario: detached(normalCheckout) },
  { id: "response-lost", title: checkoutLesson["response-lost"].title, scenario: detached(responseLostCheckout) },
] as const;

export type PackagedScenario = (typeof scenarios)[number];

/** These imported, complete fixtures are validated by the worker before display.
 * The cast bridges the catalog's CanonicalValue serialization to the shared static type;
 * no untrusted scenario or runtime model is normalized on the main thread.
 */
export function packagedMetadata(choice: PackagedScenario): ScenarioDefinition {
  return choice.scenario as unknown as ScenarioDefinition;
}
