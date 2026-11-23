# RFC 0003: The keyspace in sight — coordination the student can watch

| Field | Value |
| --- | --- |
| Status | Accepted on 2026-11-23. Every decision is recorded in [Decisions](#decisions). Nothing is built yet. |
| Date | 2026-11-23 |
| Evidence | Recorded runs of the packaged lessons that declare a store, measured in [Problem](#problem) |
| Builds on | [RFC 0002](0002-one-timeline.md): every view here reads the playhead. It amends RFC 0002 P6 for key-value state only. |
| Related issues | Epic #237: K1 #238, K4 #239, K5 #240, K2 #241, K3 #242, K6 #243, K7 #244 and #245. Also #12, #186, #197, #198, #199, #200, #224 |
| Decides | How a student sees what a `KeyValueStore` holds, who changed it, and for how long, at every point of a run. It adds no worker command. K5 changes one observation schema. |

## Summary

The `KeyValueStore` is DistLab's main coordination mechanism: leases, fencing
tokens, cached copies, carts with a lifetime, and circuit-breaker state all
live in one. Today the student barely sees it. The graph draws the store but
never shows an operation reach it, the Service state dialog lists the keys left
at the end of the run, and Recorded history names a change without saying what
changed.

The records already hold almost everything needed: `kv.changed` stores the
operation, the value before and after, and the expiry; `kv.expired` stores the
value that expired; `kv.read` stores whether the key was present and its value;
every one of them stores the `causationId` of the sent request that caused it. This
RFC turns those records into a **key history** (K1) and shows it in three
places that share the RFC 0002 playhead: **key lanes**, a time chart of the
keyspace (K2); the **store card** and key-value movements on the graph (K3);
and Story labels that name the operation (K4). It enriches the one record that
cannot explain itself today (K5), names coordination patterns from data-only
**key roles** (K6), and carries key lanes into Compare and into lessons that
exercise contention (K7).

## Problem

Measured on the recorded runs of the packaged lessons that declare a store
(`npm run --silent lesson -- <name> --json`):

| Lesson | `kv.changed` | `kv.read` | `kv.expired` | `kv.condition.failed` |
| --- | --- | --- | --- | --- |
| `lease-unfenced`, `lease-fenced` | 4 | 2 | 2 | 0 |
| `cache-stale-price` | 3 | 4 | 3 | 0 |
| `cache-invalidated` | 5 | 4 | 3 | 0 |
| `cascade-unprotected` | 96 | 0 | 0 | 0 |
| `cascade-breaker` | 85 | 0 | 0 | 0 |

1. **The graph shows no operation.** `apps/web/src/activity.ts` reads no `kv.*`
   record, and `apps/web/src/flight.ts` moves requests, responses, and messages
   only. A service-owned store (Catalog's prices, Cart's carts, each breaker's
   `dependency`) is a satellite that never moves. In the lease lessons the
   request to the key-value node moves, but what it did to `lock:report` does
   not appear.
2. **State is a flat list, and it is the end of the run.** `CommerceFacts`
   shows `key — value · expires at t` from the final projection (RFC 0002 P6).
   At the end of `lease-unfenced` the store holds only `lock:report:token = 2`:
   the lock expired at t=27. The lesson's central fact — worker-1 held the
   lease from t=2 to t=12, worker-2 from t=17 to t=27, and worker-1's write
   landed at t=36 — is in no panel.
3. **Time-to-live is drawn nowhere.** An entry is a value with a deadline, and
   the deadline is what the lease and cache lessons teach. The gap between the
   end of worker-1's lease (t=12) and its write (t=36) is the whole lease
   lesson; the 100 ms price lifetime is the whole stale-price lesson.
4. **Story names no operation.** A change reads "Key-value entry changed ·
   `lock:report`", with no operation and no before or after. `kv.read` is not a
   milestone, so a cache hit and a cache miss are invisible: in
   `cache-stale-price` the read at t=24 that returns the stale price 1000 is
   not in Story. `kv.condition.failed` is a **failure**, painted as an error,
   although a set-if-absent that finds the lock taken is the lock working.
5. **A failed condition cannot explain itself.** `kv.condition.failed` stores
   only `key` and `operation`. "It failed because worker-1 holds the lease
   until t=12" could only be inferred, and the non-inference rule forbids it.
   No packaged lesson records one yet, so the case has never been shown.
6. **A busy key floods Story.** In the cascade lessons each breaker's
   `dependency` key changes 85 to 96 times; payments moves through `CLOSED`,
   `OPEN`, and `HALF_OPEN`, and Story shows each change as an unnamed row.

## Proposal

### K1. Key history: one pure reading of the stored records

A pure module, `apps/web/src/kv-history.ts`, reads the records at or before
the playhead and each store's declared initial entries, and returns for each
store and key:

- **Segments.** A live value with its start (time and record id), its stored
  `expiresAt` when it has one, the operation that opened it, and what closed it:
  an overwrite, `delete`, `compareAndDelete`, expiry, or nothing yet.
- **Marks.** Reads (hit with the stored value, or miss), failed conditions, and
  expiries, each with its record id.
- **Writer.** The `source` of the record that the KV record's stored
  `causationId` names, when that record is a sent request
  (`network.request.sent`); otherwise the store's owner. In every packaged
  lesson with a store, each `kv.*` record's cause is a sent request. In
  `lease-unfenced` the `set` at t=2 names worker-1's request, so worker-1 is
  the writer without reading the value.
- **The store at the playhead.** The live keys and values at the playhead's
  record.

Rules:

- A value comes from a stored `after`, `before`, or `value` field. Reading a
  stored value is not inference. Nothing else is reconstructed: a redacted,
  summarized, or omitted payload yields a segment whose value is "not
  visible", or, when even the key is not stored, a counted hidden change.
- An entry is absent at and after its stored `expiresAt` (KV-INV-1), even
  before the `kv.expired` record at the same time. A segment ends at its stored
  `expiresAt`, not at the expiry record.
- Initial entries come from the declared `KeyValueDefinition`, which the main
  thread already holds. No packaged lesson declares one today.
- It imports no runtime module and reads no virtual time. It is
  presentation, like `activity.ts`.

This answers RFC 0002 P6 for key-value state, exactly and at once, because
each change stores its before and after. P6 option B stays the answer for all
other component state.

### K2. Key lanes

A time chart of the keyspace. One row per key, grouped by store and then by
prefix (the text before the last `:`); the horizontal axis is virtual time
from the start to the end of the run. Recorded `lease-unfenced`:

```text
t                   0    5    10   15   20   25   30   35
lock:report           ├── worker-1 ──┤⌛      ├── worker-2 ──┤⌛
                      set ✓ t=2      t=12     set ✓ t=17     t=27
lock:report:token        ├─ 1 ─────────────────┼─ 2 ────────────────▶
                         incr t=4              incr t=19
                                     ▲ playhead
```

- A **bar** is a segment, coloured by writer. A segment with an expiry fades
  towards its stored `expiresAt`.
- **Marks:** ✓ a conditional write that succeeded, ✕ a failed condition, ⌛ an
  expiry, and a read drawn filled for a hit and hollow for a miss.
- The **playhead** is a vertical line. Choosing a mark moves the playhead to
  its record by the same transition as an evidence link.
- Each lane has a text equivalent: one sentence per segment and mark, in
  record order, reachable by keyboard.
- Long runs stay one row per key: a breaker's 85 changes are one lane.

The lanes open as a panel in the Architecture tab, from the store node and
from any key-value record, so the graph and the lanes show the same playhead
side by side (decision 5). The panel respects the 1366×768 layout budget
(#166).

### K3. The store on the graph

- **Store card.** A store node or satellite lists the live keys at the
  playhead — the first four, then "and ‹n› more" — each with its value and,
  when it expires, a lifetime bar that shortens as the playhead moves. A key
  that ended at the playhead's record stays one step, faded, with "expired at
  t" or "deleted at t". The card reads K1; it never reads the final projection.
- **Key-value movement.** A key-value record caused inside a service that owns
  its store is a short movement from the owner to its satellite along the
  ownership link, with a glyph per operation (get, set, increment,
  compare-and-set, delete, compare-and-delete) and a shake for a failed
  condition. For a shared key-value node, the request already moves; on
  arrival the card shows the effect, such as "`lock:report` ← worker-1, expires
  t=12".
- **Expiry has no caller.** A `kv.expired` record paints ⌛ on the store with no
  incoming movement, and the narration says that no component removed the key:
  its lifetime ended.
- Narration reads stored fields only, as `flight.ts` does today.

### K4. Story names the operation

- Labels state the writer, the operation, and the change, one message per
  sentence in the catalogs: "worker-1 took `lock:report` with set-if-absent; it
  expires at t=12", "`price:sku-1` read: hit, 1000", "`cart:cart-2` read: not
  present".
- A new milestone category, **contention**, for `kv.condition.failed`, drawn
  in amber. It is not a failure.
- `kv.read` becomes a milestone (decision 4).
- A **Coordination** quick view keeps every `kv.*` record.
- `docs/learning-timeline.md` is the source of truth for the milestone set and
  changes in the same pull request; `apps/web/tests/records.test.ts` enforces
  it.

### K5. A failed condition stores why

`kv.condition.failed` adds two fields, with the presence tags of
`ExpectedValue`:

- `expected`: what the operation required (`{ present: false }` for
  set-if-absent).
- `actual`: what the store held, and its `expiresAt` when the entry has one.

Then "worker-2 could not take `lock:report`: worker-1 holds it until t=12" is
read from stored fields. The schema lives in `docs/spec/kv-store.md`
(*Emitted events*); KV-AC-3 and KV-AC-6 gain the new fields. No packaged lesson
records a failed condition today, so no lesson's recorded run, revision, or
golden digest is expected to change; the pull request verifies it.

### K6. Key roles and pattern lenses

A **key role** is data-only presentation metadata in a model descriptor: a key
pattern (exact, or a prefix ending in `*`) and a role. The descriptor of the
model that chooses the key declares it, so a key gets its role from the
writer that K1 reads. Roles: `lease`, `fencing-counter`, `cached-copy`,
`session`, `breaker-state`, `dedup-marker`, `counter`. A role changes no
semantics and never enters a document, a projection, or history.

Lenses read stored records only:

- **Lease.** After a holder's segment ends, later records in the same stored
  `traceId` as its acquisition are marked "outside the lease". In
  `lease-unfenced`, worker-1's storage commit at t=36 is in the trace of its
  `set` at t=2.
- **Cached copy.** The role names the source table, how the key maps to a row
  key, and the fields to compare. A **stale band** covers the time the cached
  value differs from the committed row, read from stored commit records. In
  `cache-stale-price` the band runs from the price change at t=11 to the end
  of the cached entry, and covers the hit at t=24.
- **Breaker state.** The role names a field of the value (`state`), and the
  lane is coloured by it: `CLOSED`, `OPEN`, `HALF_OPEN`.

### K7. Compare, and lessons that use the lanes

- **Compare.** After Compare, the lanes can overlay the key history of the run
  before Compare, aligned on virtual time, with the segments that differ
  marked. The earlier run's records were already published; nothing is re-run.
- **Contention.** A packaged lesson records at least one failed lock
  acquisition, so K4 and K5 are seen in a lesson.
- Lessons this makes teachable, each a separate issue when wanted: a rate
  limiter (an increment in a window with a lifetime), deduplication across
  consumers (set-if-absent), leader election (a lease renewed by
  compare-and-set), and a timed stock hold.

### Sharing a store

K1 to K7 read `kv.*` records and the store's owner. They do not depend on how
#200 is decided. The shared key-value node of #186 (model A) gives the same
records and the same picture as a first-class store would, so #200 proceeds
with model A (decision 6). If #199 adds a wait on a key, a waiting task is
drawn on the lane it waits for.

## How the guarantees hold

- The worker executes the run exactly as today. No command is added or
  changed.
- K1 to K4, K6, and K7 are presentation over published records. They read
  only stored fields of records at or before the playhead, advance no virtual
  time, record nothing, and send no worker command.
- A value is read from a stored field; a hidden payload is never
  reconstructed.
- Key roles are data in descriptors, which the main thread already imports.
  The worker imports no message catalog.
- K5 changes one observation schema, owned by `docs/spec/kv-store.md`. It
  changes no time, scheduling, ownership, or determinism rule.
- Golden digests and packaged lesson exports change only where K5 or K7 says
  so, and each such pull request states it.

## What changes

Each document changes in the pull request that builds the behavior:

- `docs/spec/architecture-visualization.md`: key history, key lanes, the store
  card, and key-value movement (K1 to K3).
- `docs/learning-timeline.md`: the contention category and `kv.read` as a
  milestone (K4), and the non-inference bullet, which gains "a value stored in
  a record's before or after is read, not inferred" (K1).
- `docs/spec/kv-store.md`: the `kv.condition.failed` schema (K5).
- `docs/ui-visual-system.md`: the contention colour and the key lane symbols.
- `CONTEXT.md`: **key history**, **key lanes**, and **key role**.
- `AGENTS.md`: the paragraph on presentation modules gains `kv-history.ts`.
- `docs/modules/catalogs.md`: key roles in descriptors (K6).

## Order of work

1. K1 (#238). Independent.
2. K4 (#239), after K1, and K5 (#240), independent.
3. K2 (#241), after K1 and the playhead (#224).
4. K3 (#242), after K2.
5. K6 (#243), after K2.
6. K7: Compare (#244) after K2; the contention lesson (#245) after K5.

## Alternatives considered

- **RFC 0002 P6 option B for key-value state.** A second session per playhead
  position. Rejected for the KV: the records already store before and after,
  so K1 is exact without a re-run.
- **A projection field with the store per event boundary** (RFC 0002 P6
  option C). Rejected: a contract change for data the records already hold.
- **A separate workspace tab for the lanes.** Rejected: the student would lose
  the graph while reading the lanes, and both read one playhead.
- **Keep `kv.condition.failed` as a failure.** Rejected: a busy lock is the
  mechanism working, and the colour teaches the opposite.

## Decisions

Taken by the maintainer on 2026-11-23, who accepted every recommendation.
Where a question offered two answers without a recommendation, the row says
which one the RFC records.

| # | Question | Decision |
| --- | --- | --- |
| 1 | K1: is key-value state at the playhead read from stored before and after, instead of RFC 0002 P6 option B? | Yes. It is stated in the specification. |
| 2 | K5: does `kv.condition.failed` store `expected` and `actual`? | Yes. |
| 3 | K4: is a failed condition a new **contention** category instead of a failure? | Yes. |
| 4 | K4: is `kv.read` a milestone always, or only in lessons that declare it? | Always. The milestone set is per stored type, and today only the cache lessons and the key-value node's increment read. |
| 5 | K2: do the lanes get their own workspace tab, or a panel opened from the store? | A panel in the Architecture tab, opened from the store node and from any key-value record. |
| 6 | Does #200 wait for this RFC? | No. #200 proceeds with model A; the views do not depend on it. |

## ADR impact

None. K5 changes an observation schema that `docs/spec/kv-store.md` owns; it
changes no time, scheduling, determinism, delivery, or ownership rule.
