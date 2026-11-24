import type { CanonicalValue } from "@distlab/contracts";
import type { KeyHistoryReading, KeySegment } from "./kv-history.ts";

/**
 * The difference of two key histories (RFC 0003 K7), for Compare: the run
 * before Compare (`earlier`) against the current one, on one virtual-time axis.
 * Pure: it reads two key histories the main thread already holds, re-runs
 * nothing, and draws nothing.
 *
 * Two segments are equal when they held the same stored value (canonical
 * structural equality, as `KeyValueStore` compares values), started at the same
 * time, and ended at the same time for the same cause. A value that is not
 * visible on either side is compared by time and cause only.
 */

export type CompareSide = "earlier" | "current";

/**
 * Why a segment has no equal on the other side:
 * - `value`: a segment there starts at the same time but held another value;
 * - `end`: a segment there starts at the same time with the same value but ends differently;
 * - `start`: a segment there held the same value and ended the same way but started differently;
 * - `only-here`: nothing there corresponds to it.
 */
export type DifferenceKind = "value" | "start" | "end" | "only-here";

export interface SegmentDifference {
  readonly side: CompareSide;
  /** Index of the segment in that side's `segments`. */
  readonly index: number;
  readonly kind: DifferenceKind;
}

export interface KeyComparison {
  readonly key: string;
  readonly earlier: readonly KeySegment[];
  readonly current: readonly KeySegment[];
  /** Earlier side first, then current, each in segment order. Empty when the key's histories are equal. */
  readonly differences: readonly SegmentDifference[];
}

export interface StoreComparison {
  readonly owner: string;
  /** Keys present on either side, in code-point order. */
  readonly keys: readonly KeyComparison[];
}

export interface HistoryComparison {
  /** Stores of the current history in its order, then stores only the earlier one holds. */
  readonly stores: readonly StoreComparison[];
  /** True when no key has a difference. */
  readonly equal: boolean;
}

/** Compare two key histories, each read to the end of its run. */
export function compareKeyHistories(earlier: KeyHistoryReading, current: KeyHistoryReading): HistoryComparison {
  const owners = [...current.stores.map(store => store.owner), ...earlier.stores.map(store => store.owner).filter(owner => !current.stores.some(store => store.owner === owner))];
  const stores = owners.map((owner): StoreComparison => {
    const before = new Map(earlier.stores.find(store => store.owner === owner)?.keys.map(key => [key.key, key.segments]) ?? []);
    const after = new Map(current.stores.find(store => store.owner === owner)?.keys.map(key => [key.key, key.segments]) ?? []);
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return {
      owner,
      keys: keys.map(key => {
        const left = before.get(key) ?? [];
        const right = after.get(key) ?? [];
        return { key, earlier: left, current: right, differences: [...differences("earlier", left, right), ...differences("current", right, left)] };
      }),
    };
  });
  return { stores, equal: stores.every(store => store.keys.every(key => key.differences.length === 0)) };
}

function differences(side: CompareSide, here: readonly KeySegment[], there: readonly KeySegment[]): SegmentDifference[] {
  const result: SegmentDifference[] = [];
  here.forEach((segment, index) => {
    if (there.some(other => equalSegments(segment, other))) return;
    result.push({ side, index, kind: kindOf(segment, there) });
  });
  return result;
}

function kindOf(segment: KeySegment, there: readonly KeySegment[]): DifferenceKind {
  const sameStart = there.find(other => Number(other.start) === Number(segment.start));
  if (sameStart) return sameValue(segment, sameStart) ? "end" : "value";
  if (there.some(other => sameValue(segment, other) && sameEnd(segment, other))) return "start";
  return "only-here";
}

function equalSegments(a: KeySegment, b: KeySegment): boolean {
  return Number(a.start) === Number(b.start) && sameEnd(a, b) && sameValue(a, b);
}

function sameEnd(a: KeySegment, b: KeySegment): boolean {
  if (a.end === undefined || b.end === undefined) return a.end === b.end;
  return Number(a.end.time) === Number(b.end.time) && a.end.cause === b.end.cause;
}

/** Equal stored values; a value that is not visible on either side matches any value. */
function sameValue(a: KeySegment, b: KeySegment): boolean {
  if (!a.visible || !b.visible) return true;
  return canonical(a.value ?? null) === canonical(b.value ?? null);
}

/** A canonical encoding: object keys in code-point order, so `{ a, b }` and `{ b, a }` are equal. */
function canonical(value: CanonicalValue): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, CanonicalValue>>;
    return `{${Object.keys(record).sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(key => `${JSON.stringify(key)}:${canonical(record[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
