import assert from "node:assert/strict";
import test from "node:test";
import { messages } from "../src/i18n/catalog.ts";
import { en } from "../src/i18n/en/index.ts";
import { es } from "../src/i18n/es/index.ts";
import { createFmt } from "../src/i18n/format.ts";
import { detectLocale, LOCALES, SELECTABLE_LOCALES } from "../src/i18n/locales.ts";
import { pseudoText } from "../src/i18n/pseudo.ts";
import { parseRich, plainText } from "../src/i18n/rich-parse.ts";
import { files, scan } from "./i18n-scan.ts";

type Tree = { readonly [key: string]: unknown };
function shape(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [`${path}()/${value.length}`];
  if (Array.isArray(value)) return [`${path}[${value.length}]`];
  if (value && typeof value === "object") return Object.keys(value).sort().flatMap(key => shape((value as Tree)[key], path ? `${path}.${key}` : key));
  return [path];
}
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key));
  return [];
}

test("I18N-AC-1: every locale catalog has exactly the English keys, arities, and list lengths", () => {
  // The type `typeof en` already rejects missing keys and changed parameters; this also catches extra keys.
  assert.deepEqual(shape(es), shape(en));
});

test("I18N-AC-2: Spanish strings are translated, except names and notations that stay as written", () => {
  // Brand and product names, codes, and notation. Add an entry only for text that is the same in both languages.
  const same = new Set(["common.brand"]);
  const english = new Map(strings(en));
  const untranslated = strings(es).filter(([path, text]) => english.get(path) === text && /[A-Za-z]{3,}/.test(text) && !same.has(path) && !path.startsWith("content."));
  assert.deepEqual(untranslated.map(([path]) => path), []);
});

test("I18N-AC-3: the locale comes from ?lang=, then the stored choice, then the browser, then English", () => {
  assert.equal(detectLocale({}), "en");
  assert.equal(detectLocale({ languages: ["fr-FR", "es-AR", "en"] }), "es");
  assert.equal(detectLocale({ languages: ["EN-gb"] }), "en");
  assert.equal(detectLocale({ stored: "es", languages: ["en"] }), "es");
  assert.equal(detectLocale({ stored: "xx", languages: ["es-MX"] }), "es");
  assert.equal(detectLocale({ query: "en-XA", stored: "es" }), "en-XA");
  assert.equal(detectLocale({ stored: "en-XA" }), "en", "the pseudo-locale is never remembered");
  assert.ok(!SELECTABLE_LOCALES.includes("en-XA"));
  assert.ok(LOCALES.every(locale => messages(locale.id).locale === locale.id));
});

test("I18N-AC-4: plurals, lists, and numbers follow the locale's own rules", () => {
  const english = createFmt("en");
  const spanish = createFmt("es");
  assert.equal(english.plural(1, { one: "1 fault", other: "2+ faults" }), "1 fault");
  assert.equal(english.plural(0, { one: "1 fault", other: "0 faults" }), "0 faults");
  assert.equal(spanish.plural(1, { one: "1 falla", other: "fallas" }), "1 falla");
  assert.equal(english.list(["A", "B", "C"]), "A, B, and C");
  assert.equal(spanish.list(["A", "B", "C"]), "A, B y C");
  assert.equal(spanish.list(["A", "B"], "or"), "A o B");
  assert.equal(english.number(1048576), "1,048,576");
  assert.equal(spanish.number(1048576), "1.048.576");
  assert.equal(messages("es").fmt.quote("x"), "«x»");
});

test("I18N-AC-5: rich messages keep tags and placeholders as structure, never as parsed values", () => {
  assert.deepEqual(parseRich("Seed: <code>{seed}</code>."), ["Seed: ", { tag: "code", children: [{ placeholder: "seed" }] }, "."]);
  assert.deepEqual(parseRich("a <b>bold <i>x</i></b>"), ["a ", { tag: "b", children: ["bold ", { tag: "i", children: ["x"] }] }]);
  assert.deepEqual(parseRich("open <b>never closed"), ["open ", "<b>", "never closed"]);
  assert.deepEqual(parseRich("stray </b> close"), ["stray ", "</b>", " close"]);
  assert.equal(plainText("Seed: <code>{seed}</code> of {missing}.", { seed: 7 }), "Seed: 7 of {missing}.");
});

