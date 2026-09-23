// This catalog module contains scenario data and lesson copy only, never model factories.
import { checkoutLesson, normalCheckout, responseLostCheckout } from "../../../packages/catalogs/src/scenarios.ts";

export const scenarios = [
  { id: "normal", title: checkoutLesson.normal.title, scenario: normalCheckout },
  { id: "response-lost", title: checkoutLesson["response-lost"].title, scenario: responseLostCheckout },
] as const;
