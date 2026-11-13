import assert from "node:assert/strict";
import test from "node:test";
import { lessonLinkSearch, lessonLinkUrl, readLessonLink } from "../src/lesson-link.ts";
import { assessments, scenarios } from "../src/scenarios.ts";

// Direct links to a packaged lesson, so an instructor can send students straight to it.

test("every packaged lesson and assessment has a link that reads back as itself", () => {
  for (const lesson of scenarios) {
    const url = new URL(lessonLinkUrl({ origin: "https://example.test", pathname: "/distlab/" }, { kind: "lesson", id: lesson.id }));
    assert.deepEqual(readLessonLink(url.search), { kind: "lesson", id: lesson.id });
  }
  for (const assessment of assessments) {
    const url = new URL(lessonLinkUrl({ origin: "https://example.test", pathname: "/" }, { kind: "assessment", id: assessment.id }));
    assert.deepEqual(readLessonLink(url.search), { kind: "assessment", id: assessment.id });
  }
});

test("the shared link keeps the page path and carries only the lesson, never the interface language", () => {
  assert.equal(lessonLinkUrl({ origin: "https://example.test", pathname: "/distlab/index.html" }, { kind: "lesson", id: "retry-unsafe" }),
    "https://example.test/distlab/index.html?lesson=retry-unsafe");
});

test("an address without a lesson link reads as nothing, and an unknown name is reported as written", () => {
  assert.equal(readLessonLink(""), null);
  assert.equal(readLessonLink("?lang=es"), null);
  assert.equal(readLessonLink("?lesson="), null);
  assert.deepEqual(readLessonLink("?lesson=%20retry-unsafe%20"), { kind: "lesson", id: "retry-unsafe" });
  assert.deepEqual(readLessonLink("?lesson=no-such-lesson"), { kind: "unknown", value: "no-such-lesson" });
  assert.deepEqual(readLessonLink("?assessment=no-such-assessment"), { kind: "unknown", value: "no-such-assessment" });
  // An assessment id is not a lesson id: each parameter names its own kind.
  assert.deepEqual(readLessonLink("?lesson=reliable-checkout"), { kind: "unknown", value: "reliable-checkout" });
  assert.deepEqual(readLessonLink("?lesson=retry-unsafe&assessment=reliable-checkout"), { kind: "lesson", id: "retry-unsafe" });
});

test("the address bar names the loaded target and keeps every other parameter", () => {
  assert.equal(lessonLinkSearch("", { kind: "lesson", id: "cache-stale-price" }), "?lesson=cache-stale-price");
  assert.equal(lessonLinkSearch("?lang=es&lesson=retry-unsafe", { kind: "lesson", id: "retry-idempotent" }), "?lang=es&lesson=retry-idempotent");
  assert.equal(lessonLinkSearch("?lesson=retry-unsafe", { kind: "assessment", id: "reliable-checkout" }), "?assessment=reliable-checkout");
  // An imported scenario file has no link: the lesson parameter is removed.
  assert.equal(lessonLinkSearch("?lesson=retry-unsafe&lang=es", null), "?lang=es");
  assert.equal(lessonLinkSearch("?assessment=reliable-checkout", null), "");
});
