import type { AssessmentDefinition, LessonOverlayPolicy, ScenarioDiagnostic } from "@distlab/contracts";
import type { CanonicalValue } from "@distlab/contracts/kernel";
import { DiagnosticCodes } from "./types.js";
import { composeOverlay, sortDiagnostics } from "./overlay.js";

/**
 * Assessment definition validation (docs/spec/assessment.md, "Definition
 * validation"). A pure function of the definition and its base lesson's
 * packaged data: it creates no model, allocates no simulation identity, and
 * draws no randomness. Like the overlay code it reuses, only catalog tests,
 * headless tools, and the worker composition root call it; the main thread
 * never imports it.
 */

/** The base lesson's packaged data, resolved by the caller from its own catalog. */
export interface AssessmentBaseLesson {
  /** The packaged scenario document; its `name` must equal `AssessmentDefinition.base`. */
  readonly document: CanonicalValue;
  /** The lesson's data-only overlay policy. Without one, only a row with no faults composes. */
  readonly policy: LessonOverlayPolicy | undefined;
  /** The lesson's data-only check classification (#96), for example `commerceChecks(name)`. */
  readonly checks: readonly { readonly id: string; readonly kind: "invariant" | "expectation" }[];
}

/**
 * Validates a packaged assessment definition against its base lesson. `base` is
 * `undefined` when `definition.base` names no packaged lesson. `validate` is
 * the unchanged, pure `ScenarioEngine.validate` of the base lesson's catalog, as
 * for `composeOverlay`.
 *
 * Diagnostics are JSON pointers into the definition, sorted by path, then code:
 * - `/base` `REFERENCE`: no packaged lesson has that name;
 * - `/rows` or `/invariants` `REQUIRED`: the list is empty;
 * - `/rows/<i>/id` or `/invariants/<i>/id` `DUPLICATE`: an earlier entry has the same ID;
 * - `/invariants/<i>/id` `REFERENCE`: no assertion of the base document has that ID;
 * - `/invariants/<i>/id` `KIND`: the classification does not mark that assertion a business invariant;
 * - `/rows/<i>/faults/…` and `/rows/<i>/scheduledFaults/…`: the row's overlay
 *   `{ version: 1, faults, scheduledFaults, parameters: [] }` failed `composeOverlay`
 *   under the base policy, with its overlay codes (`OVERLAY_LIMIT`, `OVERLAY_ID_PREFIX`, …);
 * - `/base` with a scenario code: the applied document failed for a reason no
 *   row entry explains, which is a defect of the base lesson itself.
 */
export function validateAssessmentDefinition(
  definition: AssessmentDefinition,
  base: AssessmentBaseLesson | undefined,
  validate: (document: CanonicalValue) => readonly ScenarioDiagnostic[],
): readonly ScenarioDiagnostic[] {
  const found: ScenarioDiagnostic[] = [];
  const push = (path: string, code: string) => { found.push({ path, code }); };

  if (definition.rows.length === 0) push("/rows", DiagnosticCodes.REQUIRED);
  if (definition.invariants.length === 0) push("/invariants", DiagnosticCodes.REQUIRED);
  unique(definition.rows, "/rows", push);
  unique(definition.invariants, "/invariants", push);

  const document = base && isRecord(base.document) ? base.document : undefined;
  if (!base || !document || document.name !== definition.base) {
    push("/base", DiagnosticCodes.REFERENCE);
    return sortDiagnostics(found);
  }

  const assertions: readonly CanonicalValue[] = Array.isArray(document.assertions) ? document.assertions : [];
  const assertionIds = new Set(assertions.flatMap(item => isRecord(item) && typeof item.id === "string" ? [item.id] : []));
  definition.invariants.forEach((invariant, index) => {
    if (!assertionIds.has(invariant.id)) push(`/invariants/${index}/id`, DiagnosticCodes.REFERENCE);
    else if (!base.checks.some(check => check.id === invariant.id && check.kind === "invariant")) push(`/invariants/${index}/id`, DiagnosticCodes.KIND);
  });

  definition.rows.forEach((row, index) => {
    // The row's own overlay, without the student's parameters: every row must compose before any configuration is chosen (D-6).
    const overlay = { version: 1, faults: row.faults, scheduledFaults: row.scheduledFaults, parameters: [] } as unknown as CanonicalValue;
    const composed = composeOverlay(base.document, base.policy, overlay, validate);
    if (composed.ok) return;
    for (const item of composed.diagnostics) push(composed.code === "INVALID_OVERLAY" ? `/rows/${index}${item.path}` : "/base", item.code);
  });

  return sortDiagnostics(found);
}

function isRecord(value: CanonicalValue): value is { readonly [key: string]: CanonicalValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unique(items: readonly { readonly id: string }[], path: string, push: (path: string, code: string) => void): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) push(`${path}/${index}/id`, DiagnosticCodes.DUPLICATE);
    seen.add(item.id);
  });
}
