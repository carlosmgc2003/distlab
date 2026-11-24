import type { ArchitectureDefinition, CanonicalValue, DatabaseDefinition, Observation, SimulationTime } from "@distlab/contracts";
import { isRecord, orderObservations, recordedChanges } from "./records.ts";
import type { KeyHistoryReading, KeySegment } from "./kv-history.ts";
import type { KeyRoleDeclaration, ModelKeyRoles } from "../../../packages/catalogs/src/commerce/key-roles.ts";

/**
 * Pattern lenses on key history (RFC 0003 K6), read from stored records only.
 * A key's role comes from data-only key roles (`key-roles.ts`): the store
 * owner's model first, then the models of the key's writers. Pure: it reads no
 * virtual time, draws nothing, and sends nothing to the worker.
 *
 * - **Lease**: after a holder's segment ends, the later records in the stored
 *   trace of the record that took the lease are outside the lease.
 * - **Cached copy**: the intervals in which the cached value's compared fields
 *   differ from the committed row, read from the declared initial rows and the
 *   stored commit records of the owner's database.
 * - **Breaker state**: intervals labelled by a stored field of the value.
 */

/** One holder's lease and the records of its trace that came after it ended. */
export interface LeaseOverrun {
  readonly holder: string;
  /** The record that took the lease. */
  readonly acquiredId: string;
  readonly endedAt: SimulationTime;
  /** In record order. */
  readonly recordIds: readonly string[];
}

export interface StaleInterval {
  readonly start: SimulationTime;
  readonly end: SimulationTime;
}

export interface StateInterval {
  readonly start: SimulationTime;
  /** Absent while the last state is still held. */
  readonly end?: SimulationTime;
  /** The stored value of the role's field, as text. */
  readonly label: string;
}

interface LensBase { readonly owner: string; readonly key: string; readonly declaration: KeyRoleDeclaration }
export type KeyLens =
  | LensBase & { readonly role: "lease"; readonly overruns: readonly LeaseOverrun[] }
  | LensBase & { readonly role: "cached-copy"; readonly stale: readonly StaleInterval[] }
  | LensBase & { readonly role: "breaker-state"; readonly states: readonly StateInterval[] }
  /** A role with no lens of its own: it still names what the key is for. */
  | LensBase & { readonly role: "fencing-counter" | "session" | "dedup-marker" | "counter" };

export interface LensInputs {
  /** Key history read to the end of the run. */
  readonly history: KeyHistoryReading;
  readonly observations: readonly Observation[];
  readonly components: ArchitectureDefinition["components"];
  readonly databases: readonly DatabaseDefinition[];
  readonly roles: readonly ModelKeyRoles[];
}

/** One lens per key that has a role, in the key history's order. A key with no matching role yields none. */
export function keyLenses(inputs: LensInputs): readonly KeyLens[] {
  const ordered = orderObservations(inputs.observations);
  const order = new Map(ordered.map((record, index) => [record.id, index]));
  const lenses: KeyLens[] = [];
  for (const store of inputs.history.stores) for (const history of store.keys) {
    const declaration = roleOf(history.key, [store.owner, ...history.segments.map(segment => segment.writer)], inputs.components, inputs.roles);
    if (!declaration) continue;
    const base = { owner: store.owner, key: history.key, declaration };
    switch (declaration.role) {
      case "lease": lenses.push({ ...base, role: "lease", overruns: overruns(history.segments, ordered, order) }); break;
      case "cached-copy": lenses.push({ ...base, role: "cached-copy", stale: stale(history.key, store.owner, history.segments, declaration, ordered, inputs) }); break;
      case "breaker-state": lenses.push({ ...base, role: "breaker-state", states: states(history.segments, declaration.field) }); break;
      default: lenses.push({ ...base, role: declaration.role }); break;
    }
  }
  return lenses;
}

/**
 * The declaration for `key`: the first candidate component whose model declares
 * a matching pattern, and the first matching pattern in that model's list.
 */
export function roleOf(key: string, candidates: readonly string[], components: ArchitectureDefinition["components"], roles: readonly ModelKeyRoles[]): KeyRoleDeclaration | undefined {
  for (const id of new Set(candidates)) {
    const instance = components.find(component => component.id === id);
    const declared = instance && roles.find(item => item.model === instance.model && item.version === instance.version);
    const match = declared?.keys.find(item => matches(item.pattern, key));
    if (match) return match;
  }
  return undefined;
}

