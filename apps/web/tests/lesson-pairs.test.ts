import assert from "node:assert/strict";
import test from "node:test";
import { lessonPairs } from "../src/lesson-pairs.ts";
import { scenarios } from "../src/scenarios.ts";

// #139: the Lesson chooser shows packaged lessons as their failing/fixed pairs.

const ids = (groups: readonly (readonly { readonly id: string }[])[]) => groups.map(group => group.map(lesson => lesson.id));

test("every packaged lesson appears in exactly one group", () => {
  const groups = lessonPairs(scenarios);
  const listed = groups.flat().map(lesson => lesson.id);
  assert.equal(scenarios.length, 23);
  assert.equal(listed.length, scenarios.length);
  assert.deepEqual(new Set(listed), new Set(scenarios.map(lesson => lesson.id)));
});

test("pairs are symmetric: a lesson and the lesson its compare names share a group", () => {
  const groups = lessonPairs(scenarios);
  const groupOf = new Map(groups.flatMap((group, position) => group.map(lesson => [lesson.id, position] as const)));
  for (const lesson of scenarios) {
    if (!lesson.compare) continue;
    assert.equal(groupOf.get(lesson.compare), groupOf.get(lesson.id), `${lesson.id} and ${lesson.compare}`);
  }
});

test("groups keep catalog order, and so do the lessons inside each group", () => {
  const groups = lessonPairs(scenarios);
  const position = new Map(scenarios.map((lesson, index) => [lesson.id, index]));
  const firsts = groups.map(group => position.get(group[0]!.id)!);
  assert.deepEqual(firsts, [...firsts].sort((left, right) => left - right));
  for (const group of groups) {
    const order = group.map(lesson => position.get(lesson.id)!);
    assert.deepEqual(order, [...order].sort((left, right) => left - right));
  }
});

test("the packaged catalog forms its failing/fixed pairs, one outbox group, and one lesson on its own", () => {
  assert.deepEqual(ids(lessonPairs(scenarios)), [
    ["normal", "response-lost"],
    ["retry-unsafe", "retry-idempotent"],
    ["saga-uncompensated", "saga-compensated"],
    ["dual-write", "outbox-unsafe-consumer", "outbox-idempotent", "outbox-notifications-gap"],
    ["cqrs-delayed"],
    ["cascade-unprotected", "cascade-breaker"],
    ["notifications-unbounded", "notifications-dlq"],
    ["cache-stale-price", "cache-invalidated"],
    ["inventory-oversell", "inventory-optimistic"],
    ["lease-unfenced", "lease-fenced"],
    ["clock-last-write-wins", "clock-lamport"],
  ]);
});

test("a lesson with no partner, or a partner outside the list, stands alone; a one-sided compare still pairs", () => {
  assert.deepEqual(ids(lessonPairs([
    { id: "a", compare: "" },
    { id: "b", compare: "missing" },
    { id: "c", compare: "d" },
    { id: "d", compare: "" },
  ])), [["a"], ["b"], ["c", "d"]]);
  // A later lesson naming an earlier one joins the earlier lesson's group in its catalog position.
  assert.deepEqual(ids(lessonPairs([
    { id: "x", compare: "" },
    { id: "y", compare: "" },
    { id: "z", compare: "x" },
  ])), [["x", "z"], ["y"]]);
  assert.deepEqual(lessonPairs([]), []);
});
