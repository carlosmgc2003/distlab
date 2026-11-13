import assert from "node:assert/strict";
import test from "node:test";
import { commerceChecks, commerceLessonNames } from "@distlab/catalogs";
import { assessmentDefinitions } from "../../../packages/catalogs/src/commerce/reliable-checkout.ts";
import { checkoutLesson } from "../../../packages/catalogs/src/scenarios.ts";
import { messages } from "../src/i18n/catalog.ts";
import { en as sourceCatalog } from "../src/i18n/en/index.ts";
import { es as spanishCatalog } from "../src/i18n/es/index.ts";
import { checkKey, checkLabel } from "../src/lesson-checks.ts";
import { assessments, lessonDescription, lessonRevisionText, lessonTitle, scenarios } from "../src/scenarios.ts";
import { invariantLabel, requirementText, rowLabel } from "../src/assessment.ts";
import { lessonClassification } from "../src/lesson-topics.ts";
import { lessonTopics } from "../src/lesson-topics.ts";

// ADR-007 section 5: text a lesson author writes in packages/catalogs stays there as the English source.
// The `content` area translates it by stable id, and this test enumerates every id so that a new lesson,
// check, or assessment row cannot ship untranslated, and a renamed id cannot leave a stale translation.

const es = messages("es");
const en = messages("en");
const content = spanishCatalog.content;

/** Every Spanish key of one `content` table must be a real id, and every real id must have an entry. */
function assertCovers(table: string, actual: Readonly<Record<string, string>>, expected: readonly string[]): void {
  const have = Object.keys(actual).sort();
  const want = [...new Set(expected)].sort();
  assert.deepEqual(want.filter(key => !have.includes(key)), [], `${table}: ids with no Spanish entry`);
  assert.deepEqual(have.filter(key => !want.includes(key)), [], `${table}: Spanish entries for ids that do not exist (stale keys)`);
  for (const key of have) assert.ok(actual[key]!.trim().length > 0, `${table}: ${key} is empty`);
}

test("CONTENT-1: every commerce check of every lesson has a Spanish label, keyed by id or lesson/id", () => {
  const keys = commerceLessonNames.flatMap(name => commerceChecks(name).map(check => checkKey(name, check.id)));
  assert.equal(new Set(commerceLessonNames.flatMap(name => commerceChecks(name).map(check => check.id))).size, 37);
  assertCovers("checks", content.checks, keys);
});

test("CONTENT-2: one key never names two different English labels, so no lesson shows another lesson's wording", () => {
  const sources = new Map<string, Set<string>>();
  for (const name of commerceLessonNames) for (const check of commerceChecks(name)) {
    const key = checkKey(name, check.id);
    sources.set(key, (sources.get(key) ?? new Set()).add(check.label));
  }
  for (const [key, labels] of sources) assert.equal(labels.size, 1, `${key} is worded differently in different lessons: add it to lessonSpecificChecks in lesson-checks.ts`);
  const variants = [...sources.keys()].filter(key => key.includes("/"));
  assert.deepEqual(variants.sort(), ["cascade-breaker/dependency-recovered", "dual-write/durable-outbox"]);
});

test("CONTENT-3: both checkout lessons have a Spanish title and explanation", () => {
  const ids = Object.keys(checkoutLesson);
  assertCovers("checkoutTitles", content.checkoutTitles, ids);
  assertCovers("checkoutExplanations", content.checkoutExplanations, ids);
});

test("CONTENT-4: every assessment, requirement, row, and invariant has a Spanish text", () => {
  assertCovers("assessmentTitles", content.assessmentTitles, assessmentDefinitions.map(definition => definition.id));
  assertCovers("assessmentRequirements", content.assessmentRequirements, assessmentDefinitions.flatMap(definition => definition.requirements));
  assertCovers("assessmentRows", content.assessmentRows, assessmentDefinitions.flatMap(definition => definition.rows.map(row => `${definition.id}/${row.id}`)));
  assertCovers("assessmentInvariants", content.assessmentInvariants, assessmentDefinitions.flatMap(definition => definition.invariants.map(invariant => `${definition.id}/${invariant.id}`)));
});

test("CONTENT-5: English renders from the catalog source, Spanish from the translation, and each differs from the other", () => {
  assert.deepEqual(sourceCatalog.content.checks, {});
  for (const name of commerceLessonNames) for (const check of commerceChecks(name)) {
    assert.equal(checkLabel(name, check.id, check.label, en), check.label);
    assert.notEqual(checkLabel(name, check.id, check.label, es), check.label, `${name}/${check.id}`);
  }
  for (const choice of scenarios.filter(item => item.family === "checkout")) {
    assert.equal(lessonTitle(choice, en), checkoutLesson[choice.id as "normal"].title);
    assert.equal(lessonDescription(choice, en), checkoutLesson[choice.id as "normal"].explanation);
    assert.notEqual(lessonTitle(choice, es), lessonTitle(choice, en));
    assert.notEqual(lessonDescription(choice, es), lessonDescription(choice, en));
  }
  for (const choice of assessments) {
    const { definition } = choice;
    for (const row of definition.rows) assert.notEqual(rowLabel(definition, row, es), row.label);
    for (const invariant of definition.invariants) assert.notEqual(invariantLabel(definition, invariant, es), invariant.label);
    for (const line of definition.requirements) assert.notEqual(requirementText(line, es), line);
  }
});

test("CONTENT-6: lesson copy written in apps/web has an entry for every packaged lesson, topic, and concept, and nothing else", () => {
  const lessons = spanishCatalog.lessons;
  assert.deepEqual(Object.keys(lessons.commerce).sort(), [...commerceLessonNames].sort());
  assert.deepEqual(Object.keys(sourceCatalog.lessons.commerce).sort(), [...commerceLessonNames].sort());
  assert.deepEqual(Object.keys(lessons.topics).sort(), lessonTopics.map(topic => topic.id).sort());
  const used = new Set(scenarios.flatMap(choice => lessonClassification(choice.id)?.concepts ?? []));
  assert.equal(used.size, 46);
  assert.deepEqual(Object.keys(lessons.concepts).sort(), [...used].sort(), "every concept is used, and every used concept has a text");
  for (const choice of scenarios.filter(item => item.family === "commerce")) {
    assert.ok(lessonTitle(choice, es).length > 0);
    assert.notEqual(lessonTitle(choice, es), lessonTitle(choice, en), choice.id);
  }
});

test("CONTENT-7: every packaged lesson shows its revision, with the date in the active language", () => {
  for (const choice of scenarios) {
    const { revision, updated } = choice.revision;
    assert.ok(Number.isSafeInteger(revision) && revision >= 1, choice.id);
    assert.equal(lessonRevisionText(choice, en), `Version ${revision} · updated ${en.fmt.date(updated)}`, choice.id);
    assert.equal(lessonRevisionText(choice, es), `Versión ${revision} · actualizada el ${es.fmt.date(updated)}`, choice.id);
    // The date is formatted, never shown as the ISO text the catalog stores.
    assert.ok(!lessonRevisionText(choice, en).includes(updated), choice.id);
  }
  const cqrs = scenarios.find(choice => choice.id === "cqrs-delayed")!;
  assert.equal(lessonRevisionText(cqrs, en), "Version 1 · updated Nov 13, 2026");
  assert.equal(lessonRevisionText(cqrs, es), "Versión 1 · actualizada el 13 nov 2026");
});
