import type { LessonOverlayPolicy } from "./overlay.js";
import type { ScenarioDefinition } from "./scenario.js";

/**
 * Instructor scenario documents (docs/spec/adr/006-scenario-documents.md).
 * Shapes and constants only: parsing, envelope validation, and the hosted
 * catalog registry live in later packages. Diagnostics reuse
 * `ScenarioDiagnostic`; the policy reuses `LessonOverlayPolicy`.
 */

/** The constant `format` of every scenario document. */
export const SCENARIO_DOCUMENT_FORMAT = "distlab.scenario";

/** The exact `id` and `version` of a hosted catalog, for example `mvp.checkout@1.0.0`. */
export interface CatalogReference {
  readonly id: string;
  readonly version: string;
}

/** Plain-text copy. It never enters `RunInputs`. */
export interface ScenarioDocumentPresentation {
  readonly title: string;
  readonly summary?: string;
  /** Plain-text labels keyed by assertion ID. */
  readonly assertions?: Readonly<Record<string, string>>;
}

/**
 * Normalized form. As with ScenarioDefinition, an input may omit the
 * scenario's optional lists, startTime, and configuration.
 */
export interface ScenarioDocument {
  readonly format: typeof SCENARIO_DOCUMENT_FORMAT;
  readonly formatVersion: 1;
  readonly catalog: CatalogReference;
  readonly presentation: ScenarioDocumentPresentation;
  readonly scenario: ScenarioDefinition;
  readonly overlayPolicy?: LessonOverlayPolicy;
}

/** Where a session's scenario came from. `digest` is the document digest (ADR-006 "Deterministic identity"). */
export type SessionOrigin =
  | { readonly kind: "packaged" }
  | { readonly kind: "imported"; readonly digest: string; readonly catalog: CatalogReference };

/**
 * ADR-006 limits table. Checked before the scenario is validated; the main
 * thread, the worker, and tests share these values.
 */
export const ScenarioDocumentLimits = Object.freeze({
  /** Bytes of UTF-8 document text. */
  documentBytes: 262_144,
  nestingDepth: 32,
  components: 32,
  links: 128,
  actions: 2_000,
  faultRules: 64,
  assertions: 64,
  /** Maximum `scenario.configuration.historyLimit` (the packaged value). */
  historyLimit: 100_000,
  /** Characters of `presentation.title`. */
  titleLength: 120,
  /** Characters of `presentation.summary`. */
  summaryLength: 2_000,
  /** Characters of each `presentation.assertions` label. */
  assertionLabelLength: 200,
} as const);

/**
 * Document-specific diagnostic codes. Scenario codes keep their existing
 * names, and the envelope also uses `REQUIRED`, `TYPE`, `UNSUPPORTED`, and
 * `REFERENCE`.
 */
export const ScenarioDocumentDiagnosticCodes = Object.freeze({
  DOCUMENT_SIZE: "DOCUMENT_SIZE",
  DOCUMENT_SYNTAX: "DOCUMENT_SYNTAX",
  DOCUMENT_DEPTH: "DOCUMENT_DEPTH",
  DUPLICATE_KEY: "DUPLICATE_KEY",
  RESERVED_KEY: "RESERVED_KEY",
  FORMAT: "FORMAT",
  FORMAT_VERSION: "FORMAT_VERSION",
  UNKNOWN_CATALOG: "UNKNOWN_CATALOG",
  CATALOG_VERSION: "CATALOG_VERSION",
  DOCUMENT_LIMIT: "DOCUMENT_LIMIT",
  RESERVED_NAME: "RESERVED_NAME",
  RESERVED_ID: "RESERVED_ID",
  POLICY_TARGET: "POLICY_TARGET",
  POLICY_DEFAULT: "POLICY_DEFAULT",
  POLICY_ALLOWANCE: "POLICY_ALLOWANCE",
} as const);
