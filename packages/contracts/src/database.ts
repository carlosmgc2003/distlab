import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { ControlledOperation } from "./kernel/operations.js";

export const DatabaseObservationTypes = {
  TransactionBegun: "database.transaction.begun",
  RowRead: "database.row.read",
  WriteStaged: "database.write.staged",
  TransactionCommitted: "database.transaction.committed",
  TransactionRolledBack: "database.transaction.rolledback",
  TransactionRejected: "database.transaction.rejected",
} as const;

export type DatabaseRow = Readonly<Record<string, CanonicalValue>>;

export interface TableDefinition {
  readonly name: string;
  readonly unique: readonly (readonly string[])[];
  readonly checks: readonly string[];
}

export interface DatabaseDefinition {
  readonly owner: ComponentId;
  readonly tables: readonly TableDefinition[];
  readonly initial: Readonly<Record<string, Readonly<Record<string, DatabaseRow>>>>;
}

/**
 * Private snapshot plus staged writes. One open transaction per task.
 * `commit` is a zero-delay controlled operation. Crash discards open
 * transactions; a commit already dispatched stays durable.
 */
export interface Transaction {
  readonly id: string;
  get(table: string, key: string): DatabaseRow | undefined;
  scan(table: string): readonly { key: string; row: DatabaseRow }[];
  insert(table: string, key: string, row: DatabaseRow): void;
  update(table: string, key: string, row: DatabaseRow): void;
  delete(table: string, key: string): boolean;
  commit(): ControlledOperation;
  rollback(): void;
}

/** Writable only by the assigned internal service. */
export interface Database {
  begin(): Transaction;
}
