import type { Observation } from "@distlab/contracts";
import { attemptLabel, orderObservations, recordKind, recordKinds } from "./records.ts";
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
};

/** Milestones whose label names a stored delivery attempt. */
const ATTEMPT_MILESTONES: ReadonlySet<string> = new Set(["message.delivered"]);

/** Wording for a fault record the milestone table does not name individually. */
const OTHER_FAULT_LABEL = "Fault recorded";

export function storyLabel(observation: Observation): string | undefined {
  if (!recordKind(observation)) return undefined;
  const base = (STORY_LABELS as Readonly<Record<string, string | undefined>>)[observation.type] ?? OTHER_FAULT_LABEL;
  return ATTEMPT_MILESTONES.has(observation.type) ? `${base}${attemptLabel(observation)}` : base;
}

/**
 * Read-only teaching projection of canonical history. Records that are not
 * milestones stay in Learning and Raw views.
 */
export function storyMilestones(observations: readonly Observation[]): readonly StoryMilestone[] {
  const ordered = orderObservations(observations);
  const milestones: StoryMilestone[] = [];
  for (const observation of ordered) {
    const kind = recordKind(observation);
    const label = kind === undefined ? undefined : storyLabel(observation);
    if (kind === undefined || label === undefined) continue;
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
