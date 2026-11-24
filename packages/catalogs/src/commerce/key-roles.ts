/**
 * Key roles (RFC 0003 K6): what a key-value key is for, as data-only
 * presentation metadata beside the descriptors. The main thread may import this
 * module. A role changes no semantics and never enters a scenario document, a
 * projection, a worker command, or history. It is not part of `ModelDescriptor`
 * (ADR-005 is unchanged; triage decision in #237).
 */

export type KeyRole = "lease" | "fencing-counter" | "cached-copy" | "session" | "breaker-state" | "dedup-marker" | "counter";

/** One declaration: an exact key, or a prefix ending in `*`. The first match in a model's list wins. */
export type KeyRoleDeclaration =
  | { readonly pattern: string; readonly role: "lease" | "fencing-counter" | "session" | "dedup-marker" | "counter" }
  | {
    readonly pattern: string;
    readonly role: "cached-copy";
    /** The source table in the owning service's database. */
    readonly table: string;
    /** Fields of the cached value compared with the committed row. */
    readonly compare: readonly string[];
  }
  | {
    readonly pattern: string;
    readonly role: "breaker-state";
    /** The field of the stored value that holds the state. */
    readonly field: string;
  };

/** The key roles a model declares, by the model's name and version. */
export interface ModelKeyRoles {
  readonly model: string;
  readonly version: string;
  readonly keys: readonly KeyRoleDeclaration[];
}

/** The version of the commerce descriptors these roles describe (`descriptors.ts`). */
const VERSION = "1.0.0";

/**
 * Model names are literals so this module imports nothing at run time, like the
 * other data-only modules; a test checks that each names a descriptor.
 *
 * For a `cached-copy`, the row key is the part of the key after the pattern's
 * prefix: `price:sku-1` under `price:*` reads row `sku-1`.
 */
export const commerceKeyRoles: readonly ModelKeyRoles[] = [
  { model: "commerce.lease-worker", version: VERSION, keys: [
    { pattern: "lock:report:token", role: "fencing-counter" },
    { pattern: "lock:*", role: "lease" },
  ] },
  { model: "commerce.cache-catalog", version: VERSION, keys: [
    { pattern: "price:*", role: "cached-copy", table: "prices", compare: ["price", "version"] },
  ] },
  { model: "commerce.cache-cart", version: VERSION, keys: [{ pattern: "cart:*", role: "session" }] },
  { model: "commerce.dependency", version: VERSION, keys: [{ pattern: "dependency", role: "breaker-state", field: "state" }] },
];
