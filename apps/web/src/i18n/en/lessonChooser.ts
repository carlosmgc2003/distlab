import type { Fmt } from "../format.ts";

/** English source messages for the `lessonChooser` area (ADR-007). */
export const lessonChooser = {
  title: "Choose a lesson",
  discardNotice: "Choosing a lesson discards your unapplied design choices and faults.",
  topicGroup: "Topic",
  allTopics: "All topics",
  search: "Search",
  searchPlaceholder: "Concept, pattern, or failure",
  count: (p: { shown: number; total: number }, f: Fmt) =>
    p.shown === p.total
      ? f.plural(p.total, { one: "1 lesson", other: `${f.number(p.total)} lessons` })
      : f.plural(p.total, { one: `${f.number(p.shown)} of 1 lesson`, other: `${f.number(p.shown)} of ${f.number(p.total)} lessons` }),
  topicLessons: (title: string, _f: Fmt) => `${title} lessons`,
  concepts: "Concepts: ",
  loaded: "Loaded",
  empty: "No lesson matches. Clear the search or choose All topics.",
  assessment: "Assessment",
  assessments: "Assessments",
  cancel: "Cancel",
};
