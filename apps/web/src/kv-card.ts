import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";
import { isRecord, payloadVisibility } from "./records.ts";
import { writerOf } from "./kv-history.ts";
import type { KeyHistoryReading } from "./kv-history.ts";

/**
 * The store card (RFC 0003 K3): what a store shows on the graph at a position,
 * as a model. It reads the key history read at that position and the stored
 * records, and it draws nothing and holds no wording. Pure: no virtual time, no
 * DOM, no worker command.
 */

/** How many live entries a card lists before it counts the rest. */
export const CARD_ENTRIES = 4;

export interface CardEntry {
  readonly key: string;
  readonly visible: boolean;
  readonly value?: CanonicalValue;
  readonly writer: string;
  readonly expiresAt?: SimulationTime;
  /**
   * For an entry with a stored expiry, the share of its lifetime left at the
   * position: `(expiresAt − now) / (expiresAt − start)`, where `now` is the
   * stored time of the record at the position.
   */
  readonly remaining?: number;
}

/** An entry whose segment ended at exactly the record at the position. An overwrite leaves the key live and is not listed. */
export interface CardEnded {
  readonly key: string;
  readonly cause: "expired" | "deleted" | "compareAndDelete";
  readonly time: SimulationTime;
}

/** What the record at the position did to this store. */
export interface CardEffect {
  readonly type: "kv.changed" | "kv.read" | "kv.condition.failed" | "kv.expired";
  readonly key: string;
  /** The stored operation, when stored. */
  readonly operation?: string;
  /** Who the record acted for, by the key-history writer rule; absent for an expiry, which has no caller. */
  readonly writer?: string;
}

export interface StoreCard {
  readonly owner: string;
  /** The first `CARD_ENTRIES` live entries in key order. */
  readonly shown: readonly CardEntry[];
  /** How many more live entries the card does not list. */
  readonly more: number;
  readonly ended: readonly CardEnded[];
  readonly effect?: CardEffect;
  /** Changes recorded without their key, so the entries may be incomplete. */
  readonly hiddenChanges: number;
}

const EFFECT_TYPES: ReadonlySet<string> = new Set(["kv.changed", "kv.read", "kv.condition.failed", "kv.expired"]);

/**
 * One card per store, from `reading`, the key history read at the position.
 * `observations` are the stored records, used only to read the record at the
 * position and its cause.
 */
export function storeCards(reading: KeyHistoryReading, observations: readonly Observation[]): readonly StoreCard[] {
  const now = Number(reading.time);
  const byId = new Map(observations.map(record => [record.id, record]));
  const position = reading.positionId === null ? undefined : byId.get(reading.positionId);
  return reading.stores.map(store => {
    const live: CardEntry[] = [];
    const ended: CardEnded[] = [];
    for (const history of store.keys) {
      for (const segment of history.segments) {
        if (segment.end === undefined) {
          const expiresAt = segment.expiresAt;
          const lifetime = expiresAt === undefined ? 0 : Number(expiresAt) - Number(segment.start);
          live.push({
            key: segment.key, visible: segment.visible, ...(segment.visible ? { value: segment.value } : {}), writer: segment.writer,
            ...(expiresAt === undefined ? {} : { expiresAt, remaining: lifetime <= 0 ? 0 : Math.max(0, Math.min(1, (Number(expiresAt) - now) / lifetime)) }),
          });
        } else if (reading.positionId !== null && segment.end.recordId === reading.positionId && segment.end.cause !== "overwrite") {
          ended.push({ key: segment.key, cause: segment.end.cause === "delete" ? "deleted" : segment.end.cause, time: segment.end.time });
        }
      }
    }
    const effect = position && position.source === store.owner ? effectOf(position, byId, store.owner) : undefined;
    return {
      owner: store.owner, shown: live.slice(0, CARD_ENTRIES), more: Math.max(0, live.length - CARD_ENTRIES), ended,
      ...(effect ? { effect } : {}), hiddenChanges: store.hiddenChanges,
    };
  });
}

function effectOf(record: Observation, byId: ReadonlyMap<string, Observation>, owner: string): CardEffect | undefined {
  if (!EFFECT_TYPES.has(record.type) || payloadVisibility(record) !== "visible" || !isRecord(record.data)) return undefined;
  const key = record.data.key;
  if (typeof key !== "string" || key.length === 0) return undefined;
  const operation = typeof record.data.operation === "string" ? record.data.operation : undefined;
  return {
    type: record.type as CardEffect["type"], key, ...(operation === undefined ? {} : { operation }),
    ...(record.type === "kv.expired" ? {} : { writer: writerOf(record, byId, owner) }),
  };
}
