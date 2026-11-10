import type {
  ApplicationError, AssessmentConfiguration, AssessmentDefinition, AssessmentRow, AssessmentRowResult, CanonicalValue, ScenarioDiagnostic, WorkerEvent,
} from "@distlab/contracts";
import type { HostSnapshot } from "./host.ts";
import { incompleteRow, rowOverlay, rowResult } from "./assessment.ts";

/**
 * The assessment suite runner (docs/spec/assessment.md, "Running a suite").
 * Application orchestration on the main thread: for each row, in definition
 * order, one ordinary `load` of the exact base document with the row's overlay,
 * then `run` until the run finishes. It sends no other command, runs nothing
 * itself, and reads only what the projections publish.
 */

/** The part of `SimulationHost` the suite uses. */
export interface SuiteHost {
  load(scenario: CanonicalValue, overlay?: CanonicalValue): Promise<WorkerEvent>;
  run(): Promise<WorkerEvent>;
  getSnapshot(): HostSnapshot;
}

export type SuiteProgress =
  | { readonly type: "row-started"; readonly index: number; readonly row: AssessmentRow }
  | { readonly type: "row-finished"; readonly index: number; readonly row: AssessmentRow; readonly result: AssessmentRowResult };

export type SuiteOutcome =
  | { readonly status: "completed" | "stopped"; readonly rows: readonly AssessmentRowResult[] }
  /** A rejected load stops the suite and names the row and its diagnostics (ASSESS-AC-8). */
  | { readonly status: "rejected"; readonly rows: readonly AssessmentRowResult[]; readonly row: AssessmentRow; readonly diagnostics: readonly ScenarioDiagnostic[] }
  /** The worker could not be reached; nothing about the design is known from this row. */
  | { readonly status: "failed"; readonly rows: readonly AssessmentRowResult[]; readonly row: AssessmentRow; readonly error: ApplicationError };

const codeOf = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
const diagnosticsOf = (error: unknown): readonly ScenarioDiagnostic[] => {
  const context = error && typeof error === "object" && "context" in error ? error.context : undefined;
  const diagnostics = context && typeof context === "object" && "diagnostics" in context ? context.diagnostics : undefined;
  return Array.isArray(diagnostics) ? diagnostics as ScenarioDiagnostic[] : [];
};
const asError = (error: unknown): ApplicationError => ({ code: codeOf(error) ?? "WORKER_UNAVAILABLE",
  message: error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "The suite could not continue.", context: null });

/** Loads one row and runs it to its end. A FAILED run is a result, not an error: its unsettled cells read INCOMPLETE. */
async function runRow(host: SuiteHost, definition: AssessmentDefinition, base: CanonicalValue, row: AssessmentRow, configuration: AssessmentConfiguration)
  : Promise<{ readonly result: AssessmentRowResult } | { readonly rejected: readonly ScenarioDiagnostic[] } | { readonly error: ApplicationError }> {
  try { await host.load(base, rowOverlay(row, configuration) as unknown as CanonicalValue); }
  catch (error) { return codeOf(error) === "INVALID_OVERLAY" ? { rejected: diagnosticsOf(error) } : { error: asError(error) }; }
  const loaded = host.getSnapshot().projection;
  const runId = loaded?.simulation.runId ?? "";
  try {
    // A run without an event limit finishes COMPLETED or FAILED; PAUSED only follows an outside Pause.
    let event: WorkerEvent;
    do event = await host.run(); while (event.type === "run.finished" && event.status === "PAUSED");
  } catch (error) {
    if (codeOf(error) !== "SIMULATION_FAILED") return { error: asError(error) };
  }
  const projection = host.getSnapshot().projection;
  return { result: projection ? rowResult(definition, row, projection) : incompleteRow(definition, row, runId, loaded?.simulation.time ?? 0) };
}

/**
 * Runs every row in order. `stopRequested` is read before each row after the first, so
 * Stop ends the suite after the current row; the rows already finished are kept.
 * Afterwards the worker holds the last row's session (D-5).
 */
export async function runSuite(host: SuiteHost, definition: AssessmentDefinition, base: CanonicalValue, configuration: AssessmentConfiguration, options: {
  readonly onProgress?: (progress: SuiteProgress) => void;
  readonly stopRequested?: () => boolean;
} = {}): Promise<SuiteOutcome> {
  const rows: AssessmentRowResult[] = [];
  for (const [index, row] of definition.rows.entries()) {
    if (index > 0 && options.stopRequested?.()) return { status: "stopped", rows };
    options.onProgress?.({ type: "row-started", index, row });
    const outcome = await runRow(host, definition, base, row, configuration);
    if ("rejected" in outcome) return { status: "rejected", rows, row, diagnostics: outcome.rejected };
    if ("error" in outcome) return { status: "failed", rows, row, error: outcome.error };
    rows.push(outcome.result);
    options.onProgress?.({ type: "row-finished", index, row, result: outcome.result });
  }
  return { status: "completed", rows };
}

export type Reproduction = { readonly status: "reproduced" } | { readonly status: "mismatch"; readonly runId: string } | { readonly status: "failed"; readonly error: ApplicationError };

/**
 * Makes a finished row's history available again (docs/spec/assessment.md, "Opening evidence").
 * The worker holds only the last loaded row, so another row is loaded and run again: the same
 * base document, overlay, and seed give the same `runId` and history (ADR-001). A different
 * `runId` is reported and nothing is opened.
 */
export async function reproduceRow(host: SuiteHost, definition: AssessmentDefinition, base: CanonicalValue, row: AssessmentRow,
  configuration: AssessmentConfiguration, stored: AssessmentRowResult): Promise<Reproduction> {
  const current = host.getSnapshot().projection?.simulation;
  if (current?.runId === stored.runId && current.status === stored.status) return { status: "reproduced" };
  const outcome = await runRow(host, definition, base, row, configuration);
  if ("error" in outcome) return { status: "failed", error: outcome.error };
  if ("rejected" in outcome) return { status: "failed", error: { code: "INVALID_OVERLAY", message: "The row's overlay was rejected.", context: outcome.rejected as unknown as CanonicalValue } };
  return outcome.result.runId === stored.runId ? { status: "reproduced" } : { status: "mismatch", runId: outcome.result.runId };
}
