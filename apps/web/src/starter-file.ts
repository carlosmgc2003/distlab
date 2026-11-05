import type { CanonicalValue, CatalogReference, LessonOverlayPolicy, ScenarioDocumentPresentation } from "@distlab/contracts";

/**
 * Starter scenario files (ADR-006 "Follow-up work" item 4). Pure: this module
 * builds a scenario document from a packaged lesson's data-only scenario,
 * catalog reference, overlay policy, and copy. It never parses, validates, or
 * runs a document; the worker validates the file when it is opened again.
 */

/** What a starter needs from a packaged lesson. `scenarios.ts` entries carry all of it. */
export interface StarterSource {
  readonly title: string;
  readonly description: string;
  readonly catalog: CatalogReference;
  readonly scenario: CanonicalValue;
  readonly policy: LessonOverlayPolicy;
  /** Commerce lessons label each packaged assertion; checkout lessons do not. */
  readonly checks?: readonly { readonly id: string; readonly label: string }[];
}

export interface StarterDocument {
  readonly format: "distlab.scenario";
  readonly formatVersion: 1;
  readonly catalog: CatalogReference;
  readonly presentation: ScenarioDocumentPresentation;
  readonly scenario: CanonicalValue;
  readonly overlayPolicy: LessonOverlayPolicy;
}

export interface StarterFile {
  readonly fileName: string;
  readonly text: string;
}

/**
 * A packaged name with `-copy` before its version (`retry-unsafe@1` becomes
 * `retry-unsafe-copy@1`), so an imported run never passes as the packaged
 * lesson (ADR-006 "Reserved names").
 */
export function starterName(packaged: string): string {
  const match = /^(.*)@(\d+)$/.exec(packaged);
  return match ? `${match[1]}-copy@${match[2]}` : `${packaged}-copy`;
}

function scenarioName(scenario: CanonicalValue): string {
  const name = scenario !== null && typeof scenario === "object" && !Array.isArray(scenario) ? (scenario as { readonly name?: unknown }).name : undefined;
  if (typeof name !== "string") throw new TypeError("A packaged scenario has a name");
  return name;
}

/**
 * The envelope around the unchanged packaged scenario under a new name. The
 * lesson's overlay policy comes along, renamed to govern the new scenario, so
 * an instructor starts with the same student choices the lesson offers.
 */
export function starterDocument(source: StarterSource): StarterDocument {
  const name = starterName(scenarioName(source.scenario));
  const labels = source.checks?.length ? { assertions: Object.fromEntries(source.checks.map(check => [check.id, check.label])) } : {};
  return {
    format: "distlab.scenario",
    formatVersion: 1,
    catalog: { id: source.catalog.id, version: source.catalog.version },
    presentation: { title: source.title, summary: source.description, ...labels },
    scenario: { ...(source.scenario as Readonly<Record<string, CanonicalValue>>), name },
    overlayPolicy: { ...source.policy, lesson: name },
  };
}

/** Pretty-printed JSON, named after the new scenario without its version: `retry-idempotent-copy.json`. */
export function starterFile(source: StarterSource): StarterFile {
  const document = starterDocument(source);
  const name = (document.scenario as { readonly name: string }).name;
  return { fileName: `${name.replace(/@\d+$/, "")}.json`, text: `${JSON.stringify(document, null, 2)}\n` };
}
