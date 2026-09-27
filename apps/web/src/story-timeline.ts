import type { Observation } from "@distlab/contracts";
import { orderObservations } from "./timeline.ts";

/**
 * Teaching categories for the Story view. Every category is a stored record;
 * the projection never invents a milestone, an ordering, or a duration.
 */
export type StoryKind =
  | "request"
  | "response"
  | "message"
  | "retry"
  | "commit"
  | "rollback"
  | "external"
  | "fault"
  | "drop"
  | "timeout";

export interface StoryMilestone {
  /** The exact canonical observation this milestone projects. */
  readonly observation: Observation;
  readonly kind: StoryKind;
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
  readonly kind: StoryKind;
  readonly label: string;
  readonly shape: string;
  readonly count: number;
}

const SHAPES: Readonly<Record<StoryKind, string>> = {
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

const KIND_LABELS: Readonly<Record<StoryKind, string>> = {
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

interface MilestoneCopy {
  readonly kind: StoryKind;
  readonly label: string;
}

/**
 * Read-only teaching projection of canonical history. Milestone order, identity,
 * lane, and virtual time come only from the stored observations. Records that
 * are not listed here stay in Learning and Raw views.
 */
export function storyMilestones(observations: readonly Observation[]): readonly StoryMilestone[] {
  const ordered = orderObservations(observations);
  const milestones: StoryMilestone[] = [];
  for (const observation of ordered) {
    const copy = milestoneCopy(observation);
    if (!copy) continue;
    const previous = milestones.at(-1);
    milestones.push({
      observation,
      kind: copy.kind,
      label: copy.label,
      shape: SHAPES[copy.kind],
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
  return (Object.keys(SHAPES) as readonly StoryKind[])
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

function milestoneCopy(observation: Observation): MilestoneCopy | undefined {
  const type = observation.type;
  switch (type) {
    case "network.request.sent": return { kind: "request", label: "Request sent" };
    case "network.request.delivered": return { kind: "request", label: "Request delivered" };
    case "network.request.dropped": return { kind: "drop", label: "Request dropped" };
    case "network.request.timedout": return { kind: "timeout", label: "Request timed out" };
    case "network.response.sent": return { kind: "response", label: "Response sent" };
    case "network.response.received": return { kind: "response", label: "Response received" };
    case "network.response.dropped": return { kind: "drop", label: "Response dropped" };
    case "message.published": return { kind: "message", label: "Message published" };
    case "message.delivered": return { kind: "message", label: `Message delivered${attemptSuffix(observation)}` };
    case "message.acknowledged": return { kind: "message", label: "Message acknowledged" };
    case "message.ack.stale": return { kind: "message", label: "Stale message acknowledgement" };
    case "message.retry.scheduled": return { kind: "retry", label: "Message retry scheduled" };
    case "database.transaction.committed": return { kind: "commit", label: "Transaction committed" };
    case "database.transaction.rolledback": return { kind: "rollback", label: "Transaction rolled back" };
    case "external.effect.committed": return { kind: "external", label: "External side effect committed" };
    case "fault.effect.selected": return { kind: "fault", label: "Fault effect selected" };
    case "fault.rule.matched": return { kind: "fault", label: "Fault rule matched" };
    default: break;
  }
  if (type.startsWith("fault.")) return { kind: "fault", label: "Fault recorded" };
  return undefined;
}

function attemptSuffix(observation: Observation): string {
  if (!Object.hasOwn(observation, "data") || !isRecord(observation.data)) return "";
  const attempt = observation.data.attempt;
  return typeof attempt === "number" || typeof attempt === "string" ? ` (attempt ${attempt})` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
