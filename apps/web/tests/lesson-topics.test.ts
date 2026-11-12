import assert from "node:assert/strict";
import test from "node:test";
import { lessonPairs } from "../src/lesson-pairs.ts";
import { messages } from "../src/i18n/catalog.ts";
import { scenarios } from "../src/scenarios.ts";
import { groupConcepts, lessonClassification, lessonMatches, lessonTopics, topicSections } from "../src/lesson-topics.ts";

const en = messages("en");
const es = messages("es");

// The Lesson chooser sorts the failing/fixed pairs into distributed-systems topics.

const ids = (sections: ReturnType<typeof topicSections<(typeof scenarios)[number]>>) =>
  sections.map(section => [section.topic.id, section.groups.map(group => group.map(lesson => lesson.id))] as const);

test("every packaged lesson has one topic, and the lessons of a group share it", () => {
  for (const lesson of scenarios) assert.ok(lessonClassification(lesson.id), lesson.id);
  for (const group of lessonPairs(scenarios)) {
    const topics = new Set(group.map(lesson => lessonClassification(lesson.id)?.topic));
    assert.equal(topics.size, 1, group.map(lesson => lesson.id).join(", "));
  }
});

test("with no filter every group appears once, under its topic, in topic order", () => {
  const sections = topicSections(lessonPairs(scenarios), "all", "", en);
  assert.deepEqual(sections.map(section => section.topic.id), lessonTopics.map(topic => topic.id));
  const listed = sections.flatMap(section => section.groups.flat().map(lesson => lesson.id));
  assert.equal(listed.length, scenarios.length);
  assert.deepEqual(new Set(listed), new Set(scenarios.map(lesson => lesson.id)));
  assert.deepEqual(ids(sections), [
    ["partial-failure", [["normal", "response-lost"], ["retry-unsafe", "retry-idempotent"]]],
    ["fault-tolerance", [["cascade-unprotected", "cascade-breaker"], ["notifications-unbounded", "notifications-dlq"]]],
    ["transactions", [["saga-uncompensated", "saga-compensated"], ["dual-write", "outbox-unsafe-consumer", "outbox-idempotent", "outbox-notifications-gap"]]],
    ["consistency", [["cqrs-delayed"], ["cache-stale-price", "cache-invalidated"]]],
    ["concurrency", [["inventory-oversell", "inventory-optimistic"]]],
    ["time-coordination", [["lease-unfenced", "lease-fenced"], ["clock-last-write-wins", "clock-lamport"]]],
  ]);
});

test("a topic filter keeps only that topic's section", () => {
  assert.deepEqual(ids(topicSections(lessonPairs(scenarios), "concurrency", "", en)), [["concurrency", [["inventory-oversell", "inventory-optimistic"]]]]);
});

test("search matches concepts, topics, and displayed labels, and keeps a matching group whole", () => {
  const groups = lessonPairs(scenarios);
  // "circuit breaker" is a concept of one lesson only; its unprotected partner stays beside it.
  assert.deepEqual(ids(topicSections(groups, "all", "Circuit  BREAKER", en)), [["fault-tolerance", [["cascade-unprotected", "cascade-breaker"]]]]);
  // "Normal checkout" is the displayed label, not the catalog title.
  assert.deepEqual(ids(topicSections(groups, "all", "normal checkout", en)), [["partial-failure", [["normal", "response-lost"]]]]);
  assert.ok(lessonMatches(scenarios.find(lesson => lesson.id === "cqrs-delayed")!, "eventual replication", en));
  assert.deepEqual(topicSections(groups, "concurrency", "saga", en), []);
  assert.deepEqual(topicSections(groups, "all", "   ", en).length, lessonTopics.length);
});

test("a group's concepts are listed once, in lesson order", () => {
  const retry = scenarios.filter(lesson => lesson.id.startsWith("retry-"));
  assert.deepEqual(groupConcepts(retry, en), ["retry", "duplicate effect", "idempotency key"]);
});

test("a group's concepts and the topic words follow the active language", () => {
  const retry = scenarios.filter(lesson => lesson.id.startsWith("retry-"));
  assert.deepEqual(groupConcepts(retry, es), ["reintento", "efecto duplicado", "clave de idempotencia"]);
  const [first] = topicSections(lessonPairs(scenarios), "all", "", es);
  assert.equal(first!.topic.title, "Falla parcial e idempotencia");
});

test("search matches the active language and English, ignoring case, accents, and spacing (ADR-007)", () => {
  const retry = scenarios.find(lesson => lesson.id === "retry-idempotent")!;
  // The Spanish word and the English bibliography term both find the retry lesson in Spanish.
  assert.ok(lessonMatches(retry, "idempotencia", es));
  assert.ok(lessonMatches(retry, "idempotency", es));
  assert.ok(lessonMatches(retry, "IDEMPOTENCIA   Reintento", es));
  // Spanish words find nothing in English, which does not know them.
  assert.ok(!lessonMatches(retry, "idempotencia", en));
  assert.ok(lessonMatches(retry, "idempotency", en));
  // Accents are optional: "cache" finds a lesson whose Spanish concept is "caché".
  const cache = scenarios.find(lesson => lesson.id === "cache-stale-price")!;
  assert.ok(lessonMatches(cache, "cache", es));
  assert.ok(lessonMatches(cache, "caché", es));
  assert.ok(!lessonMatches(cache, "idempotencia", es));
  // "idempotente" (the consumer in the Outbox lessons) is a different word from "idempotencia", in either language.
  assert.deepEqual(ids(topicSections(lessonPairs(scenarios), "all", "idempotencia", es)).map(([topic]) => topic), ["partial-failure"]);
  assert.deepEqual(ids(topicSections(lessonPairs(scenarios), "all", "idempotente", es)).map(([topic]) => topic), ["transactions"]);
  assert.deepEqual(ids(topicSections(lessonPairs(scenarios), "all", "idempot", es)).map(([topic]) => topic), ["partial-failure", "transactions"]);
});