test("I18N-AC-6: the pseudo-locale changes every letter it may and keeps tags and placeholders", () => {
  const pseudo = pseudoText("Run <b>{count}</b> lessons");
  assert.match(pseudo, /^⟦Rúñ <b>\{count\}<\/b> léššóñš·+⟧$/);
  assert.equal(pseudoText("   "), "   ");
  const m = messages("en-XA");
  assert.match(m.commerceLesson.outcome.pending, /^⟦.*⟧$/);
  assert.match(m.commerceLesson.outcome.allHold(3), /^⟦.*3.*⟧$/);
});

test("I18N-AC-7: bound messages are memoized and frozen per locale", () => {
  assert.equal(messages("es"), messages("es"));
  assert.ok(Object.isFrozen(messages("en")));
  assert.equal(messages("es").commerceLesson.outcome.allHold(1), "El único invariante de negocio se cumple");
});

/**
 * I18N-AC-8: user-visible English outside the catalogs may only shrink. Lower a file's
 * number when you move its strings into `src/i18n/`; never raise it. Run
 * `node --experimental-strip-types tests/i18n-scan.ts <file>` to list what is left.
 */
// Measured when the catalogs were introduced; extraction lowers these toward zero.
const HARD_CODED_BUDGET: Readonly<Record<string, number>> = {
  "src/TimelineView.tsx": 145,
  "src/flight.ts": 90,
  "src/App.tsx": 71,
  "src/FaultInspectionView.tsx": 69,
  "src/FaultsSection.tsx": 52,
  "src/ArchitectureView.tsx": 51,
  "src/timeline-query.ts": 47,
  "src/scenario-file.ts": 45,
  "src/scenarios.ts": 45,
  "src/design-choices.ts": 44,
  "src/timeline.ts": 41,
  "src/AssessmentView.tsx": 40,
  "src/story-timeline.ts": 36,
  "src/break-faults.ts": 35,
  "src/SimulationControls.tsx": 21,
  "src/CommerceLesson.tsx": 20,
  "src/ComponentInspector.tsx": 20,
  "src/architecture-view.ts": 19,
  "src/timeline-quick-views.ts": 19,
  "src/ArchitecturePlayback.tsx": 18,
  "src/fault-inspection.ts": 16,
  "src/lesson-topics.ts": 15,
  "src/LessonChooser.tsx": 14,
  "src/ImportedScenario.tsx": 13,
  "src/activity.ts": 9,
  "src/worker/adapter.ts": 9,
  "src/records.ts": 8,
  "src/ExperimentDrawer.tsx": 7,
  "src/review-navigation.ts": 7,
  "src/checkout-display.ts": 6,
  "src/host.ts": 6,
  "src/LessonPanel.tsx": 5,
  "src/DesignChoicesSection.tsx": 3,
  "src/design-step.ts": 3,
  "src/ServiceStateDialog.tsx": 2,
  "src/assessment-runner.ts": 2,
  "src/assessment.ts": 2,
  "src/ui-hint.tsx": 1,
};

test("I18N-AC-8: hard-coded user-visible strings do not grow (scanner budget)", () => {
  const counts = new Map<string, number>();
  for (const item of files().flatMap(scan)) counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
  const over = [...counts].filter(([file, count]) => count > (HARD_CODED_BUDGET[file] ?? 0)).map(([file, count]) => `${file}: ${count} > ${HARD_CODED_BUDGET[file] ?? 0}`);
  assert.deepEqual(over, [], "Move these strings into src/i18n (see ADR-007), or list each remaining one by running tests/i18n-scan.ts");
});
