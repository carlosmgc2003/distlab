# Key-Value Store Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`KeyValueStore` models service-owned ephemeral values and atomic single-key
coordination. It supports caches, carts, counters, deduplication, and lease
experiments independently of database transactions.

## Architectural alignment and decisions

This refines [architecture §18](../architecture.md#18-keyvaluestore) and
[vision §14](../vision.md#14-educational-infrastructure-models).
[ADR-002](adr/002-runtime-model-semantics.md) fixes expiry and crash persistence.
Eviction, persistence to disk, distributed replication, and multi-key operations
are deferred. There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §18: TTL and conditional writes | Operation semantics and errors | KV-AC-1–3 |
| Architecture §38: virtual time | Invariants | KV-AC-2, KV-AC-5 |
| Vision §18: coordination patterns | Minimal examples | KV-AC-3 |

## Public API

Values follow [contracts](contracts.md); duration follows [Virtual Clock](virtual-clock.md).

```ts
interface SetOptions { ttl?: Duration; ifAbsent?: boolean; }
type ExpectedValue =
  | { present: false }
  | { present: true; value: CanonicalValue };
interface KeyValueStore {
  get(key: string): CanonicalValue | undefined;
  set(key: string, value: CanonicalValue, options?: SetOptions): boolean;
  delete(key: string): boolean;
  increment(key: string): number;
  compareAndSet(key: string, expected: ExpectedValue,
    next: CanonicalValue, options?: { ttl?: Duration }): boolean;
}
interface KeyValueDefinition {
  owner: ComponentId;
  initial: readonly { key: string; value: CanonicalValue; ttl?: Duration }[];
}
```

The composition root validates unique nonempty initial keys and values, then
injects owner identity, clock, trusted expiry scheduling, and observations.
Only the assigned service receives the writable store; inspectors receive
detached projections. Initial TTL is relative to run start. Initial expiry work
is scheduled after all registrations, in key order, before scenario actions.

### Operation semantics and errors

All operations run synchronously and atomically inside a live owner task. Keys
are nonempty strings; canonical data is detached. Invalid arguments or foreign
capabilities are terminal `INVALID_KV_OPERATION`, with no mutation. Values may
be null, so absence is represented by undefined on reads and a tagged expected
value for comparison. Comparisons use canonical structural equality.

An entry is logically absent whenever `now >= expiresAt`, irrespective of the
expiry event's position among equal-time events. After validating arguments,
operations first remove any expired entry and emit its expiration once. `get`
returns a detached value or undefined; `delete` returns whether a live entry was
removed. `set` replaces a value unless `ifAbsent` meets a live key. An unsuccessful
conditional write returns false without changing the value or its expiry.

TTL is a positive duration; zero is invalid. Omitted TTL makes set/CAS results
persistent until delete/reset. A successful replacement increments an internal
generation, cancels old expiry work, and schedules the new expiry at `now + ttl`.
Validate time/generation overflow before changing state. Expiry handlers compare
key generation, so an old event cannot delete a newer value. Expiration proceeds
while the owning service is paused, crashed, or stopped.

`increment` treats absence as zero and adds one. Existing values must be safe
integers; invalid type or overflow raises modeled `KV_NOT_INTEGER` or
`KV_COUNTER_OVERFLOW`, preserving the live value. An existing expiry is retained;
a newly created counter has none. `compareAndSet` atomically checks the tagged
expected value and, on success, replaces value/TTL like set. No operation yields
or participates in a database transaction. There is no public cancellation or
configured capacity/eviction policy in this baseline.

## Owned state

Key/value entries, optional absolute expirations, and per-key generations with
expiry handles. The resource outlives a service process: crash/restart preserves
entries while TTL keeps advancing. This permits exercises in persistent
deduplication versus expiring coordination state without treating crash as reset.

Reset reconstructs initial values/relative TTLs and generations from zero and
revokes old capabilities. Serializable projections sort keys and omit handles;
they are not full simulation snapshots. No caller alias reaches stored values.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `kv.read` | Owner read | Key, presence, value when present |
| `kv.changed` | set, delete, increment, or CAS succeeds | Key, operation, before, after, expiry |
| `kv.condition.failed` | Conditional mismatch | Key, operation |
| `kv.expired` | Entry becomes physically removed at expiry | Key, prior value, expiresAt, generation |

The store owns schemas. Before/after values use the same presence tags as
`ExpectedValue`; absent expiry is omitted. Records follow mutation and retain
owner/entity metadata and task correlation. Scheduled expiry preserves the
correlation and cause of the write that set that TTL. Visibility applies to
values, never execution behavior. [Observability](observability.md) owns terminal
sink failure; no recursive append or rollback follows an observation failure.
Inspector reads and playback generate no canonical records.

## Invariants

- **KV-INV-1:** No operation observes a value at or beyond its expiration.
- **KV-INV-2:** Single-key condition and mutation are indivisible.
- **KV-INV-3:** Ownership, detached values, and generations prevent foreign,
  aliased, stale-handle, or obsolete-expiry mutation.

## Explicit non-responsibilities

- Cross-key transactions, database rollback, and automatic cache invalidation.
- Guaranteed distributed locks: a lease can expire while its former holder works.
- Vendor commands, memory pressure, replication, and wall-clock timers.

## Minimal examples

### Expiring deduplication marker

```ts
const accepted = kv.set("message:m1", true, {
  ifAbsent: true, ttl: duration(1000),
});
// accepted=false means a live marker already exists.
```

### Lease ownership check

```ts
const renewed = kv.compareAndSet("lease:sku-1",
  { present: true, value: "worker-a" }, "worker-a", { ttl: duration(50) });
// Expiry or another holder makes renewal fail; external effects need fencing.
```

## Acceptance criteria

- **KV-AC-1:** Construct initial data and exercise get/set/delete/increment;
  absence, null, replacement, preserved counter TTL, and copies follow the API.
- **KV-AC-2:** Reads/writes exactly at expiry see absence in both equal-time
  orders; replacing TTL prevents stale expiry, and each expiration records once.
- **KV-AC-3:** Two tasks competing with ifAbsent/CAS yield one winner; structural
  equality works; failed conditions preserve TTL; expired leases cannot renew.
- **KV-AC-4:** Reject invalid keys/TTL/data and foreign capabilities atomically;
  counter type/overflow failures preserve values; sink failure seals execution.
- **KV-AC-5:** Crash preserves unexpired data, expiry continues, and reset/fresh
  runs match history/state. Old handles fail and no wall-clock APIs are used.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| KV-INV-1 | KV-AC-2, KV-AC-5 |
| KV-INV-2 | KV-AC-1, KV-AC-3 |
| KV-INV-3 | KV-AC-2, KV-AC-4, KV-AC-5 |
| Construction, reset | KV-AC-1, KV-AC-4, KV-AC-5 |
| get, set, delete, increment | KV-AC-1, KV-AC-2, KV-AC-4 |
| compareAndSet | KV-AC-2–4 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Database](database.md), [Service Runtime](service-runtime.md)
