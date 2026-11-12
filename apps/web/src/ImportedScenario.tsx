import type { CanonicalValue, RuntimeProjectionSet, ScenarioDiagnostic, ScenarioDocument, SessionOrigin } from "@distlab/contracts";
import { CheckItem } from "./CommerceLesson.tsx";
import { importedChecks } from "./lesson-checks.ts";
import { useMessages } from "./i18n/react.tsx";
import { catalogLabel, diagnosticPath, explainDiagnostic, shortId } from "./scenario-file.ts";

/**
 * Imported scenario documents in the browser (ADR-006 "How imported documents
 * differ in the UI"). Every string from the document is rendered as a React
 * text node: never as HTML or Markdown, and links in it are never followed.
 */

/** The run header: an "Imported" label in text, then the document's identity and the run's. */
export function ImportedHeader({ document, origin, runId }: {
  readonly document: ScenarioDocument;
  readonly origin: SessionOrigin | undefined;
  readonly runId: string | undefined;
}) {
  const digest = origin?.kind === "imported" ? origin.digest : undefined;
  return <div className="imported-header">
    <p className="imported-identity" aria-label="Imported scenario">
      <span className="origin-label">Imported</span>
      {" · "}<strong>{document.presentation.title}</strong>
      {" · "}{document.scenario.name}
      {" · seed "}{document.scenario.seed}
      {" · "}{catalogLabel(document.catalog)}
      {digest ? <>{" · digest "}<span title={digest}>{shortId(digest)}</span></> : null}
      {runId ? <>{" · run "}{shortId(runId)}</> : null}
    </p>
    {document.presentation.summary ? <p className="imported-summary">{document.presentation.summary}</p> : null}
    <p className="authorship-note">The checks in this scenario were written by the file’s author and judged by DistLab catalog predicates.</p>
  </div>;
}

function verdicts(projection: RuntimeProjectionSet): CanonicalValue | undefined {
  // Stored verdicts travel on the client projection, for checkout and commerce catalogs alike.
  for (const entry of projection.components) {
    const state = entry.state;
    if (entry.visibility !== "student" || state === null || typeof state !== "object" || Array.isArray(state)) continue;
    const assertions = (state as Readonly<Record<string, CanonicalValue>>).assertions;
    if (Array.isArray(assertions)) return assertions;
  }
  return undefined;
}

/**
 * The document's checks with their stored verdicts. A FAIL is a finding about the
 * scenario's design, not a broken simulator, so it reads like any other verdict.
 */
export function ImportedChecks({ projection, document, onShowEvidence }: {
  readonly projection: RuntimeProjectionSet;
  readonly document: ScenarioDocument;
  readonly onShowEvidence: (observationId: string) => void;
}) {
  const rows = importedChecks(verdicts(projection), document.presentation.assertions, projection.history.observations);
  return <section className="lesson-checks imported-checks" aria-labelledby="imported-checks-heading">
    <h3 id="imported-checks-heading">Checks in this scenario</h3>
    {rows.length ? <ul aria-label="Scenario checks">{rows.map(row => <CheckItem key={row.id} row={row} onShowEvidence={onShowEvidence} />)}</ul>
      : <p>This scenario declares no checks.</p>}
  </section>;
}

/** A failed import: each diagnostic with its document path and a plain explanation of its code. */
export function DocumentDiagnostics({ fileName, diagnostics, loaded }: {
  readonly fileName: string;
  readonly diagnostics: readonly ScenarioDiagnostic[];
  /** True when the rejection left the previous session loaded, as an oversized file does. */
  readonly loaded: boolean;
}) {
  const m = useMessages();
  return <section className="document-diagnostics" aria-labelledby="document-diagnostics-heading">
    <h2 id="document-diagnostics-heading">The scenario file was not loaded</h2>
    <p><span className="file-name">{fileName}</span> has {diagnostics.length} problem{diagnostics.length === 1 ? "" : "s"}.
      {loaded ? " The current session is unchanged." : " No session is loaded."} Fix the file, then open it again.</p>
    <ul aria-label="Scenario file problems">{diagnostics.map((item, index) => <li key={`${item.path}:${item.code}:${index}`}>
      <code>{diagnosticPath(item.path, m)}</code> <code>{item.code}</code> — {explainDiagnostic(item.code, m)}
    </li>)}</ul>
  </section>;
}
