/**
 * JSON values accepted by DistLab's deterministic encoding.
 *
 * Restricted to finite numbers, dense arrays, and plain objects with own
 * enumerable string data properties. Optional fields are absent, not
 * `undefined`. See docs/spec/contracts.md.
 */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };
