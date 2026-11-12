import { ScenarioDocumentLimits } from "@distlab/contracts";
import type { CatalogReference, ScenarioDiagnostic } from "@distlab/contracts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";

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

/**
 * Plain explanations keyed by diagnostic code, from the `imported` message area. The worker's paths say where;
 * these say what. Code-like tokens inside a message (`__proto__`, `"distlab.scenario"`, `configuration.startTime`)
 * stay literal in every language.
 */
export function explainDiagnostic(code: string, m: Messages): string {
  if (code === "DOCUMENT_SIZE") return m.imported.documentSize(ScenarioDocumentLimits.documentBytes);
  if (code === "DOCUMENT_DEPTH") return m.imported.documentDepth(ScenarioDocumentLimits.nestingDepth);
  return byCode<string>(m.imported.diagnostics, code) ?? m.imported.unknownDiagnostic;
}

/** A JSON pointer, or a name for the whole document when the path is empty. */
export function diagnosticPath(path: string, m: Messages): string {
  return path === "" ? m.imported.wholeDocument : path;
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
