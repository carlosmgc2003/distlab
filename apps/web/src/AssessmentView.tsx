import { useCallback, useMemo, useRef, useState } from "react";
import type { ApplicationError, AssessmentConfiguration, AssessmentRowResult, AssessmentVerdict, ParameterOverride, ScenarioDiagnostic } from "@distlab/contracts";
import { DesignChoicesSection } from "./DesignChoicesSection.tsx";
import { describeChoices, isChoiceDiagnostic, placeChoiceDiagnostics } from "./design-choices.ts";
import { useMessages } from "./i18n/react.tsx";
import { Rich } from "./i18n/rich.tsx";
import type { Messages } from "./i18n/catalog.ts";
import { HelpHint } from "./ui-hint.tsx";
import { assessmentDescription, assessmentTitle } from "./scenarios.ts";
import type { PackagedAssessment } from "./scenarios.ts";
import type { SuiteHost } from "./assessment-runner.ts";
import { reproduceRow, runSuite } from "./assessment-runner.ts";
import { assessmentResult, exportFile, invariantLabel, requirementText, rowFinishedText, rowLabel, rowOutcome, rowStartedText, suiteSummary } from "./assessment.ts";
import { errorText } from "./error-text.ts";
import type { RowOutcome } from "./assessment.ts";

/**
 * The assessment view (docs/spec/assessment.md, #97). The student sets one design with the base
 * lesson's design choices, runs it against every row, and reads one verdict per row and invariant.
 * The suite sends only ordinary loads and runs; the matrix shows stored verdicts and never
 * evaluates a predicate. Suite state is UI state on the main thread and is lost on reload.
 */

/** What stopped the suite. It keeps the row id, never its label, so a language switch rewords it. */
type Problem =
  | { readonly kind: "rejected"; readonly row: string; readonly diagnostics: readonly ScenarioDiagnostic[]; readonly parameters: readonly ParameterOverride[] }
  | { readonly kind: "failed"; readonly row: string; readonly error: ApplicationError }
  | { readonly kind: "mismatch"; readonly row: string };

/**
 * One live-region announcement as a descriptor (ADR-007 rule 6): the codes and stored results, worded
 * when it is rendered. `index` is the row's position in the definition; `row` is a row id.
 */
export type Announcement =
  | { readonly kind: "row-started"; readonly index: number }
  | { readonly kind: "row-finished"; readonly index: number; readonly result: AssessmentRowResult }
  | { readonly kind: "rejected"; readonly row: string }
  | { readonly kind: "failed"; readonly row: string }
  | { readonly kind: "suite-ended"; readonly stopped: boolean; readonly rows: readonly AssessmentRowResult[] };

function rowLabelById(definition: PackagedAssessment["definition"], id: string, m: Messages): string {
  const row = definition.rows.find(item => item.id === id);
  return row ? rowLabel(definition, row, m) : id;
}

/** The words of one announcement, in the active language. */
export function announcementText(announcement: Announcement, definition: PackagedAssessment["definition"], m: Messages): string {
  const total = definition.rows.length;
  switch (announcement.kind) {
    case "row-started": return rowStartedText(announcement.index, total, definition, definition.rows[announcement.index]!, m);
    case "row-finished": return rowFinishedText(announcement.index, total, definition, definition.rows[announcement.index]!, announcement.result, m);
    case "rejected": return m.assessment.view.announce.rejected(rowLabelById(definition, announcement.row, m));
    case "failed": return m.assessment.view.announce.failed(rowLabelById(definition, announcement.row, m));
    case "suite-ended": return (announcement.stopped ? m.assessment.view.announce.stopped : m.assessment.view.announce.finished)(suiteSummary(announcement.rows, total, m));
  }
}

