import type { Database, DatabaseDefinition, DatabaseRow, FaultDecisionPort, TableDefinition, Transaction } from "@distlab/contracts";
import { DatabaseObservationTypes as Obs } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ControlledOperation, HandlerContext, ObservationInput, ObservationSink, OperationController, ScheduledEvent, SimulationSetup, SimulationTime } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "./canonical.js";

const fail = (code: string): never => throwSimulationError(code);
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const sorted = <T>(values: Iterable<T>, key: (value: T) => string): T[] => [...values].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const registeredSchemas = new WeakSet<object>();
type Tables = Map<string, Map<string, DatabaseRow>>;
type Change = { table: string; key: string; before: DatabaseRow | undefined; after: DatabaseRow | undefined };
type TaskIdentity = { readonly id: string; readonly owner: ComponentId; readonly processGeneration: number };
type Pending = { readonly tx: LocalTransaction; readonly operation: ControlledOperation; readonly generation: number; cancelled: boolean };

export interface DatabaseOptions {
  readonly definition: DatabaseDefinition;
  readonly checks: Readonly<Record<string, (row: DatabaseRow) => boolean>>;
  readonly setup: Pick<SimulationSetup, "registerHandler" | "registerObservationSchema">;
  readonly clock: { now(): SimulationTime };
  readonly schedule: (type: string, payload: CanonicalValue) => void;
  readonly operations: OperationController;
  readonly observations: ObservationSink;
  readonly task: () => TaskIdentity | undefined;
  readonly event: () => ScheduledEvent | undefined;
  readonly faults?: FaultDecisionPort;
}

/** One service's in-memory committed state. Call reset for a fresh modeled run. */
export class DeterministicDatabase implements Database {
  readonly #options: DatabaseOptions;
  readonly #definitions = new Map<string, TableDefinition>();
  readonly #checks: Readonly<Record<string, (row: DatabaseRow) => boolean>>;
  readonly #initial: Tables;
  readonly #eventType: string;
  #committed: Tables;
  #revision = 0;
  #counter = 0;
  #epoch = 0;
  readonly #open = new Map<string, LocalTransaction>();
  readonly #pending = new Map<string, Pending>();

