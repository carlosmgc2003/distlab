import assert from "node:assert/strict";
import { test } from "node:test";
import { messages } from "../src/i18n/catalog.ts";

const en = messages("en");
const es = messages("es");

test("the lesson count pluralizes in both languages", () => {
  assert.equal(en.lessonChooser.count({ shown: 1, total: 1 }), "1 lesson");
  assert.equal(en.lessonChooser.count({ shown: 21, total: 21 }), "21 lessons");
  assert.equal(en.lessonChooser.count({ shown: 3, total: 21 }), "3 of 21 lessons");
  assert.equal(es.lessonChooser.count({ shown: 1, total: 1 }), "1 lección");
  assert.equal(es.lessonChooser.count({ shown: 3, total: 21 }), "3 de 21 lecciones");
});

test("the Compare notice is a list of whole clauses", () => {
  const notice = (m: typeof en) => m.app.carry.notice(m.fmt.list([m.app.carry.keptFaults(0), m.app.carry.keptChoices({ text: "timeout=40", count: 1 }), m.app.carry.dropped({ items: ["idempotency"] })]));
  assert.equal(notice(en), "Compare kept 0 student faults, kept timeout=40, and dropped idempotency.");
  assert.equal(notice(es), "Al comparar, se mantuvieron 0 fallas del estudiante, se mantuvo la decisión de diseño timeout=40 y se descartó idempotency.");
  assert.equal(es.app.carry.keptEdits(1), "se mantuvo 1 cambio de diseño");
  assert.equal(es.app.carry.dropped({ items: ["a", "b"] }), "se descartaron a y b");
});

test("student faults and the service state title keep t= as written", () => {
  assert.equal(en.app.studentFaults(1), "1 student fault");
  assert.equal(en.app.studentFaults(2), "2 student faults");
  assert.equal(es.app.studentFaults(2), "2 fallas del estudiante");
  assert.equal(es.serviceState.title(40), "Estado de los servicios en t=40");
});
