import type { CanonicalValue, KeyValueDefinition, Observation, SimulationTime } from "@distlab/contracts";
import { isRecord, orderObservations, payloadVisibility } from "./records.ts";

/**
 * Key history (RFC 0003 K1): what each `KeyValueStore` held, who wrote it, and
 * for how long, read only from stored `kv.*` records at or before a position
 * and from each store's declared initial entries.
 *
 * - A value is read from a stored `after` (`kv.changed`), `value` (`kv.read`),
 *   or declared initial entry. Reading a stored value is not inference. A
 *   redacted, summarized, or omitted payload yields a segment whose value is not
 *   visible, or, when even the key is not stored, a counted hidden change.
 * - An entry is absent at and after its stored `expiresAt` (KV-INV-1), even
 *   before the `kv.expired` record at the same time. A segment ends at its stored
 *   `expiresAt`, not at the expiry record.
 * - The writer of a record is the `source` of the record its stored
 *   `causationId` names, when that record is a sent request; otherwise the
 *   store's owner.
 *
 * Pure presentation, like `activity.ts`: it reads no virtual time, imports no
 * runtime module, and sends nothing to the worker.
 */

/** How a segment began: a declared initial entry, or the stored operation that wrote it. */
export type KeyOpening = "initial" | "set" | "increment" | "compareAndSet" | "unknown";

/** How a segment ended. */
export type KeyClosing = "overwrite" | "delete" | "compareAndDelete" | "expired";

export interface KeySegmentEnd {
  readonly time: SimulationTime;
  readonly cause: KeyClosing;
  /**
   * The record that ended the segment. For an expiry it is the `kv.expired`
   * record once that record is read, and null before then: the entry is already
   * absent at its stored `expiresAt`.
   */
  readonly recordId: string | null;
}

/** One value a key held, from the record that wrote it to the record or time that ended it. */
export interface KeySegment {
  readonly key: string;
  /** Whether the value is stored. A value that is not visible is never reconstructed. */
  readonly visible: boolean;
  /** The stored value, present only when `visible`. */
  readonly value?: CanonicalValue;
  readonly start: SimulationTime;
  /** The record that opened the segment, or null for a declared initial entry. */
  readonly startId: string | null;
  readonly opening: KeyOpening;
  /** Component id of the writer (see the module comment). */
  readonly writer: string;
  /** Stored absolute expiry, when the entry has one. */
  readonly expiresAt?: SimulationTime;
  /** Absent while the segment is still live at the position. */
  readonly end?: KeySegmentEnd;
}

/** A recorded event on a key that is not itself a segment. */
export type KeyMark =
  | {
    readonly kind: "read";
    readonly key: string;
    readonly time: SimulationTime;
    readonly recordId: string;
    /** Component id of the reader, by the writer rule. */
    readonly actor: string;
    /** Stored presence: true is a hit, false a miss, absent when not stored. */
    readonly present?: boolean;
    readonly visible: boolean;
    readonly value?: CanonicalValue;
  }
  | {
    readonly kind: "condition-failed";
    readonly key: string;
    readonly time: SimulationTime;
    readonly recordId: string;
    readonly actor: string;
    /** Stored operation whose condition failed, when stored. */
    readonly operation?: string;
  }
  | { readonly kind: "expired"; readonly key: string; readonly time: SimulationTime; readonly recordId: string };

export interface KeyHistory {
  readonly key: string;
  /** In start order. */
  readonly segments: readonly KeySegment[];
  /** In record order. */
  readonly marks: readonly KeyMark[];
}

export interface StoreHistory {
  /** The component that owns the store. */
  readonly owner: string;
  /** Keys in code-point order. */
  readonly keys: readonly KeyHistory[];
  /** Changes whose key is not stored, so they appear in no segment. */
  readonly hiddenChanges: number;
}

export interface KeyHistoryReading {
  /** The record read last, or null before the first record. */
  readonly positionId: string | null;
  /** Stored time of that record, or the run's start time before the first record. */
  readonly time: SimulationTime;
  /** Declared stores in declaration order, then stores that only records name, in record order. */
  readonly stores: readonly StoreHistory[];
}

