import type { CanonicalValue, Observation } from "@distlab/contracts";
import type { CommerceCheck } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";
import { isRecord, storedText } from "./records.ts";

/**
 * Lesson checks split into business invariants and scenario expectations (#96).
 * Pure: it reads the client projection's stored verdicts, the lesson's
 * data-only classification, and recorded observations. It never re-evaluates a
 * predicate. An invariant's verdict is HOLDS or VIOLATED; an expectation says whether
 * the lesson reproduced its setup. Verdicts are codes; the words come from the catalog by code. Neither is ever shown as a bare PASS.
 */

/** Verdict codes. The words a student reads come from `m.commerceLesson.verdict`, by code (ADR-007). */
export type InvariantVerdict = "HOLDS" | "VIOLATED" | "PENDING" | "INCOMPLETE";
export type ExpectationVerdict = "REPRODUCED" | "NOT_REPRODUCED" | "PENDING" | "INCOMPLETE";
export type ReproducedSummary = "YES" | "NO" | "NOT_YET" | "INCOMPLETE";

/** Which verdict vocabulary a row uses; it selects the words, never the behavior. */
export type CheckKind = "invariant" | "expectation" | "imported";

export interface CheckRow<Verdict extends string> {
  readonly id: string;
  readonly kind: CheckKind;
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
  readonly reproduced: ReproducedSummary | null;
}

const invariantVerdicts: Readonly<Record<string, InvariantVerdict>> = { PASS: "HOLDS", FAIL: "VIOLATED", PENDING: "PENDING", INCOMPLETE: "INCOMPLETE" };
const expectationVerdicts: Readonly<Record<string, ExpectationVerdict>> = { PASS: "REPRODUCED", FAIL: "NOT_REPRODUCED", PENDING: "PENDING", INCOMPLETE: "INCOMPLETE" };

/** The words of a row's verdict in the active language. */
export function verdictLabel(row: Pick<CheckRow<string>, "kind" | "verdict">, m: Messages): string {
  return byCode<string>(m.commerceLesson.verdict[row.kind], row.verdict) ?? row.verdict;
}

/** The CSS token of a verdict, from its code: `NOT_REPRODUCED` is `not-reproduced`, `HOLDS` is `holds`. */
export function verdictTone(verdict: string): string {
  return verdict.toLowerCase().replaceAll("_", "-");
}

const marks: Readonly<Record<string, string>> = {
  HOLDS: "✓", VIOLATED: "✗", REPRODUCED: "✓", NOT_REPRODUCED: "✗", PASS: "✓", FAIL: "✗", PENDING: "…", INCOMPLETE: "–",
};

/** The glyph that reinforces a verdict; the word carries the meaning, colour and glyph only support it. */
export function verdictMark(verdict: string): string {
  return marks[verdict] ?? "";
}

/**
 * The key of a check's Spanish label in `m.content.checks`. A check id names the same sentence in every lesson
 * that has it, except the ones listed here, whose wording changes with the lesson (numbers or what the
 * lesson's design recorded). Those are keyed `<lesson>/<id>`; tests/content-translations.test.ts fails when a
 * new difference appears.
 */
const lessonSpecificChecks: ReadonlySet<string> = new Set(["dual-write/durable-outbox", "cascade-breaker/dependency-recovered"]);
export function checkKey(lesson: string, id: string): string {
  return lessonSpecificChecks.has(`${lesson}/${id}`) ? `${lesson}/${id}` : id;
}

/**
 * Looks up catalog-authored text by its stable key. The English source stays in `packages/catalogs`, and
 * English renders from it; another language translates it in the `content` area (ADR-007 section 5).
 */
export function contentText(table: Readonly<Record<string, string>>, key: string, english: string): string {
  return byCode<string>(table, key) ?? english;
}

/** A packaged lesson check's label: the translation by stable id, or the catalog's English label. */
export function checkLabel(lesson: string, id: string, english: string, m: Messages): string {
  return contentText(m.content.checks, checkKey(lesson, id), english);
}

/** The latest `scenario.assertion.evaluated` record ID per assertion, from stored fields only. */
export function latestEvaluations(observations: readonly Observation[]): ReadonlyMap<string, string> {
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
export function lessonChecks(lesson: string, assertions: CanonicalValue | undefined, checks: readonly CommerceCheck[], observations: readonly Observation[], m: Messages): LessonCheckView {
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
      id, label: check ? checkLabel(lesson, id, check.label, m) : id,
      ...(settled && typeof item.time === "number" ? { time: item.time } : {}),
      ...(settled && evidence.has(id) ? { evidenceId: evidence.get(id)! } : {}),
    };
    if (check?.kind === "invariant") invariants.push({ ...common, kind: "invariant", verdict: invariantVerdicts[status] ?? "PENDING" });
    else expectations.push({ ...common, kind: "expectation", verdict: expectationVerdicts[status] ?? "PENDING" });
  }
  const reproduced: ReproducedSummary | null = expectations.length === 0 ? null
    : expectations.some(row => row.verdict === "NOT_REPRODUCED") ? "NO"
      : expectations.some(row => row.verdict === "INCOMPLETE") ? "INCOMPLETE"
        : expectations.every(row => row.verdict === "REPRODUCED") ? "YES" : "NOT_YET";
  return { invariants, expectations, reproduced };
}

export type ImportedVerdict = "PASS" | "FAIL" | "PENDING" | "INCOMPLETE";

/**
 * Checks of an imported scenario document (ADR-006). A version 1 document
 * carries no invariant/expectation classification, so each check keeps the
 * stored verdict that the catalog predicate gave it. The label is the
 * document's plain-text presentation label, or the assertion ID without one.
 */
export function importedChecks(assertions: CanonicalValue | undefined, labels: Readonly<Record<string, string>> | undefined, observations: readonly Observation[]): readonly CheckRow<ImportedVerdict>[] {
  const evidence = latestEvaluations(observations);
  const rows: CheckRow<ImportedVerdict>[] = [];
  for (const item of Array.isArray(assertions) ? assertions : []) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const id = item.id;
    const status = item.status === "PASS" || item.status === "FAIL" || item.status === "INCOMPLETE" ? item.status : "PENDING";
    const settled = status === "PASS" || status === "FAIL";
    rows.push({
      id, kind: "imported", label: labels && Object.hasOwn(labels, id) ? labels[id]! : id, verdict: status,
      ...(settled && typeof item.time === "number" ? { time: item.time } : {}),
      ...(settled && evidence.has(id) ? { evidenceId: evidence.get(id)! } : {}),
    });
  }
  return rows;
}
