import { useCallback, useMemo, useRef, useState } from "react";
import type { AssessmentConfiguration, AssessmentRowResult, AssessmentVerdict, ParameterOverride, ScenarioDiagnostic } from "@distlab/contracts";
import { DesignChoicesSection } from "./DesignChoicesSection.tsx";
import { describeChoices, isChoiceDiagnostic, placeChoiceDiagnostics } from "./design-choices.ts";
import { HelpHint } from "./ui-hint.tsx";
import type { PackagedAssessment } from "./scenarios.ts";
import type { SuiteHost } from "./assessment-runner.ts";
import { reproduceRow, runSuite } from "./assessment-runner.ts";
import { assessmentResult, exportFile, rowFinishedText, rowOutcome, rowStartedText, suiteSummary } from "./assessment.ts";
import type { RowOutcome } from "./assessment.ts";

/**
 * The assessment view (docs/spec/assessment.md, #97). The student sets one design with the base
 * lesson's design choices, runs it against every row, and reads one verdict per row and invariant.
 * The suite sends only ordinary loads and runs; the matrix shows stored verdicts and never
 * evaluates a predicate. Suite state is UI state on the main thread and is lost on reload.
 */

type Problem =
  | { readonly kind: "rejected"; readonly row: string; readonly diagnostics: readonly ScenarioDiagnostic[]; readonly parameters: readonly ParameterOverride[] }
  | { readonly kind: "failed"; readonly row: string; readonly message: string }
  | { readonly kind: "mismatch"; readonly row: string };

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
  readonly messages: readonly string[];
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
  const [messages, setMessages] = useState<readonly string[]>([]);
  // A row's finish and the next row's start can land in one render; appending keeps both announced.
  const announce = useCallback((text: string) => setMessages(current => [...current, text]), []);
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
    const total = definition.rows.length;
    void runSuite(host, definition, choice.scenario, configuration, {
      stopRequested: () => stop.current,
      onProgress: progress => {
        if (progress.type === "row-started") {
          setCurrent(progress.index);
          announce(rowStartedText(progress.index, total, progress.row));
        } else {
          setResults(rows => [...rows, progress.result]);
          announce(rowFinishedText(progress.index, total, progress.row, progress.result));
        }
      },
    }).then(outcome => {
      setCurrent(null);
      setRunning(false);
      setStopping(false);
      const label = (id: string) => definition.rows.find(row => row.id === id)?.label ?? id;
      if (outcome.status === "rejected") {
        setProblem({ kind: "rejected", row: label(outcome.row.id), diagnostics: outcome.diagnostics, parameters: configuration.parameters });
        announce(`The assessment stopped: ${label(outcome.row.id)} could not be loaded.`);
      } else if (outcome.status === "failed") {
        setProblem({ kind: "failed", row: label(outcome.row.id), message: outcome.error.message });
        announce(`The assessment stopped: ${label(outcome.row.id)} could not be run.`);
      } else {
        announce(`${outcome.status === "stopped" ? "Assessment stopped" : "Assessment finished"}: ${suiteSummary(outcome.rows, total)}.`);
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
      else if (result.status === "mismatch") setProblem({ kind: "mismatch", row: row.label });
      else setProblem({ kind: "failed", row: row.label, message: result.error.message });
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
  return <>
    <p className="lesson-goal-title"><strong>{choice.title} assessment</strong></p>
    <p>{choice.description}</p>
    <h4 className="assessment-requirements-heading">Requirements</h4>
    <ul className="assessment-requirements" aria-label="Requirements">{choice.definition.requirements.map(line => <li key={line}>{line}</li>)}</ul>
  </>;
}

/** ② Run: the student's design, Run assessment, Stop, and the suite's polite live region. */
export function AssessmentRun({ choice, suite, busy }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly busy: boolean }) {
  const rejected = suite.problem?.kind === "rejected" ? suite.problem : null;
  const placed = useMemo(() => rejected ? placeChoiceDiagnostics(rejected.diagnostics.filter(isChoiceDiagnostic), rejected.parameters) : new Map<string, string>(), [rejected]);
  const total = choice.definition.rows.length;
  const editable = !busy && !suite.running;
  return <>
    <DesignChoicesSection title="Your design" policy={choice.policy} draft={suite.draft} onDraftChange={suite.setDraft}
      editable={editable} rejected={placed} onInvalidChange={suite.setInvalid} resetToken={0} />
    <div className="assessment-actions">
      <button type="button" className="assessment-run" disabled={busy || suite.running || suite.invalid} onClick={suite.run}>Run assessment</button>
      <button type="button" disabled={!suite.running || suite.stopping} onClick={suite.stop}>{suite.stopping ? "Stopping after this row…" : "Stop"}</button>
    </div>
    <p className="assessment-progress" aria-hidden="true">{suite.running && suite.current !== null ? `Running row ${suite.current + 1} of ${total}…` : null}</p>
    {/* Each row's start and finish is appended and announced here; focus does not move (ASSESS-AC-7). */}
    <div className="sr-only" role="log" aria-live="polite" aria-label="Assessment progress">
      {suite.messages.map((text, index) => <p key={index}>{text}</p>)}
    </div>
    {suite.problem ? <div className="assessment-problem" role="alert">
      {suite.problem.kind === "rejected" ? <>
        <p>The assessment stopped at <strong>{suite.problem.row}</strong>: the worker rejected its load. The rows already run are kept.</p>
        <ul aria-label="Diagnostics">{suite.problem.diagnostics.map(item => <li key={`${item.path} ${item.code}`}><code>{item.path}</code> {item.code}</li>)}</ul>
      </> : suite.problem.kind === "failed" ? <p>The assessment could not continue at <strong>{suite.problem.row}</strong>: {suite.problem.message}</p>
        : <p>Reloading <strong>{suite.problem.row}</strong> gave a different run, so its evidence was not opened.</p>}
    </div> : null}
  </>;
}

/** ③ Investigate: the one-line summary, where the matrix is, and Export result. */
export function AssessmentInvestigate({ choice, suite, onShowResults }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly onShowResults: () => void }) {
  const total = choice.definition.rows.length;
  return <>
    {suite.results.length ? <p className="lesson-outcome"><strong>{suiteSummary(suite.results, total)}</strong></p>
      : <p>No results yet. Set your design, then run the assessment.</p>}
    {suite.ran ? <p className="run-identity" aria-label="Assessed design">{suite.ran.parameters.length ? describeChoices(suite.ran.parameters) : "Lesson defaults"}</p> : null}
    <div className="assessment-actions">
      <button type="button" onClick={onShowResults}>Show results</button>
      <button type="button" disabled={!suite.results.length || suite.running} onClick={suite.download}>Export result</button>
    </div>
  </>;
}

