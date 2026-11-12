import type {
  AssessmentCell, AssessmentConfiguration, AssessmentDefinition, AssessmentResult, AssessmentRow, AssessmentRowResult, AssessmentVerdict,
  CanonicalValue, RuntimeProjectionSet, SessionOverlay,
} from "@distlab/contracts";
import type { Messages } from "./i18n/catalog.ts";
import { contentText, latestEvaluations } from "./lesson-checks.ts";
import { isRecord } from "./records.ts";

/**
 * The assessment view's model (docs/spec/assessment.md). Pure: it builds each
 * row's overlay, reads a finished row's stored verdicts into cells, and writes
 * the canonical export. It never evaluates a predicate, never applies an
 * overlay, and never sends a command: the suite runner sends ordinary loads.
 */

/** A row's overlay: the row's faults, and the student's design applied unchanged to every row (ASSESS-INV-4). */
export function rowOverlay(row: AssessmentRow, configuration: AssessmentConfiguration): SessionOverlay {
  return {
    version: 1, faults: row.faults, scheduledFaults: row.scheduledFaults, parameters: configuration.parameters,
    ...(configuration.architecture ? { architecture: configuration.architecture } : {}),
  };
}

const verdicts: Readonly<Record<string, AssessmentVerdict>> = { PASS: "HOLDS", FAIL: "VIOLATED" };

/**
 * One cell per definition invariant, in column order, from the client
 * projection's stored verdicts (ASSESS-INV-2). A verdict still PENDING or
 * INCOMPLETE when the run ended reads INCOMPLETE and links no evidence.
 */
export function rowCells(definition: AssessmentDefinition, projection: RuntimeProjectionSet): readonly AssessmentCell[] {
  const client = projection.components.find(entry => entry.visibility === "student" && isRecord(entry.state) && entry.state.role === "commerce-client");
  const stored = isRecord(client?.state) && Array.isArray(client.state.assertions) ? client.state.assertions.filter(isRecord) : [];
  const evidence = latestEvaluations(projection.history.observations);
  return definition.invariants.map(({ id }) => {
    const result = stored.find(item => item.id === id);
    const verdict = verdicts[typeof result?.status === "string" ? result.status : ""] ?? "INCOMPLETE";
    const time = typeof result?.time === "number" ? result.time : projection.simulation.time;
    return { invariant: id, verdict, time: time as AssessmentCell["time"], evidence: verdict !== "INCOMPLETE" ? evidence.get(id) ?? null : null };
  });
}

/** A finished row: its run identity, final status, and cells. */
export function rowResult(definition: AssessmentDefinition, row: AssessmentRow, projection: RuntimeProjectionSet): AssessmentRowResult {
  return { row: row.id, runId: projection.simulation.runId, status: projection.simulation.status, cells: rowCells(definition, projection) };
}

/** A row whose run left no projection to read: every cell is INCOMPLETE at the last known time. */
export function incompleteRow(definition: AssessmentDefinition, row: AssessmentRow, runId: string, time: number): AssessmentRowResult {
  return { row: row.id, runId, status: "FAILED",
    cells: definition.invariants.map(({ id }) => ({ invariant: id, verdict: "INCOMPLETE", time: time as AssessmentCell["time"], evidence: null })) };
}

export type RowOutcome = "PASS" | "FAIL" | "INCOMPLETE";

/** A row passes when every invariant holds (D-4), fails when one is violated, and is otherwise incomplete. */
export function rowOutcome(result: AssessmentRowResult): RowOutcome {
  if (result.cells.some(cell => cell.verdict === "VIOLATED")) return "FAIL";
  return result.cells.every(cell => cell.verdict === "HOLDS") ? "PASS" : "INCOMPLETE";
}

/** The exported result: canonical data, with no wall-clock time and no identity (ASSESS-INV-3). */
export function assessmentResult(definition: AssessmentDefinition, seed: string, configuration: AssessmentConfiguration, rows: readonly AssessmentRowResult[]): AssessmentResult {
  return { format: "distlab.assessment-result", formatVersion: 1, assessment: definition.id, base: definition.base, seed, configuration, rows };
}

/** Canonical JSON: object keys sorted, no insignificant whitespace, one trailing newline. */
export function canonicalJson(value: CanonicalValue): string {
  const encode = (item: CanonicalValue): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    const object = item as Readonly<Record<string, CanonicalValue>>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${encode(object[key]!)}`).join(",")}}`;
  };
  return `${encode(value)}\n`;
}

export function exportFile(result: AssessmentResult): { readonly fileName: string; readonly text: string } {
  return { fileName: `${result.assessment}-result.json`, text: canonicalJson(result as unknown as CanonicalValue) };
}

/** A row's label in the active language: the catalog's English label, or its translation by `<assessment id>/<row id>`. */
export function rowLabel(definition: Pick<AssessmentDefinition, "id">, row: Pick<AssessmentRow, "id" | "label">, m: Messages): string {
  return contentText(m.content.assessmentRows, `${definition.id}/${row.id}`, row.label);
}

/** A business invariant's label in the active language, by `<assessment id>/<invariant id>`. */
export function invariantLabel(definition: Pick<AssessmentDefinition, "id">, invariant: { readonly id: string; readonly label: string }, m: Messages): string {
  return contentText(m.content.assessmentInvariants, `${definition.id}/${invariant.id}`, invariant.label);
}

/** A requirement line in the active language. Requirements have no ids, so they are keyed by their English text. */
export function requirementText(line: string, m: Messages): string {
  return contentText(m.content.assessmentRequirements, line, line);
}

/** The live region's words for a row that starts: "Row 3 of 6: Processor response lost — running". */
export function rowStartedText(index: number, total: number, definition: AssessmentDefinition, row: AssessmentRow, m: Messages): string {
  return m.assessment.suite.rowStarted({ index: index + 1, total, label: rowLabel(definition, row, m) });
}

/** The live region's words for a row that finished: "Row 3 of 6: Processor response lost — 1 of 4 invariants violated". */
export function rowFinishedText(index: number, total: number, definition: AssessmentDefinition, row: AssessmentRow, result: AssessmentRowResult, m: Messages): string {
  const count = (verdict: AssessmentVerdict) => result.cells.filter(cell => cell.verdict === verdict).length;
  const all = result.cells.length;
  const violated = count("VIOLATED"), incomplete = count("INCOMPLETE");
  const base = { index: index + 1, total, label: rowLabel(definition, row, m), all };
  return violated ? m.assessment.suite.rowViolated({ ...base, count: violated })
    : incomplete ? m.assessment.suite.rowIncomplete({ ...base, count: incomplete })
      : m.assessment.suite.rowAllHold(base);
}

/** One line for the whole suite: "2 of 6 rows pass". */
export function suiteSummary(results: readonly AssessmentRowResult[], total: number, m: Messages): string {
  const passed = results.filter(result => rowOutcome(result) === "PASS").length;
  return results.length < total ? m.assessment.suite.partial({ run: results.length, total, passed }) : m.assessment.suite.complete({ passed, total });
}
