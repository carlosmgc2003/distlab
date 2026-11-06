/** The part of a packaged lesson the Lesson chooser groups by: its id and the lesson it compares with. */
export interface ComparableLesson {
  readonly id: string;
  /** The lesson Compare loads, or `""` when the lesson has no partner. */
  readonly compare: string;
}

/**
 * Groups lessons by their existing `compare` field, so each failing/fixed pair shares one card.
 *
 * Two lessons share a group when either names the other in `compare`, and the relation is
 * followed transitively: a lesson that compares with a member of a pair joins that pair's group,
 * as the outbox lessons do. A lesson with no partner, or whose partner is not in `lessons`, forms
 * a group on its own. Groups follow the catalog order of their first lesson, and each group keeps
 * catalog order. Every lesson appears in exactly one group. No catalog metadata is added.
 */
export function lessonPairs<T extends ComparableLesson>(lessons: readonly T[]): readonly (readonly T[])[] {
  const index = new Map(lessons.map((lesson, position) => [lesson.id, position]));
  const parent = lessons.map((_, position) => position);
  const root = (position: number): number => {
    let current = position;
    while (parent[current] !== current) current = parent[current]!;
    return current;
  };
  lessons.forEach((lesson, position) => {
    const partner = index.get(lesson.compare);
    if (partner === undefined) return;
    const [left, right] = [root(position), root(partner)];
    // The earlier lesson is the group's root, so a group sorts by its first lesson.
    if (left !== right) parent[Math.max(left, right)] = Math.min(left, right);
  });
  const groups = new Map<number, T[]>();
  lessons.forEach((lesson, position) => {
    const key = root(position);
    const group = groups.get(key);
    if (group) group.push(lesson);
    else groups.set(key, [lesson]);
  });
  return [...groups.values()];
}