/** ④ Experiment: what stays fixed, and where the rows' faults come from. */
export function AssessmentExperiment() {
  return <>
    <p>Each scenario loads the base lesson again with its own faults, and your design applies to every scenario. The seed, the workload, and the checks stay the lesson's.</p>
    <p>This assessment adds no faults of your own: the scenarios are the faults. Change your design in ② Run and run the assessment again.</p>
  </>;
}

const glyphs: Readonly<Record<AssessmentVerdict | RowOutcome, string>> = { HOLDS: "✓", VIOLATED: "✗", INCOMPLETE: "–", PASS: "✓", FAIL: "✗" };

/**
 * The results matrix: one row per scenario, one column per business invariant. Verdicts are
 * words with a glyph; colour only reinforces them. Each settled cell links its evidence record.
 */
export function AssessmentMatrix({ choice, suite, busy }: { readonly choice: PackagedAssessment; readonly suite: AssessmentSuite; readonly busy: boolean }) {
  const definition = choice.definition;
  return <section className="assessment-matrix" aria-labelledby="assessment-matrix-title">
    <div className="assessment-matrix-header">
      <h2 id="assessment-matrix-title">{choice.title}: results</h2>
      <HelpHint label="About these results" bodyId="assessment-results-help">
        <p>Each scenario is one run of the base lesson with that scenario's faults and your design. A scenario passes when every business invariant holds. HOLDS and VIOLATED are the verdicts the run stored; INCOMPLETE means the run ended before the check settled.</p>
        <p>Show evidence opens the check's record in Recorded history. Only the last scenario's run stays loaded, so opening another one runs it again first; the same inputs give the same run.</p>
      </HelpHint>
      <button type="button" disabled={!suite.results.length || suite.running} onClick={suite.download}>Export result</button>
    </div>
    <div className="assessment-matrix-scroll">
      <table className="assessment-table">
        <caption className="sr-only">{choice.title}: one row per fault scenario, one column per business invariant</caption>
        <thead><tr>
          <th scope="col">Scenario</th>
          <th scope="col">Result</th>
          {definition.invariants.map(invariant => <th key={invariant.id} scope="col">{invariant.label}</th>)}
        </tr></thead>
        <tbody>{definition.rows.map((row, index) => {
          const result = suite.results[index];
          const outcome = result ? rowOutcome(result) : null;
          const pending = suite.running && suite.current === index ? "Running…" : suite.reopening === index ? "Reloading…" : "Not run";
          return <tr key={row.id} className={outcome ? `is-${outcome.toLowerCase()}` : undefined}>
            <th scope="row">{row.label}</th>
            <td className={`assessment-outcome${outcome ? ` is-${outcome.toLowerCase()}` : ""}`}>
              {outcome ? <strong><span aria-hidden="true">{glyphs[outcome]} </span>{outcome}</strong> : <span className="assessment-pending">{pending}</span>}
              {result && result.status === "FAILED" ? <span className="assessment-failed"> (run failed)</span> : null}
            </td>
            {definition.invariants.map(invariant => {
              const cell = result?.cells.find(item => item.invariant === invariant.id);
              if (!cell) return <td key={invariant.id} className="assessment-cell"><span className="assessment-pending">—</span></td>;
              return <td key={invariant.id} className={`assessment-cell is-${cell.verdict.toLowerCase()}`}>
                <span className="assessment-verdict"><span aria-hidden="true">{glyphs[cell.verdict]} </span>{cell.verdict}</span>
                {cell.evidence ? <button type="button" disabled={busy || suite.running || suite.reopening !== null}
                  aria-label={`Show evidence: ${row.label}, ${invariant.label}`} onClick={() => suite.openEvidence(index, cell.evidence!)}>Show evidence</button> : null}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
