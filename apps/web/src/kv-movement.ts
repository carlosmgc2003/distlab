import type { ArchitectureDefinition, Observation } from "@distlab/contracts";
import { isRecord, payloadVisibility } from "./records.ts";
import { kvServerDescriptor } from "../../../packages/catalogs/src/commerce/descriptors.ts";

/**
 * Key-value movement (RFC 0003 K3), as a model: which stored `kv.*` records
 * become a movement on the graph, and between which nodes. Pure: it reads only
 * stored fields and node identity, and it draws nothing.
 *
 * - A record of a store its service owns is a short `kv` movement from the
 *   owner's node to its satellite, `resource:kv:‹owner›`.
 * - A record of a shared key-value node is no movement: the network request
 *   already moves. The card shows its effect instead.
 * - An expiry is a `no-caller` cue on the store, with no movement.
 */

export type KvCue =
  | {
    readonly kind: "movement";
    readonly recordId: string;
    /** The owning service's node. */
    readonly from: string;
    /** Its key-value satellite node. */
    readonly to: string;
    readonly type: "kv.changed" | "kv.read" | "kv.condition.failed";
    /** The stored operation; a read stores none and is `get`. Absent when not stored. */
    readonly operation?: string;
    /** True for a failed condition. */
    readonly failed: boolean;
  }
  /** The record is shown as the effect on a shared key-value node's card. */
  | { readonly kind: "effect"; readonly recordId: string; readonly node: string }
  /** An expiry: the store removed the key with no caller. */
  | { readonly kind: "no-caller"; readonly recordId: string; readonly node: string };

/** The satellite node of a store its service owns, as the architecture graph names it. */
export function kvSatelliteId(owner: string): string {
  return `resource:kv:${owner}`;
}

/** Whether a component is a shared key-value node: its model is the catalog's key-value server. */
export function isSharedKeyValueNode(component: ArchitectureDefinition["components"][number] | undefined): boolean {
  return component !== undefined && component.model === kvServerDescriptor.model && component.version === kvServerDescriptor.version;
}

/** The cue of one stored record, or undefined when it is not a key-value record. */
export function kvCue(record: Observation, components: ArchitectureDefinition["components"]): KvCue | undefined {
  if (!record.type.startsWith("kv.") || record.source === "simulation") return undefined;
  const owner = record.source;
  const shared = isSharedKeyValueNode(components.find(component => component.id === owner));
  const node = shared ? owner : kvSatelliteId(owner);
  if (record.type === "kv.expired") return { kind: "no-caller", recordId: record.id, node };
  if (record.type !== "kv.changed" && record.type !== "kv.read" && record.type !== "kv.condition.failed") return undefined;
  if (shared) return { kind: "effect", recordId: record.id, node };
  const data = payloadVisibility(record) === "visible" && isRecord(record.data) ? record.data : undefined;
  const stored = typeof data?.operation === "string" ? data.operation : undefined;
  const operation = record.type === "kv.read" ? "get" : stored;
  return {
    kind: "movement", recordId: record.id, from: owner, to: kvSatelliteId(owner), type: record.type,
    ...(operation === undefined ? {} : { operation }), failed: record.type === "kv.condition.failed",
  };
}

/** The cues of every key-value record, in the order given. */
export function kvCues(observations: readonly Observation[], components: ArchitectureDefinition["components"]): readonly KvCue[] {
  return observations.flatMap(record => { const cue = kvCue(record, components); return cue ? [cue] : []; });
}
