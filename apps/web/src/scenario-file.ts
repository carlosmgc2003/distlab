import { ScenarioDocumentLimits } from "@distlab/contracts";
import type { CatalogReference, ScenarioDiagnostic } from "@distlab/contracts";

/**
 * Imported scenario files on the main thread (ADR-006 "Import path"). Pure:
 * this module checks a file's byte size before it is read and explains the
 * worker's diagnostics. It never parses, validates, or interprets document
 * text; the text goes to the worker exactly as read.
 */

/** A file the student chose, kept in UI state so a failed import can be retried or replaced. */
export interface ScenarioFile {
  readonly name: string;
  readonly text: string;
}

/**
 * ADR-006 step 1: a file larger than the document limit is not read. `size`
 * is `File.size`, the byte length of the file, which bounds its UTF-8 text.
 */
export function oversized(size: number): readonly ScenarioDiagnostic[] {
  return size > ScenarioDocumentLimits.documentBytes ? [{ path: "", code: "DOCUMENT_SIZE" }] : [];
}

/** Plain explanations keyed by diagnostic code. The worker's paths say where; these say what. */
const explanations: Readonly<Record<string, string>> = {
  // Document codes (ADR-006).
  DOCUMENT_SIZE: `The file is larger than ${ScenarioDocumentLimits.documentBytes.toLocaleString("en-US")} bytes, so it was not read.`,
  DOCUMENT_SYNTAX: "The file is not valid JSON.",
  DOCUMENT_DEPTH: `The JSON nests deeper than ${ScenarioDocumentLimits.nestingDepth} levels.`,
  DUPLICATE_KEY: "This key appears twice in the same object.",
  RESERVED_KEY: "The key __proto__ is not allowed.",
  FORMAT: "This is not a DistLab scenario document: format must be \"distlab.scenario\".",
  FORMAT_VERSION: "This version of DistLab cannot read this document version.",
  UNKNOWN_CATALOG: "DistLab does not host a catalog with this ID.",
  CATALOG_VERSION: "DistLab hosts this catalog, but not this version of it.",
  DOCUMENT_LIMIT: "This value is longer or larger than a scenario document allows.",
  RESERVED_NAME: "A packaged lesson already uses this scenario name. Choose another name.",
  RESERVED_ID: "IDs that start with student- are reserved for student changes.",
  POLICY_TARGET: "This overlay policy target does not name exactly one value in the scenario, or another parameter already targets it.",
  POLICY_DEFAULT: "This default is outside its domain, or differs from the scenario's value at its target.",
  POLICY_ALLOWANCE: "This architecture allowance names something the scenario or catalog cannot provide.",
  // Shared envelope and scenario codes.
  CANONICAL: "This value is not plain JSON data.",
  REQUIRED: "A required value is missing.",
  TYPE: "This value has the wrong type.",
  UNSUPPORTED: "This key or value is not supported here.",
  DUPLICATE: "This ID or key is used more than once.",
  REFERENCE: "This names something that does not exist.",
  UNKNOWN_COMPONENT: "No component in the architecture has this ID.",
  UNKNOWN_MODEL: "The referenced catalog has no model with this name and version.",
  VERSION: "This version is not supported.",
  KIND: "This kind does not match the model or the component.",
  OWNERSHIP: "Only an internal service can own this resource.",
  UNKNOWN_PREDICATE: "The referenced catalog has no predicate with this ID.",
  TIME: "This time is not a valid virtual time.",
  ASSERTION_TIMING: "This assertion's mode and deadline do not fit together.",
  SEED: "The seed must be a non-empty string.",
  BEFORE_START: "This happens before the scenario's start time.",
  UNKNOWN_ACTION: "The target's model has no action with this name.",
  UNKNOWN_OPERATION: "The target's model has no operation with this name.",
  LINK: "No link connects these components, or the same link is declared twice.",
  SUBSCRIPTION: "This subscription does not fit its consumer, or a consumer lacks a subscription its model needs.",
  FAULT: "This fault rule is not valid for its point or effect.",
  START_TIME_MISMATCH: "The start time and configuration.startTime disagree.",
  STATE: "The target does not accept this state.",
  CONSTRAINT: "This initial row breaks its table's constraints.",
  PEER: "This peer is not bound to a component of a kind the model can call.",
  INTERFACE: "The bound component does not offer the interface this model needs.",
  PUBLISH: "This model publishes to a destination the architecture does not declare.",
  STORAGE: "This model needs a database or store that the component does not own.",
};

export function explainDiagnostic(code: string): string {
  return explanations[code] ?? "The scenario engine rejected this value.";
}

/** A JSON pointer, or a name for the whole document when the path is empty. */
export function diagnosticPath(path: string): string {
  return path === "" ? "(whole document)" : path;
}

/** Reads the diagnostics an `INVALID_DOCUMENT` or `INVALID_OVERLAY` error carries in its context. */
export function errorDiagnostics(context: unknown): readonly ScenarioDiagnostic[] | null {
  const diagnostics = context !== null && typeof context === "object" && !Array.isArray(context) ? (context as { readonly diagnostics?: unknown }).diagnostics : undefined;
  return Array.isArray(diagnostics) && diagnostics.every(item => item !== null && typeof item === "object" && typeof item.path === "string" && typeof item.code === "string")
    ? diagnostics as ScenarioDiagnostic[] : null;
}

export function catalogLabel(reference: CatalogReference): string {
  return `${reference.id}@${reference.version}`;
}

/** The first eight hex digits of a document digest or run ID, as the run header shows them. */
export function shortId(value: string): string {
  return value.replace(/^run:/, "").slice(0, 8);
}
