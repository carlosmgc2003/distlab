import type { CanonicalValue, Observation } from "@distlab/contracts";
import { isRecord, payloadVisibility } from "./records.ts";
import { writerOf } from "./kv-history.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * What a key-value record did, in words (RFC 0003 K4): a short label for the
 * Story strip and table, the Recorded history row, and the detail heading, and
 * a sentence for the record detail and the playback narration.
 *
 * Every word is chosen by the stored type and stored fields: `operation`,
 * `ifAbsent`, `present`, `after`, `expiresAt`, and, on a failed condition,
 * `actual`. A stored value is printed as stored, and only when it is a string,
 * number, boolean, or null. A redacted or omitted payload adds nothing from the
 * payload: the label falls back to the record type's label and there is no
 * sentence. The writer is the one key history reads (`writerOf`), named by its
 * display name.
 *
 * Pure presentation: it reads no virtual time, imports no runtime module, and
 * sends nothing to the worker.
 */

/** The short label of a key-value record, or undefined when the type's own label applies. */
export function kvLabel(observation: Observation, m: Messages): string | undefined {
  const data = visibleData(observation);
  if (data === undefined) return undefined;
  const labels = m.timeline.kvLabels;
  switch (observation.type) {
    case "kv.changed":
      switch (data.operation) {
        case "set": return data.ifAbsent === true ? labels.setIfAbsent : labels.set;
        case "increment": return labels.increment;
        case "compareAndSet": return labels.compareAndSet;
        case "delete": return labels.delete;
        case "compareAndDelete": return labels.compareAndDelete;
        default: return undefined;
      }
    case "kv.expired": return labels.expired;
    case "kv.read": return data.present === true ? labels.readPresent : data.present === false ? labels.readAbsent : undefined;
    case "kv.condition.failed": return labels.conditionFailed;
    default: return undefined;
  }
}

/**
 * What a key-value record did, as sentences joined with a space, or undefined
 * when the record is not a key-value record, its payload is not visible, or it
 * stores no key or no operation this wording knows. `observations` is the
 * history the record belongs to; only the record its `causationId` names is read.
 */
export function kvSentence(
  observation: Observation,
  observations: readonly Observation[],
  m: Messages,
  names?: ComponentNames,
): string | undefined {
  const data = visibleData(observation);
  const key = typeof data?.key === "string" && data.key.length > 0 ? data.key : undefined;
  if (data === undefined || key === undefined) return undefined;
  const s = m.timeline.kvSentence;
  const who = () => ({ writer: displayName(names, writerOf(observation, causeOf(observation, observations), observation.source)), key });
  const sentences: string[] = [];
  switch (observation.type) {
    case "kv.changed": {
      const after = isRecord(data.after) ? data.after : undefined;
      const value = after?.present === true && Object.hasOwn(after, "value") ? printed(after.value) : undefined;
      switch (data.operation) {
        case "set": sentences.push(data.ifAbsent === true ? s.setIfAbsent(who()) : s.set(who())); break;
        case "increment":
          if (value === undefined) return undefined;
          sentences.push(s.increment({ ...who(), after: value }));
          break;
        case "compareAndSet": sentences.push(s.compareAndSet(who())); break;
        case "delete": sentences.push(s.delete(who())); break;
        case "compareAndDelete": sentences.push(s.compareAndDelete(who())); break;
        default: return undefined;
      }
      if ((data.operation === "set" || data.operation === "compareAndSet") && value !== undefined) sentences.push(s.nowHolds(value));
      if (typeof data.expiresAt === "number") sentences.push(s.expiresAt(data.expiresAt));
      break;
    }
    case "kv.expired":
      sentences.push(s.expired({ key, time: typeof data.expiresAt === "number" ? data.expiresAt : observation.time }), s.lifetimeEnded);
      break;
    case "kv.read": {
      if (data.present === false) { sentences.push(s.readAbsent(who())); break; }
      if (data.present !== true) return undefined;
      sentences.push(s.readPresent(who()));
      const value = Object.hasOwn(data, "value") ? printed(data.value) : undefined;
      if (value !== undefined) sentences.push(s.holds(value));
      break;
    }
    case "kv.condition.failed": {
      switch (data.operation) {
        case "set": sentences.push(s.failedSet(who())); break;
        case "compareAndSet": sentences.push(s.failedCompareAndSet(who())); break;
        case "compareAndDelete": sentences.push(s.failedCompareAndDelete(who())); break;
        default: return undefined;
      }
      // A record from before `actual` was stored (#240) gets the first sentence only.
      const actual = isRecord(data.actual) ? data.actual : undefined;
      if (actual?.present === false) sentences.push(s.wasNotPresent);
      else if (actual?.present === true) {
        const value = Object.hasOwn(actual, "value") ? printed(actual.value) : undefined;
        if (value !== undefined) sentences.push(typeof actual.expiresAt === "number" ? s.heldUntil({ value, time: actual.expiresAt }) : s.held(value));
      }
      break;
    }
    default: return undefined;
  }
  return sentences.join(" ");
}

function visibleData(observation: Observation): Readonly<Record<string, CanonicalValue>> | undefined {
  if (!observation.type.startsWith("kv.") || payloadVisibility(observation) !== "visible" || !isRecord(observation.data)) return undefined;
  return observation.data;
}

/** The record the stored `causationId` names, as the one-entry map `writerOf` reads. */
function causeOf(observation: Observation, observations: readonly Observation[]): ReadonlyMap<string, Observation> {
  const cause = observation.causationId === undefined ? undefined : observations.find(item => item.id === observation.causationId);
  return cause === undefined ? new Map() : new Map([[cause.id, cause]]);
}

/** A stored scalar printed as stored. An object or a list is not printed. */
function printed(value: CanonicalValue | undefined): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
