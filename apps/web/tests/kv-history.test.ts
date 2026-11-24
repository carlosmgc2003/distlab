import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { CanonicalValue, KeyValueDefinition, Observation, RuntimeProjectionSet, SimulationTime } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { keyHistory, storeAt } from "../src/kv-history.ts";
import type { KeyHistoryReading, KeySegment } from "../src/kv-history.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

type Choice = (typeof scenarios)[number];

function document(choice: Choice): { readonly startTime: SimulationTime; readonly stores: readonly KeyValueDefinition[] } {
  const scenario = choice.scenario as unknown as { startTime: number; architecture: { stores: readonly KeyValueDefinition[] } };
  return { startTime: simulationTime(scenario.startTime), stores: scenario.architecture.stores };
}

async function run(id: string): Promise<RuntimeProjectionSet> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  const choice = scenarios.find(item => item.id === id)!;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const last = events.filter(event => event.type === "projection.updated").at(-1);
  assert.ok(last?.projection);
  return last.projection;
}

function read(id: string, projection: RuntimeProjectionSet, positionId?: string | null): KeyHistoryReading {
  const choice = scenarios.find(item => item.id === id)!;
  const { startTime, stores } = document(choice);
  return keyHistory(projection.history.observations, stores, startTime, positionId);
}

/** The segments of one key, without record ids, for comparison. */
function segments(reading: KeyHistoryReading, owner: string, key: string): readonly Record<string, CanonicalValue | undefined>[] {
  const history = reading.stores.find(item => item.owner === owner)?.keys.find(item => item.key === key);
  assert.ok(history, `${owner} ${key}`);
  return history.segments.map((segment: KeySegment) => ({
    value: segment.value, start: segment.start, opening: segment.opening, writer: segment.writer,
    expiresAt: segment.expiresAt, end: segment.end?.time, cause: segment.end?.cause,
  }));
}

let sequence = 0;
function record(type: string, source: string, data: Observation["data"] | undefined, time: number, extra: Partial<Observation> = {}): Observation {
  sequence += 1;
  return {
    schemaVersion: 1, id: `o${sequence}`, time: simulationTime(time), sequence, type, source,
    ...(data === undefined ? {} : { data }), ...extra,
  } as Observation;
}

const kvStores: readonly KeyValueDefinition[] = [{ owner: "kv", initial: [] }] as readonly KeyValueDefinition[];
const start = simulationTime(0);

test("every packaged lesson with a store: the key history at the end equals the store the run reports", async () => {
  const withStores = scenarios.filter(choice => document(choice).stores.length > 0).map(choice => choice.id).sort();
  assert.deepEqual(withStores, ["cache-invalidated", "cache-stale-price", "cascade-breaker", "cascade-unprotected", "lease-fenced", "lease-unfenced"]);
  for (const id of withStores) {
    const projection = await run(id);
    const states = storeAt(read(id, projection));
    for (const { owner } of document(scenarios.find(choice => choice.id === id)!).stores) {
      const reported = projection.components.find(item => item.componentId === owner && item.visibility === "student")?.state as { store?: CanonicalValue[] } | undefined;
      assert.ok(Array.isArray(reported?.store), `${id}: ${owner} reports its store`);
      const expected = reported.store.map(entry => entry as Record<string, CanonicalValue>).map(entry => ({ key: entry.key, value: entry.value, ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }) }));
      const state = states.find(item => item.owner === owner);
      assert.ok(state, `${id}: ${owner}`);
      assert.equal(state.hiddenChanges, 0);
      const actual = state.entries.map(entry => ({ key: entry.key, value: entry.value, ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }) }));
      assert.deepEqual(actual, expected, `${id}: ${owner}`);
    }
  }
});

