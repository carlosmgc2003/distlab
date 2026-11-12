import type { Observation } from "@distlab/contracts";
import { orderObservations, recordKind, recordKinds } from "./records.ts";
import type { RecordKind } from "./records.ts";
import type { ComponentTitle } from "./timeline-query.ts";
import type { Messages } from "./i18n/catalog.ts";

export type QuickViewId =
  | "key-events"
  | "faults-and-timeouts"
  | "requests-and-responses"
  | "messages"
  | "state-changes"
  | "assertions";

/**
 * The predicate of one quick view. Its wording (`label`, and the sentence naming the stored
 * records it keeps, which never claims to change a run) lives in the catalog, by id.
 */
export interface QuickView {
  readonly id: QuickViewId;
  readonly kinds: readonly RecordKind[];
  readonly types: readonly string[];
}

/**
 * Read-only UI predicates over the visible history snapshot. A quick view narrows
 * which recorded observations the timeline displays; it is not an
 * ExecutionHistoryReader filter and never changes the run, virtual time, or history.
 * Categories are the teaching categories of the Story view, so a label means the
 * same thing in both places.
 */
export const QUICK_VIEWS: readonly QuickView[] = [
  {
    id: "key-events",
    kinds: recordKinds, types: [],
  },
  {
    id: "faults-and-timeouts",
    kinds: ["fault", "drop", "timeout"], types: [],
  },
  {
    id: "requests-and-responses",
    kinds: ["request", "response", "drop", "timeout"], types: [],
  },
  {
    id: "messages",
    kinds: ["message", "retry"], types: [],
  },
  {
    id: "state-changes",
    kinds: ["commit", "rollback", "external"], types: [],
  },
  {
    id: "assertions",
    kinds: [], types: ["scenario.assertion.evaluated"],
  },
];

export function quickViewById(id: QuickViewId): QuickView {
  const view = QUICK_VIEWS.find(item => item.id === id);
  if (!view) throw new Error(`Unknown quick view: ${id}`);
  return view;
}

export function quickViewLabel(id: QuickViewId, m: Messages): string {
  return m.timeline.quickView.views[id].label;
}

export function matchesQuickView(id: QuickViewId | null, observation: Observation): boolean {
  if (id === null) return true;
  const view = quickViewById(id);
  if (view.types.includes(observation.type)) return true;
  const kind = recordKind(observation);
  return kind !== undefined && view.kinds.includes(kind);
}

/** Canonical order is preserved. The result is a display projection, not a history export. */
export function quickViewObservations(observations: readonly Observation[], id: QuickViewId | null): readonly Observation[] {
  return id === null ? orderObservations(observations) : orderObservations(observations).filter(observation => matchesQuickView(id, observation));
}

/** How many records of this snapshot each quick view keeps, in declaration order. */
export function quickViewCounts(observations: readonly Observation[]): Readonly<Record<QuickViewId, number>> {
  const ordered = orderObservations(observations);
  const counts = Object.fromEntries(QUICK_VIEWS.map(view => [view.id, 0])) as Record<QuickViewId, number>;
  for (const observation of ordered) {
    for (const view of QUICK_VIEWS) if (matchesQuickView(view.id, observation)) counts[view.id] += 1;
  }
  return counts;
}

export interface QuickViewChip {
  readonly id: "quickView";
  readonly label: string;
  readonly removeLabel: string;
}

export function quickViewChip(id: QuickViewId, m: Messages): QuickViewChip {
  const label = quickViewLabel(id, m);
  return { id: "quickView", label: m.timeline.quickView.chip(label), removeLabel: m.timeline.quickView.removeChip(label) };
}

/** "Faults & timeouts shows 3 of 267 recorded observations." The count is the displayed rows over the recorded total. */
export function quickViewSummary(id: QuickViewId | null, shown: number, recorded: number, m: Messages): string {
  const copy = m.timeline.quickView;
  if (id === null) return copy.summaryNone({ shown, recorded });
  const view = copy.views[id];
  // With no matching record the empty-state paragraph names the records, so the summary stays short.
  if (shown === 0) return copy.summaryNothing({ label: view.label, inline: view.inline, recorded });
  return `${copy.summaryShown({ label: view.label, shown, recorded })} ${view.keeps}`;
}

/** Live-region copy for a quick view toggle. */
export function quickViewFeedback(id: QuickViewId | null, shown: number, recorded: number, m: Messages): string {
  const copy = m.timeline.quickView;
  if (id === null) return copy.feedbackCleared(recorded);
  return copy.feedbackApplied({ label: copy.views[id].label, shown, recorded });
}

export function emptyQuickViewExplanation(id: QuickViewId, recorded: number, m: Messages): string {
  const copy = m.timeline.quickView;
  return `${copy.views[id].empty(recorded)} ${copy.emptyRemove}`;
}

export interface QuickViewReveal {
  readonly id: QuickViewId | null;
  /** The quick view that was cleared because it hid the record, when one was. */
  readonly cleared: QuickViewId | null;
}

/** Clear the quick view when it hides this stored observation. Other quick views are left alone. */
export function revealQuickView(id: QuickViewId | null, observation: Observation): QuickViewReveal {
  if (id === null || matchesQuickView(id, observation)) return { id, cleared: null };
  return { id: null, cleared: id };
}

export interface ComponentQuickChip {
  readonly value: string;
  /** The recorded component title when the run has one, otherwise its id. The id stays in the accessible name. */
  readonly label: string;
}

/**
 * Recorded components of this snapshot, in title order. Titles are scenario data, so the order does not depend on the interface language. The simulation pseudo-component
 * is not offered as a chip; the advanced component field still suggests it.
 */
export function recordedComponentChips(observations: readonly Observation[], titles: readonly ComponentTitle[] = []): readonly ComponentQuickChip[] {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (observation.source.length > 0 && observation.source !== "simulation") ids.add(observation.source);
    if (observation.target !== undefined && observation.target.length > 0) ids.add(observation.target);
  }
  return [...ids]
    .map(value => ({ value, label: titles.find(title => title.id === value)?.title ?? value }))
    .sort((left, right) => left.label < right.label ? -1 : left.label > right.label ? 1 : 0);
}
