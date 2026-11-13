import { assessments, scenarios } from "./scenarios.ts";

/**
 * Direct links to a packaged lesson or assessment: `?lesson=<id>` or `?assessment=<id>`.
 * An instructor shares the link, and the student's browser opens on that lesson with no
 * browsing. Opening a link is the same load as choosing the lesson in the Lesson chooser:
 * the exact packaged document, without an overlay. A link never carries an overlay, a seed,
 * or a scenario file. Pure: callers pass the search string and location they read.
 */
export type LessonLinkTarget = { readonly kind: "lesson" | "assessment"; readonly id: string };

/** What a page address asks for: a packaged target, a name no packaged target has, or nothing. */
export type LessonLink = LessonLinkTarget | { readonly kind: "unknown"; readonly value: string } | null;

export const LESSON_PARAM = "lesson";
export const ASSESSMENT_PARAM = "assessment";

/** Reads the lesson link from a `location.search` string. A lesson wins over an assessment when both are given. */
export function readLessonLink(search: string): LessonLink {
  const params = new URLSearchParams(search);
  const lesson = params.get(LESSON_PARAM)?.trim();
  if (lesson) return scenarios.some(item => item.id === lesson) ? { kind: "lesson", id: lesson } : { kind: "unknown", value: lesson };
  const assessment = params.get(ASSESSMENT_PARAM)?.trim();
  if (assessment) return assessments.some(item => item.id === assessment) ? { kind: "assessment", id: assessment } : { kind: "unknown", value: assessment };
  return null;
}

/**
 * The search string for the address bar once `target` is loaded, keeping every other
 * parameter (such as `lang`). `null` removes the lesson link, for an imported scenario file.
 */
export function lessonLinkSearch(search: string, target: LessonLinkTarget | null): string {
  const params = new URLSearchParams(search);
  params.delete(LESSON_PARAM);
  params.delete(ASSESSMENT_PARAM);
  if (target) params.set(target.kind === "lesson" ? LESSON_PARAM : ASSESSMENT_PARAM, target.id);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The link an instructor shares: the page's own address with only the lesson parameter.
 * The interface language is left out, so each student's browser chooses it (ADR-007).
 */
export function lessonLinkUrl(location: { readonly origin: string; readonly pathname: string }, target: LessonLinkTarget): string {
  return `${location.origin}${location.pathname}${lessonLinkSearch("", target)}`;
}
