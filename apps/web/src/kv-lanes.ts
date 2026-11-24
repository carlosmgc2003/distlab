import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";
import { orderObservations, storedAt } from "./records.ts";
import type { KeyClosing, KeyHistoryReading, KeyOpening, KeySegment } from "./kv-history.ts";

/**
 * Key lanes (RFC 0003 K2): a time chart of the keyspace, as a model. One row
 * per key, grouped by store and by prefix, with bars for the values a key held
 * and marks for what happened to it, positioned on the run's virtual-time axis.
 *
 * It reads the key history (`kv-history.ts`) of the whole run and the stored
 * records, and it draws nothing: no component, CSS, DOM, or catalog message.
 * Wording is the render's job, from the text model. It reads no virtual time
 * and sends nothing to the worker.
 */

/** What a mark on a key's lane records. */
export type LaneMarkKind =
  /** A conditional write that succeeded: a set with stored `ifAbsent`, a compare-and-set, or a compare-and-delete. */
  | "conditional-set"
  | "condition-failed"
  | "expired"
  | "read-hit"
  | "read-miss"
  /** A read whose stored presence is not visible: neither a hit nor a miss is claimed. */
  | "read-hidden";

export interface LaneFade {
  /** Axis fraction where the fade begins: 75% of the bar. */
  readonly start: number;
  /** Axis fraction where it ends: the end of the bar. */
  readonly end: number;
}

/** One value a key held, on the axis. */
export interface LaneBar {
  /** The record that wrote the value, or null for a declared initial entry. */
  readonly recordId: string | null;
  /** Axis fractions, 0 at the run's start and 1 at its end. An open segment ends at 1. */
  readonly start: number;
  readonly end: number;
  readonly writer: string;
  readonly visible: boolean;
  /** The stored value, present only when `visible`. */
  readonly value?: CanonicalValue;
  /** Present when the segment has a stored `expiresAt`. */
  readonly fade?: LaneFade;
  /** Whether the record that wrote the value is at or before the reading position. */
  readonly reached: boolean;
  /** Whether the segment had ended at the reading position. */
  readonly endReached: boolean;
}

export interface LaneMark {
  readonly kind: LaneMarkKind;
  /** Axis fraction. */
  readonly position: number;
  readonly recordId: string;
  /** Whether the record is at or before the reading position. */
  readonly reached: boolean;
}

/** One entry of a lane's text equivalent: codes and stored values only, no wording. */
export type LaneTextItem =
  | {
    readonly kind: "segment";
    readonly recordId: string | null;
    readonly start: SimulationTime;
    readonly opening: KeyOpening;
    /** True when the opening record stored `ifAbsent`. */
    readonly ifAbsent: boolean;
    readonly writer: string;
    readonly visible: boolean;
    readonly value?: CanonicalValue;
    readonly expiresAt?: SimulationTime;
    readonly end?: { readonly time: SimulationTime; readonly cause: KeyClosing };
    readonly reached: boolean;
  }
  | {
    readonly kind: "mark";
    readonly mark: LaneMarkKind;
    readonly recordId: string;
    readonly time: SimulationTime;
    readonly reached: boolean;
  };

export interface LaneRow {
  readonly owner: string;
  readonly key: string;
  readonly bars: readonly LaneBar[];
  /** In record order. */
  readonly marks: readonly LaneMark[];
  /** Segments and marks in record order, initial entries first. */
  readonly text: readonly LaneTextItem[];
}

export interface LanePrefixGroup {
  /** The text before the key's first `:`, or null for a key without one. */
  readonly prefix: string | null;
  /** Rows in key code-point order. */
  readonly rows: readonly LaneRow[];
}

export interface LaneGroup {
  readonly owner: string;
  /** Keys without a prefix first, then prefixes in code-point order. */
  readonly prefixes: readonly LanePrefixGroup[];
  /** Changes recorded without their key, so no lane shows them. */
  readonly hiddenChanges: number;
}

export interface KeyLanes {
  /** One per store, in the key history's order (declared stores in architecture order first). */
  readonly groups: readonly LaneGroup[];
}

export interface LaneAxis {
  readonly start: SimulationTime;
  readonly end: SimulationTime;
}

/**
 * The key lanes of `history`, which should be read to the end of the run, at
 * the record named by `positionId`. `null`, or an id the records do not hold,
 * places the position before the first record: only declared initial entries
 * are reached.
 */