export interface AssessmentSuite {
  readonly draft: readonly ParameterOverride[];
  readonly setDraft: (draft: readonly ParameterOverride[]) => void;
  /** The configuration the shown results were run with; the draft may have changed since. */
  readonly ran: AssessmentConfiguration | null;
  readonly results: readonly AssessmentRowResult[];
  readonly running: boolean;
  readonly stopping: boolean;
  /** The row being run, by index. */
  readonly current: number | null;
  /** A row reloaded to show its evidence, by index. */
  readonly reopening: number | null;
  /** Every message of the current suite, oldest first; the live region announces each one it adds. */
  readonly messages: readonly Announcement[];
  readonly problem: Problem | null;
  readonly invalid: boolean;
  readonly setInvalid: (invalid: boolean) => void;
  readonly run: () => void;
  readonly stop: () => void;
  readonly download: () => void;
  readonly openEvidence: (rowIndex: number, observationId: string) => void;
  /** Clears the draft and every result, for an assessment opened again or closed. */
  readonly reset: () => void;
}

/**
 * Owns one assessment's suite state. `busy` is the shell's command state: Run assessment is
 * unavailable while any command is outstanding or a simulation runs, like Apply and restart.
 * `onEvidence` receives a record of the row the worker now holds.
 */
export function useAssessmentSuite(host: SuiteHost, choice: PackagedAssessment | null, busy: boolean,
  onEvidence: (observationId: string) => void): AssessmentSuite {
  const definition = choice?.definition;
  const [draft, setDraft] = useState<readonly ParameterOverride[]>([]);
  const [ran, setRan] = useState<AssessmentConfiguration | null>(null);
  const [results, setResults] = useState<readonly AssessmentRowResult[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [reopening, setReopening] = useState<number | null>(null);
  const [messages, setMessages] = useState<readonly Announcement[]>([]);
  // A row's finish and the next row's start can land in one render; appending keeps both announced.
  const announce = useCallback((item: Announcement) => setMessages(current => [...current, item]), []);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stop = useRef(false);

  const run = useCallback(() => {
    if (!choice || !definition || busy || running || invalid) return;
    const configuration: AssessmentConfiguration = { parameters: draft };
    stop.current = false;
    setStopping(false);
    setRunning(true);
    setRan(configuration);
    setResults([]);
    setProblem(null);
    setMessages([]);
    void runSuite(host, definition, choice.scenario, configuration, {
      stopRequested: () => stop.current,
      onProgress: progress => {
        if (progress.type === "row-started") {
          setCurrent(progress.index);
          announce({ kind: "row-started", index: progress.index });
        } else {
          setResults(rows => [...rows, progress.result]);
          announce({ kind: "row-finished", index: progress.index, result: progress.result });
        }
      },
    }).then(outcome => {
      setCurrent(null);
      setRunning(false);
      setStopping(false);
      if (outcome.status === "rejected") {
        setProblem({ kind: "rejected", row: outcome.row.id, diagnostics: outcome.diagnostics, parameters: configuration.parameters });
        announce({ kind: "rejected", row: outcome.row.id });
      } else if (outcome.status === "failed") {
        setProblem({ kind: "failed", row: outcome.row.id, error: outcome.error });
        announce({ kind: "failed", row: outcome.row.id });
      } else {
        announce({ kind: "suite-ended", stopped: outcome.status === "stopped", rows: outcome.rows });
      }
    });
  }, [busy, running, invalid, draft, definition, host, choice, announce]);

  const download = useCallback(() => {
    if (!choice || !definition || !ran || !results.length) return;
    const seed = (choice.scenario as { readonly seed: string }).seed;
    const file = exportFile(assessmentResult(definition, seed, ran, results));
    const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [ran, results, definition, choice]);

  const openEvidence = useCallback((rowIndex: number, observationId: string) => {
    const row = definition?.rows[rowIndex];
    const stored = results[rowIndex];
    if (!choice || !definition || !row || !stored || !ran || busy || running) return;
    setReopening(rowIndex);
    setProblem(null);
    void reproduceRow(host, definition, choice.scenario, row, ran, stored).then(result => {
      setReopening(null);
      if (result.status === "reproduced") onEvidence(observationId);
      else if (result.status === "mismatch") setProblem({ kind: "mismatch", row: row.id });
      else setProblem({ kind: "failed", row: row.id, error: result.error });
    });
  }, [definition, results, ran, busy, running, host, choice, onEvidence]);

  const reset = useCallback(() => {
    setDraft([]); setRan(null); setResults([]); setCurrent(null); setReopening(null); setMessages([]); setProblem(null); setInvalid(false);
  }, []);
  return { draft, setDraft, ran, results, running, stopping, current, reopening, messages, problem, invalid, setInvalid, run,
    stop: () => { stop.current = true; setStopping(true); }, download, openEvidence, reset };
}

/** ① Goal: what the assessment asks, as plain requirement lines (vision §21). */
export function AssessmentGoal({ choice }: { readonly choice: PackagedAssessment }) {
  const m = useMessages();
  return <>
    <p className="lesson-goal-title"><strong>{m.assessment.view.goalTitle(assessmentTitle(choice, m))}</strong></p>
    <p>{assessmentDescription(choice, m)}</p>
    <h4 className="assessment-requirements-heading">{m.assessment.view.requirements}</h4>
    <ul className="assessment-requirements" aria-label={m.assessment.view.requirements}>{choice.definition.requirements.map(line => <li key={line}>{requirementText(line, m)}</li>)}</ul>
  </>;
}

/** ② Run: the student's design, Run assessment, Stop, and the suite's polite live region. */
export function AssessmentRun({ choice, suite, busy }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly busy: boolean }) {
  const m = useMessages();
  const rejected = suite.problem?.kind === "rejected" ? suite.problem : null;
  const placed = useMemo(() => rejected ? placeChoiceDiagnostics(rejected.diagnostics.filter(isChoiceDiagnostic), rejected.parameters, m) : new Map<string, string>(), [rejected, m]);
  const total = choice.definition.rows.length;
  const editable = !busy && !suite.running;
  const problemRow = suite.problem ? rowLabelById(choice.definition, suite.problem.row, m) : "";
  return <>
    <DesignChoicesSection title={m.assessment.view.yourDesign} policy={choice.policy} draft={suite.draft} onDraftChange={suite.setDraft}
      editable={editable} rejected={placed} onInvalidChange={suite.setInvalid} resetToken={0} />
    <div className="assessment-actions">
      <button type="button" className="assessment-run" disabled={busy || suite.running || suite.invalid} onClick={suite.run}>{m.assessment.view.runAssessment}</button>
      <button type="button" disabled={!suite.running || suite.stopping} onClick={suite.stop}>{suite.stopping ? m.assessment.view.stopping : m.assessment.view.stop}</button>
    </div>
    <p className="assessment-progress" aria-hidden="true">{suite.running && suite.current !== null ? m.assessment.view.progress({ index: suite.current + 1, total }) : null}</p>
    {/* Each row's start and finish is appended and announced here; focus does not move (ASSESS-AC-7). */}
    <div className="sr-only" role="log" aria-live="polite" aria-label={m.assessment.view.progressLabel}>
      {suite.messages.map((item, index) => <p key={index}>{announcementText(item, choice.definition, m)}</p>)}
    </div>
    {suite.problem ? <div className="assessment-problem" role="alert">
      {suite.problem.kind === "rejected" ? <>
        <p><Rich text={m.assessment.view.problem.rejected} tags={strong} values={{ row: problemRow }} /></p>
        <ul aria-label={m.assessment.view.diagnosticsLabel}>{suite.problem.diagnostics.map(item => <li key={`${item.path} ${item.code}`}><code>{item.path}</code> {item.code}</li>)}</ul>
      </> : suite.problem.kind === "failed" ? <p><Rich text={m.assessment.view.problem.failed} tags={strong} values={{ row: problemRow, error: errorText(suite.problem.error, m) }} /></p>
        : <p><Rich text={m.assessment.view.problem.mismatch} tags={strong} values={{ row: problemRow }} /></p>}
    </div> : null}
  </>;
}

/** ③ Investigate: the one-line summary, where the matrix is, and Export result. */
export function AssessmentInvestigate({ choice, suite, onShowResults }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly onShowResults: () => void }) {
  const m = useMessages();
  const total = choice.definition.rows.length;
  return <>
    {suite.results.length ? <p className="lesson-outcome"><strong>{suiteSummary(suite.results, total, m)}</strong></p>
      : <p>{m.assessment.view.noResults}</p>}
    {suite.ran ? <p className="run-identity" aria-label={m.assessment.view.assessedDesign}>{suite.ran.parameters.length ? describeChoices(suite.ran.parameters, m) : m.assessment.view.lessonDefaults}</p> : null}
    <div className="assessment-actions">
      <button type="button" onClick={onShowResults}>{m.assessment.view.showResults}</button>
      <button type="button" disabled={!suite.results.length || suite.running} onClick={suite.download}>{m.assessment.view.exportResult}</button>
    </div>
  </>;
}