test("lease-unfenced: two leases that expire, and a token each worker drew", async () => {
  const projection = await run("lease-unfenced");
  const end = read("lease-unfenced", projection);
  assert.deepEqual(segments(end, "kv", "lock:report"), [
    { value: "worker-1", start: 2, opening: "set", writer: "worker-1", expiresAt: 12, end: 12, cause: "expired" },
    { value: "worker-2", start: 17, opening: "set", writer: "worker-2", expiresAt: 27, end: 27, cause: "expired" },
  ]);
  assert.deepEqual(segments(end, "kv", "lock:report:token"), [
    { value: 1, start: 4, opening: "increment", writer: "worker-1", expiresAt: undefined, end: 19, cause: "overwrite" },
    { value: 2, start: 19, opening: "increment", writer: "worker-2", expiresAt: undefined, end: undefined, cause: undefined },
  ]);
  // Each expiry names the kv.expired record that removed the entry once it is read.
  const lock = end.stores[0]!.keys.find(item => item.key === "lock:report")!;
  const expiries = lock.marks.filter(mark => mark.kind === "expired").map(mark => mark.recordId);
  assert.deepEqual(lock.segments.map(segment => segment.end?.recordId), expiries);
  // The increment endpoint reads the counter first: a miss, then a hit.
  const reads = end.stores[0]!.keys.find(item => item.key === "lock:report:token")!.marks;
  assert.deepEqual(reads.map(mark => mark.kind === "read" ? [mark.actor, mark.present, mark.value] : mark.kind), [["worker-1", false, undefined], ["worker-2", true, 1]]);

  // No record is stored at t=14: the last record at or before it is the position there.
  // The lease has expired, and only the token is held.
  const at14 = projection.history.observations.filter(item => Number(item.time) <= 14).at(-1);
  assert.ok(at14);
  assert.ok(Number(at14.time) >= 12 && Number(at14.time) < 17);
  const store = storeAt(read("lease-unfenced", projection, at14.id));
  assert.deepEqual(store[0]!.entries.map(entry => [entry.key, entry.value, entry.writer]), [["lock:report:token", 1, "worker-1"]]);
});

test("before the first record only declared initial entries are live, with TTL counted from the start time", () => {
  const stores = [{ owner: "cache", initial: [{ key: "a", value: 1, ttl: 5 }, { key: "b", value: null }] }] as unknown as readonly KeyValueDefinition[];
  const observations = [record("kv.read", "cache", { key: "a", present: true, value: 1 }, 101)];
  const before = keyHistory(observations, stores, simulationTime(100), null);
  assert.equal(before.positionId, null);
  assert.equal(before.time, 100);
  assert.deepEqual(storeAt(before)[0]!.entries, [
    { key: "a", visible: true, value: 1, expiresAt: 105, writer: "cache", startId: null },
    { key: "b", visible: true, value: null, writer: "cache", startId: null },
  ]);
  // An id this history does not hold reads no record either.
  assert.deepEqual(keyHistory(observations, stores, simulationTime(100), "missing"), before);
  // At t=105 the initial entry is absent, though no expiry record was read.
  const later = keyHistory([...observations, record("kv.read", "cache", { key: "b", present: true, value: null }, 105)], stores, simulationTime(100));
  assert.deepEqual(storeAt(later)[0]!.entries.map(entry => entry.key), ["b"]);
  assert.deepEqual(later.stores[0]!.keys[0]!.segments[0]!.end, { time: 105, cause: "expired", recordId: null });
});

test("KV-INV-1: an operation at the same time as an expiry sees the entry absent, in either record order", () => {
  const set = record("kv.changed", "kv", { key: "k", operation: "set", before: { present: false }, after: { present: true, value: "a" }, expiresAt: 10 }, 0);
  const expiry = record("kv.expired", "kv", { key: "k", value: "a", expiresAt: 10, generation: 1 }, 10);
  const miss = record("kv.read", "kv", { key: "k", present: false }, 10);
  for (const order of [[set, expiry, miss], [set, miss, expiry]]) {
    const observations = order.map((item, index) => ({ ...item, sequence: index + 1 }));
    // At the first record at t=10, whichever it is, the entry is already absent.
    const first = keyHistory(observations, kvStores, start, observations[1]!.id);
    assert.deepEqual(storeAt(first)[0]!.entries, []);
    const segment = first.stores[0]!.keys[0]!.segments[0]!;
    assert.equal(segment.end?.time, 10);
    assert.equal(segment.end?.cause, "expired");
    // Once the expiry record is read, the segment names it.
    const end = keyHistory(observations, kvStores, start);
    assert.equal(end.stores[0]!.keys[0]!.segments[0]!.end?.recordId, expiry.id);
  }
});

test("delete, compare-and-delete, and an overwrite end a segment with their own cause", () => {
  const observations = [
    record("kv.changed", "kv", { key: "k", operation: "set", before: { present: false }, after: { present: true, value: 1 } }, 1),
    record("kv.changed", "kv", { key: "k", operation: "compareAndSet", before: { present: true, value: 1 }, after: { present: true, value: 2 }, expiresAt: 50 }, 2),
    record("kv.changed", "kv", { key: "k", operation: "compareAndDelete", before: { present: true, value: 2 }, after: { present: false } }, 3),
    record("kv.changed", "kv", { key: "k", operation: "set", before: { present: false }, after: { present: true, value: 3 } }, 4),
    record("kv.changed", "kv", { key: "k", operation: "delete", before: { present: true, value: 3 }, after: { present: false } }, 5),
    record("kv.condition.failed", "kv", { key: "k", operation: "compareAndDelete" }, 6),
  ];
  const reading = keyHistory(observations, kvStores, start);
  const history = reading.stores[0]!.keys[0]!;
  assert.deepEqual(history.segments.map(segment => [segment.value, segment.opening, segment.end?.cause, segment.end?.recordId]), [
    [1, "set", "overwrite", observations[1]!.id],
    [2, "compareAndSet", "compareAndDelete", observations[2]!.id],
    [3, "set", "delete", observations[4]!.id],
  ]);
  // The cancelled expiry at t=50 never ends anything: the segment ended at t=3.
  assert.equal(history.segments[1]!.expiresAt, 50);
  assert.deepEqual(history.marks, [{ kind: "condition-failed", key: "k", time: 6, recordId: observations[5]!.id, actor: "kv", operation: "compareAndDelete" }]);
  assert.deepEqual(storeAt(reading)[0]!.entries, []);
});

