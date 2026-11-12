import type { CanonicalValue, LessonOverlayPolicy, LessonParameter, ParameterOverride, ScenarioDiagnostic } from "@distlab/contracts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * Design choices model (ADR-004 parameters, issue #95). Pure: it reads lesson
 * policies as data and maps panel input to `ParameterOverride` values. It never
 * resolves a target, never applies an overlay, and never sends a command. The
 * worker validates the overrides against its own copy of the policy on load.
 */

/** Presentation copy, keyed by parameter key. It is UI data, not part of the policy contract. */
export interface ChoiceCopy {
  readonly label: string;
  /** One line on what the switch changes. It makes no claim about the outcome. */
  readonly hint: string;
}

/** The copy for a parameter key, in `lesson` (a packaged scenario name) when that lesson words it differently. */
export function choiceCopy(key: string, lesson: string | undefined, m: Messages): ChoiceCopy {
  const own = lesson ? byCode(m.designChoices.lessonChoices, lesson) : undefined;
  return (own ? byCode<ChoiceCopy>(own, key) : undefined) ?? byCode<ChoiceCopy>(m.designChoices.choices, key) ?? { label: key, hint: "" };
}

/** Every declared parameter, with the value the draft gives it (its default when absent). */
export function choiceValues(policy: LessonOverlayPolicy, overrides: readonly ParameterOverride[]): ReadonlyMap<string, CanonicalValue> {
  return new Map(policy.parameters.map(parameter => [parameter.key, overrides.find(item => item.key === parameter.key)?.value ?? parameter.domain.default]));
}

/**
 * Sets one value and returns the overrides in the worker's normalized form:
 * sorted by key, with defaults removed. A draft that equals the applied overlay
 * therefore compares equal to it.
 */
export function setChoice(policy: LessonOverlayPolicy, overrides: readonly ParameterOverride[], key: string, value: CanonicalValue): readonly ParameterOverride[] {
  const values = new Map(choiceValues(policy, overrides));
  values.set(key, value);
  return policy.parameters
    .filter(parameter => values.get(parameter.key) !== parameter.domain.default)
    .map(parameter => ({ key: parameter.key, value: values.get(parameter.key)! }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

export function sameChoices(left: readonly ParameterOverride[], right: readonly ParameterOverride[]): boolean {
  return left.length === right.length && left.every((item, index) => item.key === right[index]!.key && item.value === right[index]!.value);
}

/** A problem with a typed value as a code and its parameters. The section keeps this, never the finished text (ADR-007). */
export type ChoiceError =
  | { readonly code: "NOT_NUMBER" }
  | { readonly code: "RANGE"; readonly minimum: number; readonly maximum: number };

export function choiceErrorText(error: ChoiceError, m: Messages): string {
  return error.code === "NOT_NUMBER" ? m.designChoices.errors.notNumber : m.designChoices.errors.range({ minimum: error.minimum, maximum: error.maximum });
}

/** Reads an integer field. The worker checks the same domain again; this only keeps an invalid draft from being applied. */
export function readInteger(text: string, parameter: LessonParameter): { readonly value?: number; readonly error?: ChoiceError } {
  const domain = parameter.domain;
  if (domain.type !== "integer") return { error: { code: "NOT_NUMBER" } };
  const trimmed = text.trim();
  const value = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < domain.minimum || value > domain.maximum) return { error: { code: "RANGE", minimum: domain.minimum, maximum: domain.maximum } };
  return { value };
}

export function formatChoice(value: CanonicalValue, m: Messages): string {
  return value === true ? m.designChoices.on : value === false ? m.designChoices.off : String(value);
}

/** The run header form of the applied overrides, for example `idempotency=on · timeout=40`. The key ids stay as they are. */
export function describeChoices(overrides: readonly ParameterOverride[], m: Messages): string {
  return overrides.map(item => `${item.key}=${formatChoice(item.value, m)}`).join(m.designChoices.separator);
}

/** Places worker diagnostics whose paths point into `/parameters` on the choice they name. */
export function placeChoiceDiagnostics(diagnostics: readonly ScenarioDiagnostic[], overrides: readonly ParameterOverride[], m: Messages): ReadonlyMap<string, string> {
  const placed = new Map<string, string>();
  for (const item of diagnostics) {
    const match = /^\/parameters\/(\d+)(?:\/|$)/.exec(item.path);
    const override = match ? overrides[Number(match[1])] : undefined;
    if (override) placed.set(override.key, m.designChoices.withCode({ text: byCode(m.designChoices.diagnostics, item.code) ?? m.designChoices.diagnosticUnknown, code: item.code }));
  }
  return placed;
}

/** True for a diagnostic that belongs to the design choices rather than to a student fault. */
export function isChoiceDiagnostic(diagnostic: ScenarioDiagnostic): boolean {
  return diagnostic.path === "/parameters" || diagnostic.path.startsWith("/parameters/");
}
