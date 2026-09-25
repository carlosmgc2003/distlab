import type { Observation } from "@distlab/contracts";
import { orderObservations } from "./timeline.ts";

export interface LearningTimelineEntry {
  readonly observations: readonly Observation[];
  readonly summary: string;
  readonly collapsed: boolean;
}

/** Groups only contiguous scheduler bookkeeping and identical consecutive assertion results. */
export function learningTimeline(observations: readonly Observation[]): readonly LearningTimelineEntry[] {
  const ordered = orderObservations(observations);
  const firstStartedEvent = ordered.findIndex(observation => observation.type === "simulation.event.started");
  const entries: LearningTimelineEntry[] = [];
  for (let index = 0; index < ordered.length;) {
    const first = ordered[index]!;
    const setup = firstStartedEvent < 0 || index < firstStartedEvent;
    const key = collapseKey(first, setup);
    let end = index + 1;
    if (key !== undefined) {
      while (end < ordered.length && collapseKey(ordered[end]!, firstStartedEvent < 0 || end < firstStartedEvent) === key) end++;
    }
    const group = ordered.slice(index, end);
    const collapsed = key !== undefined && group.length > 1;
    entries.push({
      observations: group,
      summary: collapsed ? summaryFor(first, group.length) : first.type,
      collapsed,
    });
    index = end;
  }
  return entries;
}

function collapseKey(observation: Observation, initialQueueSetup: boolean): string | undefined {
  if (initialQueueSetup && (observation.type === "scheduler.event.scheduled" || observation.type.startsWith("clock."))) return "initial-queue-setup";
  if (observation.type !== "scenario.assertion.evaluated") return undefined;
  const data = observation.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const result = data as Record<string, unknown>;
  if (typeof result.assertionId !== "string" || typeof result.verdict !== "boolean") return undefined;
  return `assertion:${result.assertionId}:${stableValue({ verdict: result.verdict, evidence: result.evidence })}`;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function summaryFor(observation: Observation, count: number): string {
  if (observation.type === "scheduler.event.scheduled") return `Initial engine queue setup × ${count}`;
  const data = observation.data as Record<string, unknown>;
  return `Assertion ${String(data.assertionId)} unchanged × ${count} (${data.verdict ? "pass" : "fail"})`;
}
