# Database Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`Database` owns one internal service's persistent tables and atomic local
transactions. Persistence means surviving modeled service crashes, not browser
shutdown. It makes races, constraints, rollback, inbox, and outbox inspectable.

## Architectural alignment and decisions

This refines [architecture §§16–17](../architecture.md#16-database) and
[vision §11](../vision.md#11-core-learning-goals). Explicit transaction handles
replace the conceptual callback API so controlled tasks may suspend between
reads and commit. [ADR-002](adr/002-runtime-model-semantics.md) specifies coarse
optimistic conflict detection. SQL, replication, and cross-resource transactions
are deferred; there are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §16: local atomic commit | Operation semantics and errors | DB-AC-1–3 |
| Architecture §17: ownership | Public API | DB-AC-4 |
| Vision §11: no global rollback | Owned state | DB-AC-5 |

## Public API

Values and errors follow [shared contracts](contracts.md).

```ts
type DatabaseRow = Readonly<Record<string, CanonicalValue>>;
interface TableDefinition {
  name: string;
  unique: readonly (readonly string[])[];
  checks: readonly string[];
}
interface DatabaseDefinition {
  owner: ComponentId;
  tables: readonly TableDefinition[];
  initial: Readonly<Record<string, Readonly<Record<string, DatabaseRow>>>>;
}
interface Transaction {
  readonly id: string;
  get(table: string, key: string): DatabaseRow | undefined;
  scan(table: string): readonly { key: string; row: DatabaseRow }[];
  insert(table: string, key: string, row: DatabaseRow): void;
  update(table: string, key: string, row: DatabaseRow): void;
  delete(table: string, key: string): boolean;
  commit(): ControlledOperation;
  rollback(): void;
}
interface Database {
  begin(): Transaction;
}
```

The root constructs a database from its definition, registered pure check
predicates, owner/task identity ports, clock, scheduler, operation controller,
observation sink, and the [fault decision port](fault-engine.md). Check IDs
resolve to versioned catalog predicates
`(row: DatabaseRow) => boolean`; functions never enter normalized inputs.
Validate unique table names, nonempty keys/field names, constraint references,
canonical rows, and initial constraints before returning a database.
Only the assigned internal service receives its `Database`. Inspectors receive
detached committed-state projections, never writable handles.

### Operation semantics and errors

`begin` is legal in a running service task and copies the committed database and
revision into a private snapshot. One open transaction per task is allowed.
Transaction IDs use a per-database safe-integer counter, starting at zero and
prefixed by owner/database identity. Overflow is terminal before allocation.

Reads use the snapshot plus staged writes; scan sorts keys by UTF-16 code units.
Insert requires an absent key, update replaces a complete existing row, and
delete returns false for absence. Values are detached on write and read.
Invalid tables/keys/rows and foreign or closed handles are terminal
`INVALID_DATABASE_OPERATION`. Duplicate insert and missing update are modeled
`ROW_EXISTS` and `ROW_NOT_FOUND` errors thrown synchronously, with no mutation;
the caller may catch them within its controlled task.

`commit` seals the handle against further edits, allocates an operation, and
schedules a completion at the current time. The task must yield it. At dispatch,
evaluate the database.commit fault point; an injected failure closes/discards
the transaction, records rejection, and settles modeled `COMMIT_FAILED` without
changing committed state. Otherwise compare the committed revision with the begin
revision. Any intervening write commit causes modeled `TRANSACTION_CONFLICT`,
including unrelated-row changes.
Otherwise validate all unique constraints and row checks over the candidate
state. Missing unique fields are constraint violations; null is an ordinary
value and uniqueness compares canonical tuples. Check predicates must return
booleans; throwing or accessing uncontrolled APIs is a terminal model error.

On constraint failure, close/discard the transaction and settle failure
`CONSTRAINT_VIOLATION`. On success, atomically replace committed state, increment
revision if any writes were staged, record commit, and settle success with null.
Revision overflow fails before commit. Read-only commits also validate the
revision but do not increment it. There is no automatic retry. Simultaneous
commits use scheduler order, so two writers from one revision cannot both win.

`rollback` discards an open transaction synchronously and is idempotent after
rollback; after commit submission or commit completion it is invalid. Task
completion with an open transaction rolls it back. Crash/stop discards open and
pending transactions through trusted runtime cleanup; a commit dispatched
before crash stays durable. Pending completion events become inert. There is
no user cancellation of submitted commits, and no configurable database capacity
limit in this baseline. Infrastructure/capability/history errors remain terminal.

## Owned state

Committed tables, revision (initially zero), transaction counter, and per-task
snapshots/write sets/statuses. A transaction's changes never modify other
databases, KV entries, or message-bus state. Recording an outbox row atomically
with business state is supported; publishing that row is separate work.

Canonical serialization sorts tables/keys and excludes capabilities. Live
transaction continuations prevent a complete snapshot. Reset restores declared
initial rows/revision/counters and revokes all old handles. Service restart keeps
committed rows and counters; full simulation reset restores them.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `database.transaction.begun` | Snapshot created | Transaction ID, base revision |
| `database.row.read` | get or scan | Transaction ID, table, keys, returned rows |
| `database.write.staged` | Successful insert/update/delete | Transaction ID, table, key, before, after |
| `database.transaction.committed` | Atomic commit | Transaction ID, old/new revision, changes |
| `database.transaction.rolledback` | Explicit or cleanup rollback | Transaction ID, reason |
| `database.transaction.rejected` | Commit conflict/constraint | Transaction ID, code, constraint when applicable |

Absent rows use explicit `{present: false}`; existing rows use
`{present: true, value: row}` in before/after evidence. Schemas belong to the
database; records preserve the task's active correlation and identify the owner
and affected rows. Reads/staging are distinct from durable changes. Observation
visibility and terminal failure follow [Observability](observability.md): a
failed post-commit append cannot undo committed state or recurse into the sink.
Playback and pure inspector reads add no canonical events.

## Invariants

- **DB-INV-1:** A committed database always satisfies its declared constraints.
- **DB-INV-2:** Transactions publish all local writes atomically or none.
- **DB-INV-3:** Only owner tasks access writable state; crash preserves commits.
- **DB-INV-4:** Snapshot conflicts, IDs, and scan order are deterministic.

## Explicit non-responsibilities

- SQL, joins, indexes, vendor isolation levels, and external disk persistence.
- Automatic inbox/outbox dispatch, global rollback, or compensation.
- Direct database access by clients or other services.

## Minimal examples

### Commit stock reservation

```ts
function* reserve(db: Database): ControlledTask {
  const tx = db.begin();
  const row = tx.get("stock", "sku-1");
  tx.update("stock", "sku-1", { available: Number(row?.available) - 1 });
  yield tx.commit(); // A declared nonnegative-stock check guards the commit.
}
```

### Concurrent reservation

```text
A and B begin at revision 0 and read stock=1.
A commits stock=0, advancing revision to 1.
B commit fails TRANSACTION_CONFLICT; committed stock remains 0.
```

## Acceptance criteria

- **DB-AC-1:** Construct initial tables; begin/read/scan/insert/update/delete and
  commit demonstrate read-your-writes, sorted scans, and atomic visibility.
- **DB-AC-2:** Competing snapshots, including read-only and unrelated-row cases,
  follow revision conflict rules without partial commits or automatic retry.
- **DB-AC-3:** Injected commit failure, check/unique failures, and invalid operations
  preserve committed data; rollback, repeated rollback, missing delete, and
  closed handles conform.
- **DB-AC-4:** Foreign tasks, shared aliases, stale handles, invalid definitions,
  nonboolean predicates, and counter overflow cannot corrupt state.
- **DB-AC-5:** Crash before/after commit and task exit discard only uncommitted
  work; outbox publication failure cannot undo a business commit.
- **DB-AC-6:** Fresh runs/reset match state/history; post-commit observation
  failure terminates without rollback. No uncontrolled time or randomness is used.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| DB-INV-1 | DB-AC-1, DB-AC-3 |
| DB-INV-2 | DB-AC-2, DB-AC-3, DB-AC-5 |
| DB-INV-3 | DB-AC-4, DB-AC-5 |
| DB-INV-4 | DB-AC-1, DB-AC-2, DB-AC-6 |
| Construction, reset, begin | DB-AC-1, DB-AC-4, DB-AC-6 |
| get, scan, insert, update, delete | DB-AC-1, DB-AC-3, DB-AC-4 |
| commit, rollback | DB-AC-1–6 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Service Runtime](service-runtime.md), [Message Bus](message-bus.md)
