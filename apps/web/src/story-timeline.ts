import type { Observation } from "@distlab/contracts";
import { noteCheckResult, orderObservations, recordKind, recordKinds, repeatsCheckResult, storedQualifier } from "./records.ts";
import type { RecordKind } from "./records.ts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";
import { recordLabel } from "./timeline.ts";

/**
 * Teaching projection of the recorded execution. The milestone set and the
 * teaching category of each record come from the record reading module; only the
 * wording below belongs to this view. Milestone order, identity, lane, and
 * virtual time come only from the stored observations.
 */
export interface StoryMilestone {
  /** The exact canonical observation this milestone projects. */
  readonly observation: Observation;
  readonly kind: RecordKind;
  /** Text describing only the stored type and stored fields. */
  readonly label: string;
  /** Non-color marker that distinguishes the category shape. */
  readonly shape: string;
  /** Component/source lane; never inferred from a link. */
  readonly lane: string;
  /** Position in canonical observation order. */
  readonly column: number;
  /** True when this milestone is recorded at a different virtual time than the previous one. */
  readonly timeBoundary: boolean;
}

export interface StoryLegendEntry {
  readonly kind: RecordKind;
  readonly label: string;
  readonly shape: string;
  readonly count: number;
}

/** Non-color marker per teaching category. */
const SHAPES: Readonly<Record<RecordKind, string>> = {
  request: "→",
  response: "←",
  message: "⇢",
  retry: "↻",
  commit: "✓",
  rollback: "↶",
  external: "◆",
  fault: "⚠",
  drop: "⊘",
  timeout: "◷",
  failure: "✗",
  kv: "▣",
  log: "✎",
  check: "☑",
};

/**
 * Wording per milestone type. The catalog shares the record wording (`timeline.recordLabels`,
 * typed by `MilestoneType`, so a milestone without a label is a compile error) and overrides
 * only the transaction milestones, which the Story view words more briefly.
 */
export function storyLabel(observation: Observation, m: Messages): string | undefined {
  if (!recordKind(observation)) return undefined;
  const override = byCode(m.story.labelOverrides, observation.type);
  return override === undefined ? recordLabel(observation, m) : `${override}${storedQualifier(observation, m)}`;
}

/**
 * Read-only teaching projection of canonical history. Records that are not
 * milestones are not drawn; Observation detail and evidence links still reach
 * them (see `storyTableRows`). A check is drawn for its first result and for
 * each change of its result among the records given, never for an unchanged
 * re-evaluation.
 */
export function storyMilestones(observations: readonly Observation[], m: Messages): readonly StoryMilestone[] {
  const ordered = orderObservations(observations);
  const milestones: StoryMilestone[] = [];
  const checks = new Map<string, string>();
  for (const observation of ordered) {
    const kind = recordKind(observation);
    const label = kind === undefined ? undefined : storyLabel(observation, m);
    if (kind === undefined || label === undefined) continue;
    const repeated = repeatsCheckResult(observation, checks);
    noteCheckResult(observation, checks);
    if (repeated) continue;
    const previous = milestones.at(-1);
    milestones.push({
      observation,
      kind,
      label,
      shape: SHAPES[kind],
      lane: observation.source,
      column: milestones.length,
      timeBoundary: previous === undefined || previous.observation.time !== observation.time,
    });
  }
  return milestones;
}

/**
 * One Story table row. A milestone row projects one milestone. An `other` row is
 * the selected record when it is visible but is not a teaching milestone, such
 * as a check evaluation opened from an evidence link; it is named by its stored
 * type and listed at its recorded sequence.
 */
export interface StoryTableRow {
  readonly observation: Observation;
  readonly label: string;
  /** Teaching category, or `other` for a selected record that is not a milestone. */
  readonly kind: RecordKind | "other";
  readonly shape: string;
  readonly categoryLabel: string;
  readonly timeBoundary: boolean;
}

const OTHER_SHAPE = "•";

/**
 * The Story table: every milestone, plus the selected record when the current
 * constraints keep it and it is not a milestone. Rows follow recorded sequence.
 */
export function storyTableRows(
  milestones: readonly StoryMilestone[],
  visible: readonly Observation[],
  selectedId: string | null,
  m: Messages,
): readonly StoryTableRow[] {
  const rows: StoryTableRow[] = milestones.map(milestone => ({
    observation: milestone.observation,
    label: milestone.label,
    kind: milestone.kind,
    shape: milestone.shape,
    categoryLabel: m.story.kinds[milestone.kind],
    timeBoundary: milestone.timeBoundary,
  }));
  if (selectedId === null || milestones.some(milestone => milestone.observation.id === selectedId)) return rows;
  const selected = visible.find(observation => observation.id === selectedId);
  if (selected === undefined) return rows;
  const at = rows.findIndex(row => row.observation.sequence > selected.sequence);
  const index = at < 0 ? rows.length : at;
  const previous = rows[index - 1];
  const next = rows[index];
  const extra: StoryTableRow = {
    observation: selected,
    label: selected.type,
    kind: "other",
    shape: OTHER_SHAPE,
    categoryLabel: m.story.otherRecord,
    timeBoundary: previous === undefined || previous.observation.time !== selected.time,
  };
  const after = next === undefined ? [] : [{ ...next, timeBoundary: next.observation.time !== selected.time }];
  return [...rows.slice(0, index), extra, ...after, ...rows.slice(index + 1)];
}

/** Lanes in first-recorded-milestone order. Lane identity is the stored source id. */
export function storyLanes(milestones: readonly StoryMilestone[]): readonly string[] {
  const lanes: string[] = [];
  for (const milestone of milestones) if (!lanes.includes(milestone.lane)) lanes.push(milestone.lane);
  return lanes;
}

/** "22 teaching milestones from 266 recorded observations." */
export function storyReduction(milestones: readonly StoryMilestone[], recorded: number, m: Messages): string {
  return m.story.reduction({ milestones: milestones.length, recorded });
}

export function storyLegend(milestones: readonly StoryMilestone[], m: Messages): readonly StoryLegendEntry[] {
  return recordKinds
    .map(kind => ({
      kind,
      label: m.story.kinds[kind],
      shape: SHAPES[kind],
      count: milestones.filter(milestone => milestone.kind === kind).length,
    }))
    .filter(entry => entry.count > 0);
}

/**
 * Short text alternative for the milestone strip: the reduction, the lane order,
 * and the first and last recorded virtual times.
 */
export function storySummary(
  milestones: readonly StoryMilestone[],
  recorded: number,
  labels: ReadonlyMap<string, string>,
  m: Messages,
): string {
  const reduction = storyReduction(milestones, recorded, m);
  if (milestones.length === 0) return m.story.summaryEmpty(reduction);
  const lanes = storyLanes(milestones).map(lane => labels.get(lane) ?? lane);
  const first = milestones[0]!;
  const last = milestones.at(-1)!;
  return m.story.summary({ reduction, lanes, first: first.observation.time, last: last.observation.time });
}

/**
 * Longer text alternative. It states the recorded boundaries, the shapes, and
 * that no elapsed duration or causal order beyond stored sequence is implied.
 */
export function storyDetail(milestones: readonly StoryMilestone[], m: Messages): string {
  if (milestones.length === 0) return m.story.detailEmpty;
  return m.story.detail({
    columns: milestones.length,
    lanes: storyLanes(milestones).length,
    boundaries: milestones.filter(milestone => milestone.timeBoundary).length,
    kinds: storyLegend(milestones, m).map(entry => `${entry.label} ${entry.count}`),
  });
}