function matches(pattern: string, key: string): boolean {
  return pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern;
}

function overruns(segments: readonly KeySegment[], ordered: readonly Observation[], order: ReadonlyMap<string, number>): LeaseOverrun[] {
  const result: LeaseOverrun[] = [];
  for (const segment of segments) {
    if (segment.startId === null || segment.end === undefined) continue;
    const acquired = ordered[order.get(segment.startId) ?? -1];
    const trace = acquired?.traceId;
    if (trace === undefined) continue;
    const end = segment.end;
    // After the end: a later time, or the same time but after the record that ended it.
    const endIndex = end.recordId === null ? undefined : order.get(end.recordId);
    const recordIds = ordered.filter((record, index) => record.traceId === trace && record.id !== end.recordId
      && (Number(record.time) > Number(end.time) || (Number(record.time) === Number(end.time) && endIndex !== undefined && index > endIndex)))
      .map(record => record.id);
    result.push({ holder: segment.writer, acquiredId: segment.startId, endedAt: end.time, recordIds });
  }
  return result;
}

function stale(key: string, owner: string, segments: readonly KeySegment[], declaration: Extract<KeyRoleDeclaration, { role: "cached-copy" }>, ordered: readonly Observation[], inputs: LensInputs): StaleInterval[] {
  const rowKey = key.slice(declaration.pattern.endsWith("*") ? declaration.pattern.length - 1 : key.length);
  // The committed row over time: the declared initial row, then each stored commit of that row.
  const initial = inputs.databases.find(database => database.owner === owner)?.initial[declaration.table]?.[rowKey] as CanonicalValue | undefined;
  const rows: { readonly time: number; readonly value: CanonicalValue | undefined; readonly known: boolean }[] = [{ time: Number.NEGATIVE_INFINITY, value: initial, known: initial !== undefined }];
  for (const record of ordered) {
    if (record.type !== "database.transaction.committed" || record.source !== owner) continue;
    for (const change of recordedChanges(record)) {
      if (change.table !== declaration.table || change.key !== rowKey) continue;
      const after = isRecord(change.after) ? change.after : undefined;
      if (after === undefined) { rows.push({ time: Number(record.time), value: undefined, known: false }); continue; }
      rows.push({ time: Number(record.time), value: after.present === true ? after.value : undefined, known: after.present === true ? Object.hasOwn(after, "value") : true });
    }
  }
  const differs = (cached: CanonicalValue | undefined, row: { readonly value: CanonicalValue | undefined; readonly known: boolean }): boolean => {
    if (!row.known || !isRecord(cached)) return false;
    if (!isRecord(row.value)) return true;
    return declaration.compare.some(field => canonical(cached[field]) !== canonical((row.value as Record<string, CanonicalValue>)[field]));
  };
  const result: StaleInterval[] = [];
  const end = Number(inputs.history.time);
  for (const segment of segments) {
    if (!segment.visible) continue;
    const from = Number(segment.start);
    const to = segment.end === undefined ? end : Number(segment.end.time);
    // Boundaries where the committed row changes inside the segment.
    const cuts = [from, ...rows.map(row => row.time).filter(time => time > from && time < to), to];
    let open: number | undefined;
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const at = cuts[index]!;
      const row = rows.filter(item => item.time <= at).at(-1);
      const isStale = row !== undefined && differs(segment.value, row);
      if (isStale && open === undefined) open = at;
      if (!isStale && open !== undefined) { if (at > open) result.push({ start: open as SimulationTime, end: at as SimulationTime }); open = undefined; }
    }
    if (open !== undefined && to > open) result.push({ start: open as SimulationTime, end: to as SimulationTime });
  }
  return result;
}

function states(segments: readonly KeySegment[], field: string): StateInterval[] {
  const result: { start: SimulationTime; end?: SimulationTime; label: string }[] = [];
  for (const segment of segments) {
    const value = segment.visible && isRecord(segment.value) ? segment.value[field] : undefined;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const label = String(value);
    const last = result.at(-1);
    // A change that keeps the state continues the interval.
    if (last && last.label === label && last.end !== undefined && Number(last.end) === Number(segment.start)) {
      if (segment.end === undefined) delete last.end; else last.end = segment.end.time;
      continue;
    }
    result.push({ start: segment.start, label, ...(segment.end === undefined ? {} : { end: segment.end.time }) });
  }
  return result;
}

function canonical(value: CanonicalValue | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, CanonicalValue>>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