export function keyLanes(history: KeyHistoryReading, observations: readonly Observation[], axis: LaneAxis, positionId: string | null): KeyLanes {
  const ordered = orderObservations(observations);
  const order = new Map(ordered.map((record, index) => [record.id, index]));
  const byId = new Map(ordered.map(record => [record.id, record]));
  const positionIndex = positionId === null ? -1 : order.get(positionId) ?? -1;
  const positionTime = positionIndex < 0 ? Number(axis.start) : Number(ordered[positionIndex]!.time);
  const reached = (recordId: string | null): boolean => recordId === null || (order.get(recordId) ?? Number.POSITIVE_INFINITY) <= positionIndex;
  const rank = (recordId: string | null): number => recordId === null ? -1 : order.get(recordId) ?? Number.POSITIVE_INFINITY;
  const span = Number(axis.end) - Number(axis.start);
  const at = (time: SimulationTime | number): number => span <= 0 ? 0 : Math.min(1, Math.max(0, (Number(time) - Number(axis.start)) / span));
  const ifAbsent = (segment: KeySegment): boolean => {
    const record = segment.startId === null ? undefined : byId.get(segment.startId);
    return record !== undefined && record.type === "kv.changed" && storedAt(record, ["ifAbsent"]) === true;
  };

  return {
    groups: history.stores.map(store => {
      const rows = store.keys.map((history): LaneRow => {
        const bars: LaneBar[] = [];
        const marks: { readonly mark: LaneMark; readonly time: SimulationTime }[] = [];
        const text: { readonly item: LaneTextItem; readonly rank: number }[] = [];
        for (const segment of history.segments) {
          const conditional = ifAbsent(segment);
          const start = at(segment.start);
          const end = segment.end === undefined ? 1 : at(segment.end.time);
          const endReached = segment.end !== undefined && (segment.end.recordId !== null ? reached(segment.end.recordId) : Number(segment.end.time) <= positionTime);
          bars.push({
            recordId: segment.startId, start, end, writer: segment.writer, visible: segment.visible,
            ...(segment.visible ? { value: segment.value } : {}),
            ...(segment.expiresAt === undefined ? {} : { fade: { start: start + 0.75 * (end - start), end } }),
            reached: reached(segment.startId), endReached,
          });
          text.push({ rank: rank(segment.startId), item: {
            kind: "segment", recordId: segment.startId, start: segment.start, opening: segment.opening, ifAbsent: conditional,
            writer: segment.writer, visible: segment.visible, ...(segment.visible ? { value: segment.value } : {}),
            ...(segment.expiresAt === undefined ? {} : { expiresAt: segment.expiresAt }),
            ...(segment.end === undefined ? {} : { end: { time: segment.end.time, cause: segment.end.cause } }),
            reached: reached(segment.startId),
          } });
          if (segment.startId !== null && (conditional || segment.opening === "compareAndSet")) {
            marks.push({ time: segment.start, mark: { kind: "conditional-set", position: start, recordId: segment.startId, reached: reached(segment.startId) } });
          }
          if (segment.end?.cause === "compareAndDelete" && segment.end.recordId !== null) {
            marks.push({ time: segment.end.time, mark: { kind: "conditional-set", position: end, recordId: segment.end.recordId, reached: reached(segment.end.recordId) } });
          }
        }
        for (const mark of history.marks) {
          const kind: LaneMarkKind = mark.kind === "read" ? mark.present === true ? "read-hit" : mark.present === false ? "read-miss" : "read-hidden" : mark.kind;
          marks.push({ time: mark.time, mark: { kind, position: at(mark.time), recordId: mark.recordId, reached: reached(mark.recordId) } });
        }
        marks.sort((a, b) => rank(a.mark.recordId) - rank(b.mark.recordId));
        for (const { mark, time } of marks) {
          text.push({ rank: rank(mark.recordId), item: { kind: "mark", mark: mark.kind, recordId: mark.recordId, time, reached: mark.reached } });
        }
        // Stable: a mark recorded by the same record as a segment's start follows that segment.
        text.sort((a, b) => a.rank - b.rank);
        return { owner: store.owner, key: history.key, bars, marks: marks.map(item => item.mark), text: text.map(item => item.item) };
      });
      const prefixes = new Map<string | null, LaneRow[]>();
      for (const row of rows) {
        const prefix = prefixOf(row.key);
        const list = prefixes.get(prefix);
        if (list) list.push(row); else prefixes.set(prefix, [row]);
      }
      return {
        owner: store.owner,
        hiddenChanges: store.hiddenChanges,
        prefixes: [...prefixes.entries()]
          .sort(([a], [b]) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1)
          .map(([prefix, list]) => ({ prefix, rows: [...list].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) })),
      };
    }),
  };
}

/** The text before a key's first `:`, or null when the key has none or starts with one. */
export function prefixOf(key: string): string | null {
  const index = key.indexOf(":");
  return index > 0 ? key.slice(0, index) : null;
}
