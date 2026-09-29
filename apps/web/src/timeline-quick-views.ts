import type { Observation } from "@distlab/contracts";
import { orderObservations, recordKind, recordKinds } from "./records.ts";
import type { RecordKind } from "./records.ts";
import type { ComponentTitle } from "./timeline-query.ts";

export type QuickViewId =
  | "key-events"
  | "faults-and-timeouts"
  | "requests-and-responses"
  | "messages"
  | "state-changes"
  | "assertions";

export interface QuickView {
  readonly id: QuickViewId;
  readonly label: string;
  /** Plain sentence naming the stored records this view keeps. It never claims to change a run. */
  readonly keeps: string;
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
    id: "key-events", label: "Key events", keeps: "the teaching milestones of the Story view",
    kinds: recordKinds, types: [],
  },
  {
    id: "faults-and-timeouts", label: "Faults & timeouts", keeps: "fault rules, fault effects, dropped messages, and timeouts",
    kinds: ["fault", "drop", "timeout"], types: [],
  },
  {
    id: "requests-and-responses", label: "Requests & responses", keeps: "recorded network requests and responses, including dropped and timed out ones",
    kinds: ["request", "response", "drop", "timeout"], types: [],
  },
  {
    id: "messages", label: "Messages", keeps: "published, delivered, acknowledged, and retried messages",
    kinds: ["message", "retry"], types: [],
  },
  {
    id: "state-changes", label: "State changes", keeps: "committed and rolled back transactions and committed external effects",
    kinds: ["commit", "rollback", "external"], types: [],
  },
  {
    id: "assertions", label: "Assertions", keeps: "scenario assertion evaluations and their stored verdicts",
    kinds: [], types: ["scenario.assertion.evaluated"],
  },
];

/** Copy shown with every quick view control. It states that views only narrow the display. */
export const QUICK_VIEW_HELP = "Quick views narrow the recorded history; they never change the run.";

export function quickViewById(id: QuickViewId): QuickView {
  const view = QUICK_VIEWS.find(item => item.id === id);
  if (!view) throw new Error(`Unknown quick view: ${id}`);
  return view;
}

export function quickViewLabel(id: QuickViewId): string {
  return quickViewById(id).label;
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

export function quickViewChip(id: QuickViewId): QuickViewChip {
  return { id: "quickView", label: `Quick view ${quickViewLabel(id)}`, removeLabel: `Remove the ${quickViewLabel(id)} quick view` };
}

/** "Faults & timeouts shows 3 of 267 recorded observations." The count is the displayed rows over the recorded total. */
export function quickViewSummary(id: QuickViewId | null, shown: number, recorded: number): string {
  const total = `${recorded} recorded observation${recorded === 1 ? "" : "s"}`;
  if (id === null) return `No quick view is active. Advanced filters show ${shown} of ${total}.`;
  const view = quickViewById(id);
  // With no matching record the empty-state paragraph names the records, so the summary stays short.
  if (shown === 0) return `${view.label} shows 0 of ${total}. This run recorded no ${view.label.toLowerCase()}.`;
  return `${view.label} shows ${shown} of ${total}. It keeps ${view.keeps}.`;
}

/** Live-region copy for a quick view toggle. */
export function quickViewFeedback(id: QuickViewId | null, shown: number, recorded: number): string {
  if (id === null) return `Quick view cleared. All ${recorded} recorded observations are available again.`;
  const view = quickViewById(id);
  return `Quick view ${view.label} applied. It shows ${shown} of ${recorded} recorded observations and changes nothing in the run.`;
}

export function emptyQuickViewExplanation(id: QuickViewId, recorded: number): string {
  const view = quickViewById(id);
  return `The ${view.label} quick view keeps ${view.keeps}, and this run recorded ${recorded} observation${recorded === 1 ? "" : "s"} without any of them. `
    + "Remove the quick view chip to see the recorded history again.";
}

export interface QuickViewReveal {
  readonly id: QuickViewId | null;
  readonly cleared: string;
}

/** Clear the quick view when it hides this stored observation. Other quick views are left alone. */
export function revealQuickView(id: QuickViewId | null, observation: Observation): QuickViewReveal {
  if (id === null || matchesQuickView(id, observation)) return { id, cleared: "" };
  return { id: null, cleared: `${quickViewLabel(id).toLowerCase()} quick view` };
}

export interface ComponentQuickChip {
  readonly value: string;
  /** The recorded component title when the run has one, otherwise its id. The id stays in the accessible name. */
  readonly label: string;
}

/**
 * Recorded components of this snapshot, in label order. The simulation pseudo-component
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