  constructor(options: DatabaseOptions) {
    const { checks } = options;
    let definition: DatabaseDefinition = options.definition;
    try { definition = canonicalCopy(options.definition) as unknown as DatabaseDefinition; }
    catch { fail(ErrorCodes.INVALID_DATABASE_OPERATION); }
    this.#options = { ...options, definition };
    if (!plain(definition) || !name(definition.owner) || !Array.isArray(definition.tables) || !plain(definition.initial) || !plain(checks)) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    this.#checks = Object.freeze(Object.fromEntries(Object.entries(checks)));
    for (const table of definition.tables) {
      if (!plain(table) || !name(table.name) || this.#definitions.has(table.name) || !Array.isArray(table.unique) || !Array.isArray(table.checks)) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
      for (const fields of table.unique) if (!Array.isArray(fields) || !fields.length || fields.some(field => !name(field)) || new Set(fields).size !== fields.length) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
      for (const check of table.checks) if (!name(check) || typeof this.#checks[check] !== "function") fail(ErrorCodes.INVALID_DATABASE_OPERATION);
      this.#definitions.set(table.name, { name: table.name, unique: table.unique.map(fields => [...fields]), checks: [...table.checks] });
    }
    if (Object.keys(definition.initial).some(table => !this.#definitions.has(table))) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    this.#initial = new Map();
    for (const table of this.#definitions.keys()) {
      const input = definition.initial[table] ?? {};
      if (!plain(input)) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
      const rows = new Map<string, DatabaseRow>();
      for (const [key, row] of Object.entries(input)) { this.#key(key); rows.set(key, this.#row(row)); }
      this.#initial.set(table, rows);
    }
    if (this.#constraint(this.#initial)) fail(ErrorCodes.CONSTRAINT_VIOLATION);
    this.#committed = this.#copyTables(this.#initial);
    this.#eventType = `database.${definition.owner}.commit`;
    if (!registeredSchemas.has(options.setup)) {
      for (const type of Object.values(Obs)) options.setup.registerObservationSchema(type, data => plain(data) && typeof data.transactionId === "string");
      registeredSchemas.add(options.setup);
    }
    options.setup.registerHandler(this.#eventType, definition.owner, (event, context) => this.#dispatch(event, context));
  }

  get revision(): number { return this.#revision; }
  /** Detached, sorted committed projection; no transaction handles escape. */
  inspect(): Readonly<{ revision: number; tables: Readonly<Record<string, Readonly<Record<string, DatabaseRow>>>> }> {
    const tables: Record<string, Record<string, DatabaseRow>> = Object.create(null);
    for (const [table, rows] of sorted(this.#committed, entry => entry[0])) {
      const projection: Record<string, DatabaseRow> = Object.create(null);
      for (const [key, row] of sorted(rows, entry => entry[0])) projection[key] = row;
      tables[table] = projection;
    }
    return canonicalCopy({ revision: this.#revision, tables }) as ReturnType<DeterministicDatabase["inspect"]>;
  }
  reset(): void {
    this.#epoch++;
    this.#open.clear(); this.#pending.clear();
    this.#committed = this.#copyTables(this.#initial); this.#revision = 0; this.#counter = 0;
  }
  /** Trusted service-runtime cleanup; already dispatched commits are absent from pending. */
  abandonGeneration(generation: number): void {
    for (const tx of this.#open.values()) if (tx.generation === generation) tx.cleanup();
    for (const pending of this.#pending.values()) if (pending.generation === generation) { pending.cancelled = true; this.#pending.delete(pending.operation.operationId); }
  }
  begin(): Transaction {
    const task = this.#options.task();
    if (!task || task.owner !== this.#options.definition.owner) return fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    if (this.#open.has(task.id)) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    if (this.#counter === Number.MAX_SAFE_INTEGER) fail(ErrorCodes.IDENTITY_OVERFLOW);
    const origin = this.#options.event();
    if (!origin) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    const tx = new LocalTransaction(this, `${this.#options.definition.owner}:database:${this.#counter++}`, task, this.#epoch, this.#revision, this.#copyTables(this.#committed), origin!);
    this.#open.set(task.id, tx);
    this.observe(Obs.TransactionBegun, tx, { transactionId: tx.id, baseRevision: tx.baseRevision });
    return tx;
  }
  active(tx: LocalTransaction): void {
    const task = this.#options.task();
    if (tx.epoch !== this.#epoch || tx.status !== "open" || !task || task.id !== tx.task.id || task.owner !== tx.task.owner || task.processGeneration !== tx.generation || this.#open.get(task.id) !== tx) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
  }
  table(table: string): void { if (!this.#definitions.has(table)) fail(ErrorCodes.INVALID_DATABASE_OPERATION); }
  key(key: string): void { this.#key(key); }
  row(row: DatabaseRow): DatabaseRow { return this.#row(row); }
  read(tx: LocalTransaction, table: string, keys: readonly string[], rows: readonly { key: string; row: DatabaseRow }[]): void {
    this.observe(Obs.RowRead, tx, { transactionId: tx.id, table, keys, rows });
  }
  staged(tx: LocalTransaction, change: Change): void {
    this.observe(Obs.WriteStaged, tx, { transactionId: tx.id, table: change.table, key: change.key, before: this.#evidence(change.before), after: this.#evidence(change.after) });
  }
  submit(tx: LocalTransaction): ControlledOperation {
    this.active(tx);
    const operation = this.#options.operations.create();
    tx.status = "submitted";
    this.#open.delete(tx.task.id);
    this.#pending.set(operation.operationId, { tx, operation, generation: tx.generation, cancelled: false });
    this.#options.schedule(this.#eventType, { operationId: operation.operationId });
    return operation;
  }
  rollback(tx: LocalTransaction, reason: string): void {
    if (tx.epoch !== this.#epoch) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    if (tx.status === "rolledback") {
      const task = this.#options.task();
      if (task?.id !== tx.task.id || task.processGeneration !== tx.generation) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
      return;
    }
    this.active(tx);
    tx.status = "rolledback"; this.#open.delete(tx.task.id);
    this.observe(Obs.TransactionRolledBack, tx, { transactionId: tx.id, reason });
  }
  cleanup(tx: LocalTransaction): void {
    if (tx.status !== "open") return;
    tx.status = "rolledback"; this.#open.delete(tx.task.id);
    this.observe(Obs.TransactionRolledBack, tx, { transactionId: tx.id, reason: "task-exit-or-crash" });
  }
  #dispatch(event: ScheduledEvent, context: HandlerContext): void {
    const id = (event.payload as { operationId: string }).operationId;
    const pending = this.#pending.get(id);
    if (!pending || pending.cancelled) return;
    this.#pending.delete(id);
    const tx = pending.tx;
    tx.status = "closed";
    const reject = (code: string, constraint?: string): void => {
      this.observe(Obs.TransactionRejected, tx, { transactionId: tx.id, code, ...(constraint ? { constraint } : {}) }, context, event);
      this.#options.operations.complete(id, { kind: "failure", error: { code, context: { transactionId: tx.id, ...(constraint ? { constraint } : {}) } } });
    };
    const effect = this.#options.faults?.evaluate({ point: "database.commit", subjectId: tx.id, source: tx.task.owner, target: tx.task.owner, name: tx.task.owner });
    if (effect && (effect.drop || effect.extraDelay || effect.additionalCopies || effect.copySpacing || typeof effect.fail !== "boolean")) fail(ErrorCodes.INVALID_FAULT);
    if (effect?.fail) return reject(ErrorCodes.COMMIT_FAILED);
    if (this.#revision !== tx.baseRevision) return reject(ErrorCodes.TRANSACTION_CONFLICT);
    const candidate = this.#copyTables(this.#committed);
    for (const change of tx.changes()) {
      if (change.after === undefined) candidate.get(change.table)!.delete(change.key);
      else candidate.get(change.table)!.set(change.key, change.after);
    }
    const constraint = this.#constraint(candidate);
    if (constraint) return reject(ErrorCodes.CONSTRAINT_VIOLATION, constraint);
    if (tx.staged && this.#revision === Number.MAX_SAFE_INTEGER) fail(ErrorCodes.IDENTITY_OVERFLOW);
    const previous = this.#revision;
    this.#committed = candidate;
    if (tx.staged) this.#revision++;
    this.observe(Obs.TransactionCommitted, tx, { transactionId: tx.id, oldRevision: previous, newRevision: this.#revision,
      changes: tx.changes().map(change => ({ table: change.table, key: change.key, before: this.#evidence(change.before), after: this.#evidence(change.after) })) }, context, event);
    this.#options.operations.complete(id, { kind: "success", value: null });
  }
  observe(type: string, tx: LocalTransaction, data: CanonicalValue, context?: HandlerContext, event?: ScheduledEvent): void {
    const activeEvent = event ?? this.#options.event();
    if (!activeEvent) return fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    const origin = tx.origin;
    const input: ObservationInput = { type, source: this.#options.definition.owner,
      eventId: activeEvent.id, entityRefs: [{ kind: "service", id: this.#options.definition.owner }],
      ...(origin.traceId ? { traceId: origin.traceId } : {}), ...(origin.spanId ? { spanId: origin.spanId } : {}),
      ...(origin.parentSpanId ? { parentSpanId: origin.parentSpanId } : {}), ...(origin.causationId ? { causationId: origin.causationId } : {}), data };
    (context?.observations ?? this.#options.observations).record(input);
  }
  #evidence(row: DatabaseRow | undefined): CanonicalValue { return row === undefined ? { present: false } : { present: true, value: row }; }
  #key(key: unknown): void { if (!name(key)) fail(ErrorCodes.INVALID_DATABASE_OPERATION); }
  #row(row: unknown): DatabaseRow {
    if (!plain(row) || Object.keys(row).some(field => !name(field))) fail(ErrorCodes.INVALID_DATABASE_OPERATION);
    try { return canonicalCopy(row) as DatabaseRow; } catch { return fail(ErrorCodes.INVALID_DATABASE_OPERATION); }
  }
  #copyTables(source: Tables): Tables { return new Map([...source].map(([table, rows]) => [table, new Map(rows)])); }
  #constraint(tables: Tables): string | undefined {
    for (const [table, definition] of this.#definitions) {
      const rows = tables.get(table)!;
      for (const [key, row] of rows) {
        for (const check of definition.checks) {
          let result: boolean;
          try { result = this.#checks[check]!(row); } catch { return fail(ErrorCodes.INVALID_DATABASE_OPERATION); }
          if (typeof result !== "boolean") fail(ErrorCodes.INVALID_DATABASE_OPERATION);
          if (!result) return `${table}.check.${check}`;
        }
        for (const fields of definition.unique) {
          if (fields.some(field => !Object.hasOwn(row, field))) return `${table}.unique.${fields.join(",")}`;
          const tuple = canonicalEncode(fields.map(field => row[field]!) as CanonicalValue);
          for (const [otherKey, other] of rows) if (otherKey !== key && fields.every(field => Object.hasOwn(other, field)) && canonicalEncode(fields.map(field => other[field]!) as CanonicalValue) === tuple)
            return `${table}.unique.${fields.join(",")}`;
        }
      }
    }
    return undefined;
  }
}

class LocalTransaction implements Transaction {
  status: "open" | "submitted" | "closed" | "rolledback" = "open";
  staged = false;
  readonly #writes = new Map<string, Change>();
  constructor(readonly db: DeterministicDatabase, readonly id: string, readonly task: TaskIdentity, readonly epoch: number,
    readonly baseRevision: number, readonly snapshot: Tables, readonly origin: ScheduledEvent) {}
  get generation(): number { return this.task.processGeneration; }
  #table(table: string): Map<string, DatabaseRow> { this.db.active(this); this.db.table(table); return this.snapshot.get(table)!; }
  get(table: string, key: string): DatabaseRow | undefined {
    const rows = this.#table(table); this.db.key(key);
    const row = rows.get(key); this.db.read(this, table, [key], row ? [{ key, row }] : []); return row && this.db.row(row);
  }
  scan(table: string): readonly { key: string; row: DatabaseRow }[] {
    const rows = this.#table(table); const result = sorted(rows, entry => entry[0]).map(([key, row]) => ({ key, row: this.db.row(row) }));
    this.db.read(this, table, result.map(item => item.key), result); return result;
  }
  #write(table: string, key: string, after: DatabaseRow | undefined): void {
    const rows = this.#table(table); this.db.key(key);
    const current = rows.get(key);
    if (after === undefined) rows.delete(key); else rows.set(key, after);
    this.staged = true;
    const changeKey = `${table}\u0000${key}`;
    const previous = this.#writes.get(changeKey);
    this.#writes.set(changeKey, { table, key, before: previous ? previous.before : current, after });
    this.db.staged(this, { table, key, before: current, after });
  }
  insert(table: string, key: string, row: DatabaseRow): void { const rows = this.#table(table); this.db.key(key); const value = this.db.row(row); if (rows.has(key)) fail(ErrorCodes.ROW_EXISTS); this.#write(table, key, value); }
  update(table: string, key: string, row: DatabaseRow): void { const rows = this.#table(table); this.db.key(key); const value = this.db.row(row); if (!rows.has(key)) fail(ErrorCodes.ROW_NOT_FOUND); this.#write(table, key, value); }
  delete(table: string, key: string): boolean { const rows = this.#table(table); this.db.key(key); if (!rows.has(key)) return false; this.#write(table, key, undefined); return true; }
  changes(): Change[] { return sorted(this.#writes.values(), change => `${change.table}\u0000${change.key}`).filter(change => change.before !== change.after); }
  commit(): ControlledOperation { return this.db.submit(this); }
  rollback(): void { this.db.rollback(this, "explicit"); }
  cleanup(): void { this.db.cleanup(this); }
}
