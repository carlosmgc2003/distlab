import type { EntityRef, Observation, ObservationFilter, SimulationTime } from "@distlab/contracts";
import { orderObservations } from "../src/records.ts";

/**
 * Reference filter for the query module. This is a second, independent
 * implementation of the AND rules and exists only to cross-check
 * `queryTimeline`; it ships with no production code.
 */

/** Same AND rules as ExecutionHistoryReader.query: inclusive time, exact type, source or target, trace, event, and entity kind plus id. */
export function filterObservations(observations: readonly Observation[], filter: ObservationFilter): readonly Observation[] {
  return orderObservations(observations).filter(record => {
    if (filter.fromTime !== undefined && record.time < filter.fromTime) return false;
    if (filter.toTime !== undefined && record.time > filter.toTime) return false;
    if (filter.type !== undefined && record.type !== filter.type) return false;
    if (filter.component !== undefined && record.source !== filter.component && record.target !== filter.component) return false;
    if (filter.traceId !== undefined && record.traceId !== filter.traceId) return false;
    if (filter.eventId !== undefined && record.eventId !== filter.eventId) return false;
    if (filter.entity !== undefined && !(record.entityRefs ?? []).some(entity => entity.kind === filter.entity!.kind && entity.id === filter.entity!.id)) return false;
    return true;
  });
}

export type FilterParse =
  | { readonly ok: true; readonly filter: ObservationFilter }
  | { readonly ok: false; readonly message: string };

export function parseTimelineFilter(input: {
  readonly fromTime: string;
  readonly toTime: string;
  readonly type: string;
  readonly component: string;
  readonly traceId: string;
  readonly eventId: string;
  readonly entityKind: string;
  readonly entityId: string;
}): FilterParse {
  const from = bound(input.fromTime);
  const to = bound(input.toTime);
  if (from === "invalid" || to === "invalid") return { ok: false, message: "Virtual time filters use whole simulation times." };
  if (from !== undefined && to !== undefined && from > to) return { ok: false, message: "Virtual time from is after virtual time to." };
  const type = text(input.type);
  const component = text(input.component);
  const traceId = text(input.traceId);
  const eventId = text(input.eventId);
  const entityKind = text(input.entityKind);
  const entityId = text(input.entityId);
  if ((entityKind === undefined) !== (entityId === undefined)) return { ok: false, message: "Entity filters need both a kind and an id." };
  const entity: EntityRef | undefined = entityKind !== undefined && entityId !== undefined ? { kind: entityKind, id: entityId } : undefined;
  return {
    ok: true,
    filter: {
      ...(from !== undefined ? { fromTime: from as SimulationTime } : {}),
      ...(to !== undefined ? { toTime: to as SimulationTime } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(component !== undefined ? { component } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(eventId !== undefined ? { eventId } : {}),
      ...(entity !== undefined ? { entity } : {}),
    },
  };
}

function bound(value: string): number | undefined | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return "invalid";
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
