import type { ArchitectureEdits, OverlayScheduledFault, ParameterOverride } from "./overlay.js";
import type { FaultRule } from "./fault.js";
import type { ObservationId, RunId } from "./kernel/identities.js";
import type { SimulationStatus } from "./kernel/simulation.js";
import type { SimulationTime } from "./kernel/time.js";

/**
 * Assessments (docs/spec/assessment.md, #97). Shapes only: definition
 * validation lives in the scenario application layer, and the suite runner in
 * the browser application.
 */

/** A packaged, data-only assessment. The main thread may import it, as it imports lesson data. */
export interface AssessmentDefinition {
  readonly version: 1;
  /** Stable identity, for example "reliable-checkout-assessment@1". */
  readonly id: string;
  readonly title: string;
  /** Plain-text requirement lines shown to the student (vision §21). */
  readonly requirements: readonly string[];
  /** The packaged base lesson's scenario name, for example "reliable-checkout@1". */
  readonly base: string;
  /** Rows run in this order. */
  readonly rows: readonly AssessmentRow[];
  /**
   * The base lesson's business invariants, by assertion ID, in column order, with a
   * student-facing label. Every row checks every invariant.
   */
  readonly invariants: readonly { readonly id: string; readonly label: string }[];
}

export interface AssessmentRow {
  /** Stable within the definition, for example "processor-response-lost". */
  readonly id: string;
  readonly label: string;
  /** Added to the student's overlay for this row only. IDs start with `student-`. */
  readonly faults: readonly FaultRule[];
  readonly scheduledFaults: readonly OverlayScheduledFault[];
}

/** The student's design, applied unchanged to every row. */
export interface AssessmentConfiguration {
  readonly parameters: readonly ParameterOverride[];
  /** Absent until the Design editor (#112) exists. */
  readonly architecture?: ArchitectureEdits;
}

export type AssessmentVerdict = "HOLDS" | "VIOLATED" | "INCOMPLETE";

export interface AssessmentCell {
  /** An `AssessmentDefinition.invariants[].id`. */
  readonly invariant: string;
  readonly verdict: AssessmentVerdict;
  /** Virtual time of the stored verdict. */
  readonly time: SimulationTime;
  /** The row run's latest `scenario.assertion.evaluated` record for this invariant, when visible. */
  readonly evidence: ObservationId | null;
}

export interface AssessmentRowResult {
  readonly row: string;
  /** The row's `runId`. Replaying the row with the same inputs reproduces it. */
  readonly runId: RunId;
  readonly status: SimulationStatus;
  readonly cells: readonly AssessmentCell[];
}

/** The exported result: enough for an instructor to reproduce every row. */
export interface AssessmentResult {
  readonly format: "distlab.assessment-result";
  readonly formatVersion: 1;
  readonly assessment: string;
  readonly base: string;
  readonly seed: string;
  readonly configuration: AssessmentConfiguration;
  readonly rows: readonly AssessmentRowResult[];
}
