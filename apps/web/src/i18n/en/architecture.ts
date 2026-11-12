import type { Fmt } from "../format.ts";

/** English source messages for the `architecture` area (ADR-007): architecture-view.ts and activity.ts. */
export const architecture = {
  invalid: "Architecture contains duplicate components or connections to missing components.",
  category: {
    client: "Client",
    service: "Internal service",
    external: "External service",
    infrastructure: "Infrastructure",
  },
  symbol: {
    client: "Client",
    service: "Internal service",
    external: "External service",
    topic: "Message bus topic",
    queue: "Message bus queue",
    kvstore: "Shared key-value store",
  },
  /** The resource kinds, named as the kernel names them. */
  resourceKind: { database: "Database", kvstore: "KeyValueStore" },
  databaseOwnedBy: (owner: string, _f: Fmt) => `Database owned by ${owner}`,
  storeOwnedBy: (owner: string, _f: Fmt) => `KeyValueStore owned by ${owner}`,
  /** The table names are identifiers, so they stay a plain comma-separated list. */
  databaseResource: (p: { owner: string; tables: readonly string[] }, _f: Fmt) => `Database owned by ${p.owner}: ${p.tables.join(", ")}`,
  storeResource: (owner: string, _f: Fmt) => `KeyValueStore owned by ${owner}`,
  /** A MessageBus destination, by its stored kind. */
  destinationResource: {
    topic: (id: string, _f: Fmt) => `MessageBus topic: ${id}`,
    queue: (id: string, _f: Fmt) => `MessageBus queue: ${id}`,
  },
  /** A destination whose kind this build does not know: the raw kind is shown. */
  destinationResourceOther: (p: { kind: string; id: string }, _f: Fmt) => `MessageBus ${p.kind}: ${p.id}`,
  link: {
    request: "Request",
    requestNamed: (label: string, _f: Fmt) => `Request · ${label}`,
    subscription: "Subscription",
    publication: "Publication",
    aria: (p: { source: string; target: string; label: string }, _f: Fmt) => `${p.source} to ${p.target}: ${p.label}`,
    publicationAria: "Orders to MessageBus OrderCreated: publication",
  },
  nodeAria: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}`,
  nodeAriaEmptySlot: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}, empty slot`,
  /** Component activity at the playback cursor (activity.ts). */
  activity: {
    state: { idle: "Idle", processing: "Processing", waiting: "Waiting" },
    waitingUntil: (deadline: number, _f: Fmt) => `Waiting · deadline t=${deadline}`,
    idle: (id: string, _f: Fmt) => `${id} is idle.`,
    waiting: (p: { id: string; targets: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} is waiting on ${p.targets} with a recorded deadline at virtual time ${p.deadline}.`
      : `${p.id} is waiting on ${p.targets} with no recorded deadline.`,
    processing: (p: { id: string; work: string }, _f: Fmt) => `${p.id} is processing ${p.work}.`,
    waitingAndProcessing: (p: { id: string; targets: string; work: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} is waiting on ${p.targets} with a recorded deadline at virtual time ${p.deadline} and processing ${p.work}.`
      : `${p.id} is waiting on ${p.targets} with no recorded deadline and processing ${p.work}.`,
    timedOut: (p: { target: string; time: number }, _f: Fmt) => `Its request to ${p.target} timed out at virtual time ${p.time}.`,
    work: {
      requests: (n: number, f: Fmt) => f.plural(n, { one: "a delivered request", other: `${f.number(n)} delivered requests` }),
      transactions: (n: number, f: Fmt) => f.plural(n, { one: "an open transaction", other: `${f.number(n)} open transactions` }),
      deliveries: (n: number, f: Fmt) => f.plural(n, { one: "an unacknowledged message delivery", other: `${f.number(n)} unacknowledged message deliveries` }),
    },
  },
};