/** ④ Experiment: what stays fixed, and where the rows' faults come from. */
export function AssessmentExperiment() {
  const m = useMessages();
  return <>
    <p>{m.assessment.view.experiment.loadsAgain}</p>
    <p>{m.assessment.view.experiment.noFaults}</p>
  </>;
}

const strong = { strong: (children: React.ReactNode) => <strong>{children}</strong> };

const glyphs: Readonly<Record<AssessmentVerdict | RowOutcome, string>> = { HOLDS: "✓", VIOLATED: "✗", INCOMPLETE: "–", PASS: "✓", FAIL: "✗" };

/**
 * The results matrix: one row per scenario, one column per business invariant. Verdicts are
 * words with a glyph; colour only reinforces them. Each settled cell links its evidence record.
 */
export function AssessmentMatrix({ choice, suite, busy }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly busy: boolean }) {
  const m = useMessages();
  const definition = choice.definition;
  return <section className="assessment-matrix" aria-labelledby="assessment-matrix-title">
    <div className="assessment-matrix-header">
      <h2 id="assessment-matrix-title">{m.assessment.view.matrix.title(assessmentTitle(choice, m))}</h2>
      <HelpHint label={m.assessment.view.matrix.helpLabel} bodyId="assessment-results-help">
        <p>{m.assessment.view.matrix.help1}</p>
        <p>{m.assessment.view.matrix.help2}</p>
      </HelpHint>
      <button type="button" disabled={!suite.results.length || suite.running} onClick={suite.download}>{m.assessment.view.exportResult}</button>
    </div>
    <div className="assessment-matrix-scroll">
      <table className="assessment-table">
        <caption className="sr-only">{m.assessment.view.matrix.caption(assessmentTitle(choice, m))}</caption>
        <thead><tr>
          <th scope="col">{m.assessment.view.matrix.scenario}</th>
          <th scope="col">{m.assessment.view.matrix.result}</th>
          {definition.invariants.map(invariant => <th key={invariant.id} scope="col">{invariantLabel(definition, invariant, m)}</th>)}
        </tr></thead>
        <tbody>{definition.rows.map((row, index) => {
          const result = suite.results[index];
          const outcome = result ? rowOutcome(result) : null;
          const pending = suite.running && suite.current === index ? m.assessment.view.matrix.running : suite.reopening === index ? m.assessment.view.matrix.reloading : m.assessment.view.matrix.notRun;
          return <tr key={row.id} className={outcome ? `is-${outcome.toLowerCase()}` : undefined}>
            <th scope="row">{rowLabel(definition, row, m)}</th>
            <td className={`assessment-outcome${outcome ? ` is-${outcome.toLowerCase()}` : ""}`}>
              {outcome ? <strong><span aria-hidden="true">{glyphs[outcome]} </span>{m.commerceLesson.verdict.imported[outcome]}</strong> : <span className="assessment-pending">{pending}</span>}
              {result && result.status === "FAILED" ? <span className="assessment-failed"> {m.assessment.view.matrix.runFailed}</span> : null}
            </td>
            {definition.invariants.map(invariant => {
              const cell = result?.cells.find(item => item.invariant === invariant.id);
              if (!cell) return <td key={invariant.id} className="assessment-cell"><span className="assessment-pending">—</span></td>;
              return <td key={invariant.id} className={`assessment-cell is-${cell.verdict.toLowerCase()}`}>
                <span className="assessment-verdict"><span aria-hidden="true">{glyphs[cell.verdict]} </span>{m.commerceLesson.verdict.invariant[cell.verdict]}</span>
                {cell.evidence ? <button type="button" disabled={busy || suite.running || suite.reopening !== null}
                  aria-label={m.assessment.view.matrix.showEvidenceFor({ row: rowLabel(definition, row, m), invariant: invariantLabel(definition, invariant, m) })} onClick={() => suite.openEvidence(index, cell.evidence!)}>{m.assessment.view.matrix.showEvidence}</button> : null}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