/** One live entry of a store at the position. */
export interface StoreEntry {
  readonly key: string;
  readonly visible: boolean;
  readonly value?: CanonicalValue;
  readonly expiresAt?: SimulationTime;
  readonly writer: string;
  /** The record that wrote the value, or null for a declared initial entry. */
  readonly startId: string | null;
}

export interface StoreState {
  readonly owner: string;
  /** Live entries in key order. */
  readonly entries: readonly StoreEntry[];
  /** When nonzero, a change was recorded without its key, so the entries may be incomplete. */
  readonly hiddenChanges: number;
}

type MutableSegment = { -readonly [K in keyof KeySegment]: KeySegment[K] };
interface MutableKey { readonly key: string; readonly segments: MutableSegment[]; readonly marks: KeyMark[] }
interface MutableStore { readonly owner: string; readonly keys: Map<string, MutableKey>; hiddenChanges: number }

const OPENINGS: ReadonlySet<string> = new Set(["set", "increment", "compareAndSet"]);

/**
 * The key history of every store at the record named by `positionId`.
 *
 * - `positionId` undefined reads every record: the end of the history.
 * - `positionId` null, or an id this history does not hold, reads no record:
 *   only the declared initial entries, at the run's start time.
 */
export function keyHistory(
  observations: readonly Observation[],
  stores: readonly KeyValueDefinition[],
  startTime: SimulationTime,
  positionId?: string | null,
): KeyHistoryReading {
  const ordered = orderObservations(observations);
  const end = positionId === undefined ? ordered.length - 1 : positionId === null ? -1 : ordered.findIndex(item => item.id === positionId);
  const read = ordered.slice(0, end + 1);

  const owners = new Map<string, MutableStore>();
  const store = (owner: string): MutableStore => {
    let found = owners.get(owner);
    if (!found) owners.set(owner, found = { owner, keys: new Map(), hiddenChanges: 0 });
    return found;
  };
  const entry = (owner: string, key: string): MutableKey => {
    const keys = store(owner).keys;
    let found = keys.get(key);
    if (!found) keys.set(key, found = { key, segments: [], marks: [] });
    return found;
  };

  for (const definition of stores) {
    store(definition.owner);
    for (const initial of definition.initial) {
      const ttl = initial.ttl === undefined ? undefined : Number(initial.ttl);
      entry(definition.owner, initial.key).segments.push({
        key: initial.key, visible: true, value: initial.value, start: startTime, startId: null, opening: "initial", writer: definition.owner,
        ...(ttl === undefined ? {} : { expiresAt: (Number(startTime) + ttl) as SimulationTime }),
      });
    }
  }

  const byId = new Map<string, Observation>();
  for (const record of read) {
    byId.set(record.id, record);
    expireUpTo(owners, record.time);
    if (!record.type.startsWith("kv.") || record.source === "simulation") continue;
    const owner = record.source;
    const target = store(owner);
    const data = payloadVisibility(record) === "visible" && isRecord(record.data) ? record.data : undefined;
    const key = typeof data?.key === "string" && data.key.length > 0 ? data.key : undefined;
    const isChange = record.type === "kv.changed" || record.type === "kv.expired";
    if (key === undefined) {
      if (isChange) target.hiddenChanges += 1;
      continue;
    }
    const history = entry(owner, key);
    const actor = writerOf(record, byId, owner);
    switch (record.type) {
      case "kv.changed": change(history, record, data!, actor); break;
      case "kv.expired": expired(history, record, data!); break;
      case "kv.read": {
        const present = typeof data!.present === "boolean" ? data!.present : undefined;
        const visible = present === true && Object.hasOwn(data!, "value");
        history.marks.push({ kind: "read", key, time: record.time, recordId: record.id, actor, ...(present === undefined ? {} : { present }), visible, ...(visible ? { value: data!.value } : {}) });
        break;
      }
      case "kv.condition.failed": {
        const operation = typeof data!.operation === "string" ? data!.operation : undefined;
        history.marks.push({ kind: "condition-failed", key, time: record.time, recordId: record.id, actor, ...(operation === undefined ? {} : { operation }) });
        break;
      }
      default: break;
    }
  }

  const last = read.at(-1);
  const time = last?.time ?? startTime;
  expireUpTo(owners, time);
  return {
    positionId: last?.id ?? null,
    time,
    stores: [...owners.values()].map(item => ({
      owner: item.owner,
      hiddenChanges: item.hiddenChanges,
      keys: [...item.keys.values()].sort((a, b) => compareKeys(a.key, b.key)).map(history => ({
        key: history.key, segments: history.segments.map(segment => ({ ...segment })), marks: [...history.marks],
      })),
    })),
  };
}

