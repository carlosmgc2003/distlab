import type { CanonicalValue, RuntimeProjectionSet, ScenarioDiagnostic, ScenarioDocument, SessionOrigin } from "@distlab/contracts";
import { CheckItem } from "./CommerceLesson.tsx";
import { importedChecks } from "./lesson-checks.ts";
import { useMessages } from "./i18n/react.tsx";
import { Rich } from "./i18n/rich.tsx";
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
  const m = useMessages();
  const h = m.imported.header;
  const sep = m.imported.factSeparator;
  const digest = origin?.kind === "imported" ? origin.digest : undefined;
  return <div className="imported-header">
    <p className="imported-identity" aria-label={h.label}>
      <span className="origin-label">{h.imported}</span>
      {sep}<strong>{document.presentation.title}</strong>
      {sep}{document.scenario.name}
      {sep}{h.seed(document.scenario.seed)}
      {sep}{catalogLabel(document.catalog)}
      {digest ? <>{sep}<Rich text={h.digest} values={{ digest: <span title={digest}>{shortId(digest)}</span> }} /></> : null}
      {runId ? <>{sep}{h.run(shortId(runId))}</> : null}
    </p>
    {document.presentation.summary ? <p className="imported-summary">{document.presentation.summary}</p> : null}
    <p className="authorship-note">{h.authorship}</p>
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
  const m = useMessages();
  const rows = importedChecks(verdicts(projection), document.presentation.assertions, projection.history.observations);
  return <section className="lesson-checks imported-checks" aria-labelledby="imported-checks-heading">
    <h3 id="imported-checks-heading">{m.imported.checksHeading}</h3>
    {rows.length ? <ul aria-label={m.imported.checksList}>{rows.map(row => <CheckItem key={row.id} row={row} onShowEvidence={onShowEvidence} />)}</ul>
      : <p>{m.imported.noChecks}</p>}
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
    <h2 id="document-diagnostics-heading">{m.imported.notLoaded}</h2>
    <p><Rich text={(loaded ? m.imported.problemsSessionKept : m.imported.problemsNoSession)(diagnostics.length)}
      values={{ file: <span className="file-name">{fileName}</span> }} /></p>
    <ul aria-label={m.imported.problemsList}>{diagnostics.map((item, index) => <li key={`${item.path}:${item.code}:${index}`}>
      <code>{diagnosticPath(item.path, m)}</code> <code>{item.code}</code> — {explainDiagnostic(item.code, m)}
    </li>)}</ul>
  </section>;
}
