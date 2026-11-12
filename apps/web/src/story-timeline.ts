import type { Observation } from "@distlab/contracts";
import { noteCheckResult, orderObservations, recordKind, recordKinds, repeatsCheckResult, storedQualifier } from "./records.ts";
import type { MilestoneType, RecordKind } from "./records.ts";

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

const KIND_LABELS: Readonly<Record<RecordKind, string>> = {
  request: "Request",
  response: "Response",
  message: "Message",
  retry: "Retry",
  commit: "Transaction commit",
  rollback: "Transaction rollback",
  external: "External effect",
  fault: "Fault",
  drop: "Dropped message",
  timeout: "Timeout",
  failure: "Rejection or failure",
  kv: "Key-value change",
  log: "Business log",
  check: "Check result",
};

/**
 * Wording per milestone type. Typed by `MilestoneType`, so a milestone without
 * a label is a compile error rather than a raw type shown to a student.
 */
const STORY_LABELS: Readonly<Record<MilestoneType, string>> = {
  "network.request.sent": "Request sent",
  "network.request.delivered": "Request delivered",
  "network.request.dropped": "Request dropped",
  "network.request.timedout": "Request timed out",
  "network.response.sent": "Response sent",
  "network.response.received": "Response received",
  "network.response.dropped": "Response dropped",
  "message.published": "Message published",
  "message.delivered": "Message delivered",
  "message.acknowledged": "Message acknowledged",
  "message.ack.stale": "Stale message acknowledgement",
  "message.retry.scheduled": "Message retry scheduled",
  "database.transaction.committed": "Transaction committed",
  "database.transaction.rolledback": "Transaction rolled back",
  "external.effect.committed": "External side effect committed",
  "fault.rule.matched": "Fault rule matched",
  "fault.effect.selected": "Fault effect selected",
  "database.transaction.rejected": "Transaction rejected",
  "service.handler.failed": "Handler failed",
  "message.nacked": "Message rejected (NACK)",
  "message.dead": "Message dead-lettered",
  "kv.condition.failed": "Key-value condition failed",
  "kv.changed": "Key-value entry changed",
  "kv.expired": "Key-value entry expired",
  "runtime.log": "Log",
  "scenario.assertion.evaluated": "Check",
};

/** Wording for a fault record the milestone table does not name individually. */
const OTHER_FAULT_LABEL = "Fault recorded";

export function storyLabel(observation: Observation): string | undefined {
  if (!recordKind(observation)) return undefined;
  const base = (STORY_LABELS as Readonly<Record<string, string | undefined>>)[observation.type] ?? OTHER_FAULT_LABEL;
  return `${base}${storedQualifier(observation)}`;
}

/**
 * Read-only teaching projection of canonical history. Records that are not
 * milestones are not drawn; Observation detail and evidence links still reach
 * them (see `storyTableRows`). A check is drawn for its first result and for
 * each change of its result among the records given, never for an unchanged
 * re-evaluation.
 */
export function storyMilestones(observations: readonly Observation[]): readonly StoryMilestone[] {
  const ordered = orderObservations(observations);
  const milestones: StoryMilestone[] = [];
  const checks = new Map<string, string>();
  for (const observation of ordered) {
    const kind = recordKind(observation);
    const label = kind === undefined ? undefined : storyLabel(observation);
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
const OTHER_CATEGORY = "Other record";

/**
 * The Story table: every milestone, plus the selected record when the current
 * constraints keep it and it is not a milestone. Rows follow recorded sequence.
 */
export function storyTableRows(
  milestones: readonly StoryMilestone[],
  visible: readonly Observation[],
  selectedId: string | null,
): readonly StoryTableRow[] {
  const rows: StoryTableRow[] = milestones.map(milestone => ({
    observation: milestone.observation,
    label: milestone.label,
    kind: milestone.kind,
    shape: milestone.shape,
    categoryLabel: KIND_LABELS[milestone.kind],
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
    categoryLabel: OTHER_CATEGORY,
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
export function storyReduction(milestones: readonly StoryMilestone[], recorded: number): string {
  const shown = `${milestones.length} teaching milestone${milestones.length === 1 ? "" : "s"}`;
  const total = `${recorded} recorded observation${recorded === 1 ? "" : "s"}`;
  return `${shown} from ${total}.`;
}

export function storyLegend(milestones: readonly StoryMilestone[]): readonly StoryLegendEntry[] {
  return recordKinds
    .map(kind => ({
      kind,
      label: KIND_LABELS[kind],
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
): string {
  if (milestones.length === 0) {
    return `No teaching milestones are in the current results. ${storyReduction(milestones, recorded)}`;
  }
  const lanes = storyLanes(milestones).map(lane => labels.get(lane) ?? lane);
  const first = milestones[0]!;
  const last = milestones.at(-1)!;
  return `${storyReduction(milestones, recorded)} `
    + `The strip reads left to right in recorded observation sequence across ${lanes.length} component lane${lanes.length === 1 ? "" : "s"}: ${lanes.join(", ")}. `
    + `The first milestone is recorded at virtual time ${first.observation.time} and the last at virtual time ${last.observation.time}.`;
}

/**
 * Longer text alternative. It states the recorded boundaries, the shapes, and
 * that no elapsed duration or causal order beyond stored sequence is implied.
 */
export function storyDetail(milestones: readonly StoryMilestone[]): string {
  if (milestones.length === 0) return "The Story strip and its table are empty.";
  const boundaries = milestones.filter(milestone => milestone.timeBoundary).length;
  const kinds = storyLegend(milestones).map(entry => `${entry.label} ${entry.count}`).join(", ");
  return `${milestones.length} columns and ${storyLanes(milestones).length} component lanes. `
    + `${boundaries} recorded virtual-time ${boundaries === 1 ? "boundary is" : "boundaries are"} marked, and no elapsed duration between milestones is stored. `
    + `Each milestone is one recorded observation; order is its recorded sequence. `
    + `Stored milestone categories and their shapes: ${kinds}. `
    + `The table repeats the same milestones in the same order and selects the same observations.`;
}
