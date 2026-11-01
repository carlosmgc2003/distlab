import type { CanonicalValue, Observation } from "@distlab/contracts";
import type { CommerceCheck } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { isRecord, storedText } from "./records.ts";

/**
 * Lesson checks split into business invariants and scenario expectations (#96).
 * Pure: it reads the client projection's stored verdicts, the lesson's
 * data-only classification, and recorded observations. It never re-evaluates a
 * predicate. An invariant reads HOLDS or VIOLATED; an expectation says whether
 * the lesson reproduced its setup. Neither is ever shown as a bare PASS.
 */

export type InvariantVerdict = "HOLDS" | "VIOLATED" | "PENDING" | "INCOMPLETE";
export type ExpectationVerdict = "reproduced" | "not reproduced" | "pending" | "incomplete";

export interface CheckRow<Verdict extends string> {
  readonly id: string;
  readonly label: string;
  readonly verdict: Verdict;
  /** Virtual time of the stored verdict, once it is settled. */
  readonly time?: number;
  /** The latest `scenario.assertion.evaluated` record for this check, when its payload is visible. */
  readonly evidenceId?: string;
}

export interface LessonCheckView {
  readonly invariants: readonly CheckRow<InvariantVerdict>[];
  readonly expectations: readonly CheckRow<ExpectationVerdict>[];
  /** The one-line summary of the expectations, or null when the lesson has none. */
  readonly reproduced: "yes" | "no" | "not yet" | "incomplete" | null;
}

const invariantVerdicts: Readonly<Record<string, InvariantVerdict>> = { PASS: "HOLDS", FAIL: "VIOLATED", PENDING: "PENDING", INCOMPLETE: "INCOMPLETE" };
const expectationVerdicts: Readonly<Record<string, ExpectationVerdict>> = { PASS: "reproduced", FAIL: "not reproduced", PENDING: "pending", INCOMPLETE: "incomplete" };

function latestEvaluations(observations: readonly Observation[]): ReadonlyMap<string, string> {
  const latest = new Map<string, string>();
  for (const observation of observations) {
    if (observation.type !== "scenario.assertion.evaluated") continue;
    const id = storedText(observation, "assertionId");
    if (id !== undefined) latest.set(id, observation.id);
  }
  return latest;
}

/**
 * A check without a classification is shown as an expectation: only a
 * classified business invariant may claim HOLDS or VIOLATED.
 */
export function lessonChecks(assertions: CanonicalValue | undefined, checks: readonly CommerceCheck[], observations: readonly Observation[]): LessonCheckView {
  const evidence = latestEvaluations(observations);
  const invariants: CheckRow<InvariantVerdict>[] = [];
  const expectations: CheckRow<ExpectationVerdict>[] = [];
  for (const item of Array.isArray(assertions) ? assertions : []) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const id = item.id;
    const status = typeof item.status === "string" ? item.status : "PENDING";
    const check = checks.find(entry => entry.id === id);
    const settled = status === "PASS" || status === "FAIL";
    const common = {
      id, label: check?.label ?? id,
      ...(settled && typeof item.time === "number" ? { time: item.time } : {}),
      ...(settled && evidence.has(id) ? { evidenceId: evidence.get(id)! } : {}),
    };
    if (check?.kind === "invariant") invariants.push({ ...common, verdict: invariantVerdicts[status] ?? "PENDING" });
    else expectations.push({ ...common, verdict: expectationVerdicts[status] ?? "pending" });
  }
  const reproduced = expectations.length === 0 ? null
    : expectations.some(row => row.verdict === "not reproduced") ? "no"
      : expectations.some(row => row.verdict === "incomplete") ? "incomplete"
        : expectations.every(row => row.verdict === "reproduced") ? "yes" : "not yet";
  return { invariants, expectations, reproduced };
}
