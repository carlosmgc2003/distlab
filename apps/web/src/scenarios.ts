// This catalog module contains scenario data and lesson copy only, never model factories.
import type { AssessmentDefinition, LessonOverlayPolicy, ScenarioDefinition } from "@distlab/contracts";
import { detached } from "./protocol.ts";
import type { Messages } from "./i18n/catalog.ts";
import { checkLabel, contentText } from "./lesson-checks.ts";
import type { StarterSource } from "./starter-file.ts";
import { checkoutCatalogReference, checkoutLesson, checkoutOverlayPolicy, normalCheckout, responseLostCheckout } from "../../../packages/catalogs/src/scenarios.ts";

import { commerceCatalogReference, commerceChecks, commerceLessonNames, commerceOverlayPolicy, commerceScenario } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import type { CommerceLessonName } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { reliableCheckoutAssessment, reliableCheckoutChecks, reliableCheckoutOverlayPolicy, reliableCheckoutScenario } from "../../../packages/catalogs/src/commerce/reliable-checkout.ts";

export { checkoutLesson };

/**
 * Each commerce lesson's pair for the Compare button: the failing lesson beside its fix, or an empty string when it has none.
 * The title and description live in the `lessons` message area, by lesson name.
 */
const commercePairs = {
  "retry-unsafe": "retry-idempotent",
  "retry-idempotent": "retry-unsafe",
  "saga-uncompensated": "saga-compensated",
  "saga-compensated": "saga-uncompensated",
  "dual-write": "outbox-unsafe-consumer",
  "outbox-unsafe-consumer": "outbox-idempotent",
  "outbox-idempotent": "outbox-unsafe-consumer",
  "outbox-notifications-gap": "outbox-idempotent",
  "cqrs-delayed": "",
  "cascade-unprotected": "cascade-breaker",
  "cascade-breaker": "cascade-unprotected",
  "notifications-unbounded": "notifications-dlq",
  "notifications-dlq": "notifications-unbounded",
  "cache-stale-price": "cache-invalidated",
  "cache-invalidated": "cache-stale-price",
  "inventory-oversell": "inventory-optimistic",
  "lease-unfenced": "lease-fenced",
  "lease-fenced": "lease-unfenced",
  "clock-last-write-wins": "clock-lamport",
  "clock-lamport": "clock-last-write-wins",
  "inventory-optimistic": "inventory-oversell",
} as const satisfies Record<CommerceLessonName, string>;

/**
 * Overlay policies are the same data-only values the worker enforces from its own
 * catalog (ADR-004). The panel reads them to offer only allowed faults; the
 * worker never accepts a policy from the main thread. Each lesson names its hosted
 * catalog, so a starter scenario file can be built from this data alone (ADR-006).
 */
export const scenarios = [
  { id: "normal", family: "checkout", catalog: checkoutCatalogReference, compare: "response-lost", scenario: detached(normalCheckout), policy: checkoutOverlayPolicy("normal") as LessonOverlayPolicy },
  { id: "response-lost", family: "checkout", catalog: checkoutCatalogReference, compare: "normal", scenario: detached(responseLostCheckout), policy: checkoutOverlayPolicy("response-lost") as LessonOverlayPolicy },
  ...commerceLessonNames.map(id => ({ id, family: "commerce" as const, catalog: commerceCatalogReference, compare: commercePairs[id], scenario: detached(commerceScenario(id)), policy: commerceOverlayPolicy(id), checks: commerceChecks(id) })),
] as const;

export type PackagedScenario = (typeof scenarios)[number];

/** These imported, complete fixtures are validated by the worker before display.
 * The cast bridges the catalog's CanonicalValue serialization to the shared static type;
 * no untrusted scenario or runtime model is normalized on the main thread.
 */
export function packagedMetadata(choice: PackagedScenario): ScenarioDefinition {
  return choice.scenario as unknown as ScenarioDefinition;
}

