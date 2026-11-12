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
  // `content` is the exception: English leaves it empty because lesson-author text renders from packages/catalogs,
  // and tests/content-translations.test.ts checks Spanish against the real catalog ids instead.
  const catalogOnly = (path: string) => !path.startsWith("content.");
  assert.deepEqual(shape(es).filter(catalogOnly), shape(en).filter(catalogOnly));
});

test("I18N-AC-2: Spanish strings are translated, except names and notations that stay as written", () => {
  // Brand and product names, codes, and notation. Add an entry only for text that is the same in both languages.
  const same = new Set(["common.brand",
    // Component names that mirror component IDs, and kernel or protocol terms kept as written (glossary, "Spanish Terms").
    "faultInspection.names.orders", "faultInspection.names.payments", "architecture.resourceKind.kvstore", "playback.fieldLabel.endpoint", "story.kinds.timeout", "app.checkoutName",
    // Pattern names and acronyms that Spanish-speaking engineers use in English (glossary, "Spanish Terms").
    ...["timeout", "dead-letter-queue", "circuit-breaker", "saga", "inbox", "cqrs", "ttl", "lease", "fencing-token", "last-writer-wins", "happens-before"].map(id => `lessons.concepts.${id}`)]);
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
 * I18N-AC-8: no user-visible English outside the catalogs. A new string goes into `src/i18n/`. Run
 * `node --experimental-strip-types tests/i18n-scan.ts <file>` to list what is left.
 */
// Every user-visible string is in the catalogs. Add an entry here only for a reviewed exception, with a comment.
const HARD_CODED_BUDGET: Readonly<Record<string, number>> = {};

test("I18N-AC-8: hard-coded user-visible strings do not grow (scanner budget)", () => {
  const counts = new Map<string, number>();
  for (const item of files().flatMap(scan)) counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
  const over = [...counts].filter(([file, count]) => count > (HARD_CODED_BUDGET[file] ?? 0)).map(([file, count]) => `${file}: ${count} > ${HARD_CODED_BUDGET[file] ?? 0}`);
  assert.deepEqual(over, [], "Move these strings into src/i18n (see ADR-007), or list each remaining one by running tests/i18n-scan.ts");
});

test("I18N-AC-13: an unknown or prototype-named locale falls back to English instead of calling an inherited member", () => {
  for (const name of ["__proto__", "constructor", "toString", "xx"]) {
    const m = messages(name as Parameters<typeof messages>[0]);
    assert.equal(m.locale, "en");
    assert.equal(m.commerceLesson.outcome.pending, messages("en").commerceLesson.outcome.pending);
  }
});

test("I18N-AC-14: English source text without a key is shown as written, and as pseudo text in the pseudo-locale", () => {
  assert.equal(messages("en").source("Charges the order once"), "Charges the order once");
  assert.equal(messages("es").source("Charges the order once"), "Charges the order once");
  assert.match(messages("en-XA").source("Charges the order once"), /^⟦Çhárgéš thé órdér óñçé·+⟧$/);
});
