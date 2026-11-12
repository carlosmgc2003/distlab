/**
 * English source messages for the `content` area (ADR-007 section 5). Deliberately empty: text a lesson
 * author writes in `packages/catalogs` stays there as the English source, and English renders from it.
 * Another locale translates it here by stable id; a lookup that finds nothing falls back to the English
 * source. `tests/content-translations.test.ts` enumerates every catalog id and fails when a locale lacks one.
 *
 * - `checks`: a commerce check's label, by check id (`lesson/id` where a lesson words it differently,
 *   see `checkKey` in lesson-checks.ts).
 * - `checkoutTitles`, `checkoutExplanations`: the two checkout lessons, by lesson id.
 * - `assessmentTitles`: by assessment id.
 * - `assessmentRequirements`: by the requirement's English text.
 * - `assessmentRows`, `assessmentInvariants`: by `<assessment id>/<row or invariant id>`.
 */
export const content = {
  checks: {} as Readonly<Record<string, string>>,
  checkoutTitles: {} as Readonly<Record<string, string>>,
  checkoutExplanations: {} as Readonly<Record<string, string>>,
  assessmentTitles: {} as Readonly<Record<string, string>>,
  assessmentRequirements: {} as Readonly<Record<string, string>>,
  assessmentRows: {} as Readonly<Record<string, string>>,
  assessmentInvariants: {} as Readonly<Record<string, string>>,
};
