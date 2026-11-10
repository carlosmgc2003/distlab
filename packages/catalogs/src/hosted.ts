import type { CanonicalValue } from "@distlab/contracts";
import type { HostedCatalogRegistry } from "@distlab/scenario";
import { checkoutCatalog } from "./models.js";
import { checkoutAssessment } from "./assessment.js";
import { checkoutScenario } from "./scenarios.js";
import { commerceAssessment, commerceCatalog, commerceLessonNames, commerceScenario, reliableCheckoutName } from "./commerce/index.js";

const nameOf = (document: CanonicalValue) => (document as { readonly name: string }).name;

/**
 * The hosted catalog registry (ADR-006): each model catalog paired with the
 * assessment the worker uses with it, and the packaged scenario names an
 * imported document may not reuse. Worker and headless tools only; it reaches
 * runtime model factories, so the main thread never imports it.
 */
export const hostedCatalogs: HostedCatalogRegistry = Object.freeze({
  catalogs: Object.freeze([
    Object.freeze({ catalog: checkoutCatalog, assessment: checkoutAssessment }),
    Object.freeze({ catalog: commerceCatalog, assessment: commerceAssessment }),
  ]),
  reservedNames: Object.freeze([
    ...(["normal", "response-lost"] as const).map(variant => nameOf(checkoutScenario(variant))),
    ...commerceLessonNames.map(name => nameOf(commerceScenario(name))),
    // The assessment's base lesson (#97) is packaged too, though no Lesson chooser card lists it.
    reliableCheckoutName,
  ]),
});
