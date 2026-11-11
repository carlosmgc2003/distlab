import assert from "node:assert/strict";
import test from "node:test";
import { lessonPairs } from "../src/lesson-pairs.ts";
import { experimentLabel, scenarios } from "../src/scenarios.ts";
import { groupConcepts, lessonClassification, lessonMatches, lessonTopics, topicSections } from "../src/lesson-topics.ts";

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
  const sections = topicSections(lessonPairs(scenarios));
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
  assert.deepEqual(ids(topicSections(lessonPairs(scenarios), "concurrency")), [["concurrency", [["inventory-oversell", "inventory-optimistic"]]]]);
});

test("search matches concepts, topics, and displayed labels, and keeps a matching group whole", () => {
  const groups = lessonPairs(scenarios);
  // "circuit breaker" is a concept of one lesson only; its unprotected partner stays beside it.
  assert.deepEqual(ids(topicSections(groups, "all", "Circuit  BREAKER")), [["fault-tolerance", [["cascade-unprotected", "cascade-breaker"]]]]);
  // "Normal checkout" is the displayed label, not the catalog title.
  assert.deepEqual(ids(topicSections(groups, "all", "normal checkout", experimentLabel)), [["partial-failure", [["normal", "response-lost"]]]]);
  assert.ok(lessonMatches(scenarios.find(lesson => lesson.id === "cqrs-delayed")!, "eventual replication"));
  assert.deepEqual(topicSections(groups, "concurrency", "saga"), []);
  assert.deepEqual(topicSections(groups, "all", "   ").length, lessonTopics.length);
});

test("a group's concepts are listed once, in lesson order", () => {
  const retry = scenarios.filter(lesson => lesson.id.startsWith("retry-"));
  assert.deepEqual(groupConcepts(retry), ["retry", "duplicate effect", "idempotency key"]);
});