test("a redacted, omitted, or summarized payload is never reconstructed", () => {
  const observations = [
    record("kv.changed", "kv", { key: "k", operation: "set", before: { present: false }, after: { present: true, value: "secret" } }, 1),
    // Redacted and omitted: the key is not stored, so these are hidden changes.
    record("kv.changed", "kv", { redacted: true }, 2),
    record("kv.changed", "kv", undefined, 3),
    // Summarized to the key and operation: a segment whose value is not visible.
    record("kv.changed", "kv", { key: "k", operation: "set" }, 4),
    record("kv.read", "kv", { key: "k" }, 5),
  ];
  const reading = keyHistory(observations, kvStores, start);
  const store = reading.stores[0]!;
  assert.equal(store.hiddenChanges, 2);
  const history = store.keys[0]!;
  assert.deepEqual(history.segments.map(segment => [segment.visible, Object.hasOwn(segment, "value"), segment.end?.cause]), [[true, true, "overwrite"], [false, false, undefined]]);
  const mark = history.marks[0]!;
  assert.ok(mark.kind === "read");
  assert.equal(mark.visible, false);
  assert.equal(Object.hasOwn(mark, "present"), false);
  assert.equal(Object.hasOwn(mark, "value"), false);
  assert.deepEqual(storeAt(reading)[0]!.entries, [{ key: "k", visible: false, writer: "kv", startId: observations[3]!.id }]);
});

test("the writer is the sender of the causing request, and otherwise the store's owner", () => {
  const sent = record("network.request.sent", "worker-1", { requestId: "r1", target: "kv" }, 1, { target: "kv" } as Partial<Observation>);
  const delivered = record("network.request.delivered", "worker-1", { requestId: "r1", target: "kv" }, 2, { causationId: sent.id } as Partial<Observation>);
  const value = { key: "k", operation: "set", before: { present: false }, after: { present: true, value: "x" } };
  const cases: readonly [string | undefined, string][] = [
    [sent.id, "worker-1"],
    // Not a sent request: the owner.
    [delivered.id, "kv"],
    // A cause no stored record holds: the owner.
    ["observation:missing", "kv"],
    // No cause at all: the owner.
    [undefined, "kv"],
  ];
  for (const [cause, writer] of cases) {
    const change = record("kv.changed", "kv", value, 3, cause === undefined ? {} : { causationId: cause } as Partial<Observation>);
    const reading = keyHistory([sent, delivered, change], kvStores, start);
    assert.equal(reading.stores[0]!.keys[0]!.segments[0]!.writer, writer, String(cause));
  }
  // A cause after the position is not consulted: only records at or before it are read.
  const late = record("network.request.sent", "worker-2", {}, 1);
  // Recorded earlier than the request it names, so a reading positioned on it has not read that request.
  const early = { ...record("kv.changed", "kv", value, 0, { causationId: late.id } as Partial<Observation>), sequence: late.sequence - 0.5 };
  assert.equal(keyHistory([early, late], kvStores, start, early.id).stores[0]!.keys[0]!.segments[0]!.writer, "kv");
});

test("a store only records name is still read, after the declared ones", () => {
  const observations = [record("kv.changed", "other", { key: "z", operation: "increment", before: { present: false }, after: { present: true, value: 1 } }, 1)];
  const reading = keyHistory(observations, kvStores, start);
  assert.deepEqual(reading.stores.map(item => item.owner), ["kv", "other"]);
});

test("determinism: reading the same records twice gives equal results and changes nothing", async () => {
  const projection = await run("cache-invalidated");
  const before = JSON.stringify(projection.history.observations);
  const first = read("cache-invalidated", projection);
  const second = read("cache-invalidated", projection);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(projection.history.observations), before);
  // Catalog deletes the cached price when it changes, then caches the new one.
  assert.deepEqual(segments(first, "catalog", "price:sku-1").map(item => [item.start, item.cause, item.end]), [[1, "delete", 11], [24, "expired", 124]]);
});

test("the module is pure: it names no DOM node, host timer, clock, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-history.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
