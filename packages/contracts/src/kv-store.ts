import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { Duration } from "./kernel/time.js";

export const KeyValueObservationTypes = {
  Read: "kv.read",
  Changed: "kv.changed",
  ConditionFailed: "kv.condition.failed",
  Expired: "kv.expired",
} as const;

export interface SetOptions {
  readonly ttl?: Duration;
  readonly ifAbsent?: boolean;
}

export type ExpectedValue =
  | { readonly present: false }
  | { readonly present: true; readonly value: CanonicalValue };

export interface KeyValueDefinition {
  readonly owner: ComponentId;
  readonly initial: readonly {
    readonly key: string;
    readonly value: CanonicalValue;
    readonly ttl?: Duration;
  }[];
}

/**
 * Service-owned ephemeral store. Operations are synchronous and atomic per
 * key. An entry is absent whenever `now >= expiresAt`, including before a
 * same-time expiry handler runs. TTL, if present, must be positive.
 */
export interface KeyValueStore {
  get(key: string): CanonicalValue | undefined;
  set(key: string, value: CanonicalValue, options?: SetOptions): boolean;
  delete(key: string): boolean;
  increment(key: string): number;
  compareAndSet(
    key: string,
    expected: ExpectedValue,
    next: CanonicalValue,
    options?: { readonly ttl?: Duration },
  ): boolean;
}