/** A packaged lesson's title in the active language: the `lessons` area, or the checkout catalog's translation by lesson id. */
export function lessonTitle(choice: PackagedScenario, m: Messages): string {
  return choice.family === "commerce" ? m.lessons.commerce[choice.id].title : contentText(m.content.checkoutTitles, choice.id, checkoutLesson[choice.id].title);
}

/** A packaged lesson's description in the active language. */
export function lessonDescription(choice: PackagedScenario, m: Messages): string {
  return choice.family === "commerce" ? m.lessons.commerce[choice.id].description
    : contentText(m.content.checkoutExplanations, choice.id, checkoutLesson[choice.id].explanation);
}

/** Labels name the recorded fault input. They do not choose a hidden runtime branch. */
export function experimentLabel(choice: PackagedScenario, m: Messages): string {
  return choice.family === "commerce" ? lessonTitle(choice, m) : choice.id === "response-lost" ? m.lessons.experiment.responseLost : m.lessons.experiment.normal;
}

/** The checkout and commerce lessons' shorthand when only the experiment is meant (the lesson goal and the result heading). */
export function experimentShorthand(choice: PackagedScenario | null | undefined, m: Messages): string {
  return choice?.id === "response-lost" ? m.lessons.experiment.responseLost : m.lessons.experiment.normal;
}

/** The checks a packaged lesson labels, with their labels in the active language, keyed by assertion id. */
export function lessonCheckLabels(choice: PackagedScenario, m: Messages): Readonly<Record<string, string>> {
  return choice.family === "commerce" ? Object.fromEntries(choice.checks.map(check => [check.id, checkLabel(choice.id, check.id, check.label, m)])) : {};
}

/**
 * What a starter scenario file copies from a packaged lesson. The file is author content the instructor edits,
 * so it is written in the active language; the worker validates it as the document it is.
 */
export function starterSource(choice: PackagedScenario, m: Messages): StarterSource {
  const checks = choice.family === "commerce" ? choice.checks.map(check => ({ id: check.id, label: checkLabel(choice.id, check.id, check.label, m) })) : undefined;
  return { title: lessonTitle(choice, m), description: lessonDescription(choice, m), catalog: choice.catalog, scenario: choice.scenario, policy: choice.policy, ...(checks ? { checks } : {}) };
}

/**
 * Packaged assessments (#97, D-7): a definition and its base lesson's packaged
 * document, policy, and check labels, all data. The Lesson chooser lists them in
 * their own group. Running one sends ordinary loads of the base document.
 */
export const assessments = [
  { id: "reliable-checkout", definition: reliableCheckoutAssessment as AssessmentDefinition,
    scenario: detached(reliableCheckoutScenario), policy: reliableCheckoutOverlayPolicy as LessonOverlayPolicy, checks: reliableCheckoutChecks },
] as const;

export type PackagedAssessment = (typeof assessments)[number];

/** A packaged assessment's title in the active language, keyed by its definition id. */
export function assessmentTitle(choice: PackagedAssessment, m: Messages): string {
  return contentText(m.content.assessmentTitles, choice.definition.id, choice.definition.title);
}

/** A packaged assessment's chooser description, written in apps/web. */
export function assessmentDescription(_choice: PackagedAssessment, m: Messages): string {
  return m.lessons.assessmentDescription;
}

/** A packaged lesson's or assessment's text by id, for search and display: title, chooser label, and description. */
export function lessonCopy(id: string, m: Messages): { readonly title: string; readonly label: string; readonly description: string } {
  const assessment = assessments.find(item => item.id === id);
  if (assessment) return { title: assessmentTitle(assessment, m), label: assessmentTitle(assessment, m), description: assessmentDescription(assessment, m) };
  const lesson = scenarios.find(item => item.id === id);
  return lesson ? { title: lessonTitle(lesson, m), label: experimentLabel(lesson, m), description: lessonDescription(lesson, m) } : { title: "", label: "", description: "" };
}