/** Live entries of every store at the reading's position, in key order. */
export function storeAt(reading: KeyHistoryReading): readonly StoreState[] {
  return reading.stores.map(item => ({
    owner: item.owner,
    hiddenChanges: item.hiddenChanges,
    entries: item.keys.flatMap(history => {
      const live = history.segments.find(segment => segment.end === undefined);
      return live ? [{
        key: live.key, visible: live.visible, ...(live.visible ? { value: live.value } : {}),
        ...(live.expiresAt === undefined ? {} : { expiresAt: live.expiresAt }), writer: live.writer, startId: live.startId,
      }] : [];
    }),
  }));
}

/**
 * The component a key-value record acted for: the `source` of the record its
 * stored `causationId` names, when that record is a sent request; otherwise the
 * store's owner. Only records at or before it are consulted.
 */
export function writerOf(record: Observation, byId: ReadonlyMap<string, Observation>, owner: string): string {
  const cause = record.causationId === undefined ? undefined : byId.get(record.causationId);
  return cause?.type === "network.request.sent" ? cause.source : owner;
}

function change(history: MutableKey, record: Observation, data: Readonly<Record<string, CanonicalValue>>, writer: string): void {
  const operation = typeof data.operation === "string" ? data.operation : undefined;
  const after = isRecord(data.after) ? data.after : undefined;
  const removed = after?.present === false || operation === "delete" || operation === "compareAndDelete";
  const open = history.segments.find(segment => segment.end === undefined);
  if (removed) {
    if (open) open.end = { time: record.time, cause: operation === "compareAndDelete" ? "compareAndDelete" : "delete", recordId: record.id };
    return;
  }
  if (open) open.end = { time: record.time, cause: "overwrite", recordId: record.id };
  const visible = after?.present === true && Object.hasOwn(after, "value");
  const expiresAt = typeof data.expiresAt === "number" ? data.expiresAt as SimulationTime : undefined;
  history.segments.push({
    key: history.key, visible, ...(visible ? { value: after!.value } : {}), start: record.time, startId: record.id,
    opening: operation !== undefined && OPENINGS.has(operation) ? operation as KeyOpening : "unknown", writer,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

function expired(history: MutableKey, record: Observation, data: Readonly<Record<string, CanonicalValue>>): void {
  history.marks.push({ kind: "expired", key: history.key, time: record.time, recordId: record.id });
  // The segment already ended at its stored expiry, before this record; name the record that removed it.
  const at = typeof data.expiresAt === "number" ? data.expiresAt : Number(record.time);
  for (let index = history.segments.length - 1; index >= 0; index -= 1) {
    const end = history.segments[index]!.end;
    if (end?.cause === "expired" && end.recordId === null && Number(end.time) === at) {
      history.segments[index]!.end = { ...end, recordId: record.id };
      return;
    }
  }
}

/** End every live segment whose stored expiry is at or before `time` (KV-INV-1). */
function expireUpTo(owners: ReadonlyMap<string, MutableStore>, time: SimulationTime): void {
  for (const item of owners.values()) for (const history of item.keys.values()) for (const segment of history.segments) {
    if (segment.end === undefined && segment.expiresAt !== undefined && segment.expiresAt <= time) {
      segment.end = { time: segment.expiresAt, cause: "expired", recordId: null };
    }
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
