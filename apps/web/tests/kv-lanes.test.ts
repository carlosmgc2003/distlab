import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { KeyValueDefinition, Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { keyHistory } from "../src/kv-history.ts";
import { keyLanes, prefixOf } from "../src/kv-lanes.ts";
import type { KeyLanes, LaneRow } from "../src/kv-lanes.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

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

function stores(id: string): { readonly start: number; readonly stores: readonly KeyValueDefinition[] } {
  const scenario = scenarios.find(item => item.id === id)!.scenario as unknown as { startTime: number; architecture: { stores: readonly KeyValueDefinition[] } };
  return { start: scenario.startTime, stores: scenario.architecture.stores };
}

/** The lanes of a recorded lesson, read to the end and positioned on `positionId` (the last record when omitted). */
function lanes(id: string, projection: RuntimeProjectionSet, positionId?: string | null): KeyLanes {
  const { start, stores: definitions } = stores(id);
  const { observations } = projection.history;
  const history = keyHistory(observations, definitions, simulationTime(start));
  return keyLanes(history, observations, { start: simulationTime(start), end: projection.simulation.time },
    positionId === undefined ? observations.at(-1)!.id : positionId);
}

function row(model: KeyLanes, owner: string, key: string): LaneRow {
  const found = model.groups.find(group => group.owner === owner)?.prefixes.flatMap(group => group.rows).find(item => item.key === key);
  assert.ok(found, `${owner} ${key}`);
  return found;
}

const round = (value: number): number => Math.round(value * 1e9) / 1e9;

test("lease-unfenced: the lanes of the lock and the token, read to the end", async () => {
  const projection = await run("lease-unfenced");
  assert.equal(Number(projection.simulation.time), 38);
  const model = lanes("lease-unfenced", projection);
  assert.deepEqual(model.groups.map(group => [group.owner, group.prefixes.map(item => [item.prefix, item.rows.map(r => r.key)])]),
    [["kv", [["lock", ["lock:report", "lock:report:token"]]]]]);

  const lock = row(model, "kv", "lock:report");
  assert.deepEqual(lock.bars.map(bar => [round(bar.start), round(bar.end), bar.writer, bar.value, bar.fade !== undefined, bar.reached, bar.endReached]), [
    [round(2 / 38), round(12 / 38), "worker-1", "worker-1", true, true, true],
    [round(17 / 38), round(27 / 38), "worker-2", "worker-2", true, true, true],
  ]);
  // The fade runs from 75% of the bar to its end.
  assert.equal(round(lock.bars[0]!.fade!.start), round((2 + 0.75 * 10) / 38));
  assert.equal(round(lock.bars[0]!.fade!.end), round(12 / 38));
  // A conditional-set mark at each start (the set stored ifAbsent), and an expiry at each end.
  assert.deepEqual(lock.marks.map(mark => [mark.kind, round(mark.position)]), [
    ["conditional-set", round(2 / 38)], ["expired", round(12 / 38)], ["conditional-set", round(17 / 38)], ["expired", round(27 / 38)],
  ]);

  const token = row(model, "kv", "lock:report:token");
  assert.deepEqual(token.bars.map(bar => [round(bar.start), round(bar.end), bar.writer, bar.value, bar.fade]), [
    [round(4 / 38), round(19 / 38), "worker-1", 1, undefined],
    [round(19 / 38), 1, "worker-2", 2, undefined],
  ]);
  // The increment endpoint reads the counter first: a miss for worker-1, then a hit for worker-2.
  assert.deepEqual(token.marks.map(mark => [mark.kind, round(mark.position)]), [["read-miss", round(4 / 38)], ["read-hit", round(19 / 38)]]);
  // The text model lists the segments and marks in record order, with codes and stored values only.
  assert.deepEqual(lock.text.map(item => item.kind === "segment" ? ["segment", item.value, item.opening, item.ifAbsent, item.end?.cause] : ["mark", item.mark]), [
    ["segment", "worker-1", "set", true, "expired"], ["mark", "conditional-set"], ["mark", "expired"],
    ["segment", "worker-2", "set", true, "expired"], ["mark", "conditional-set"], ["mark", "expired"],
  ]);
});

test("lease-unfenced at t=14: what worker-2 does later is not reached yet", async () => {
  const projection = await run("lease-unfenced");
  const position = projection.history.observations.filter(item => Number(item.time) <= 14).at(-1)!;
  const model = lanes("lease-unfenced", projection, position.id);
  const lock = row(model, "kv", "lock:report");
  assert.deepEqual(lock.bars.map(bar => [bar.writer, bar.reached, bar.endReached]), [["worker-1", true, true], ["worker-2", false, false]]);
  assert.deepEqual(lock.marks.map(mark => [mark.kind, mark.reached]), [["conditional-set", true], ["expired", true], ["conditional-set", false], ["expired", false]]);
  const token = row(model, "kv", "lock:report:token");
  assert.deepEqual(token.bars.map(bar => [bar.writer, bar.reached, bar.endReached]), [["worker-1", true, false], ["worker-2", false, false]]);
  assert.ok(token.text.every(item => item.reached === (item.kind === "segment" ? item.writer === "worker-1" : item.mark === "read-miss")));
  // Before the first record nothing a record wrote is reached.
  const before = lanes("lease-unfenced", projection, null);
  assert.ok(before.groups.flatMap(group => group.prefixes.flatMap(item => item.rows)).every(r => r.bars.every(bar => !bar.reached) && r.marks.every(mark => !mark.reached)));
});

test("three lessons: one bar per segment, and one mark per read, failed condition, expiry, and conditional write", async () => {
  for (const id of ["lease-unfenced", "cache-stale-price", "cascade-breaker"]) {
    const projection = await run(id);
    const { start, stores: definitions } = stores(id);
    const history = keyHistory(projection.history.observations, definitions, simulationTime(start));
    const model = lanes(id, projection);
    assert.deepEqual(model.groups.map(group => group.owner), history.stores.map(store => store.owner), id);
    for (const store of history.stores) for (const key of store.keys) {
      const lane = row(model, store.owner, key.key);
      assert.equal(lane.bars.length, key.segments.length, `${id} ${key.key}`);
      assert.deepEqual(lane.bars.map(bar => bar.recordId), key.segments.map(segment => segment.startId));
      const fromHistory = key.marks.map(mark => mark.recordId).sort();
      const fromLanes = lane.marks.filter(mark => mark.kind !== "conditional-set").map(mark => mark.recordId).sort();
      assert.deepEqual(fromLanes, fromHistory, `${id} ${key.key}`);
      assert.equal(lane.text.filter(item => item.kind === "segment").length, key.segments.length);
    }
  }
});

test("cascade-breaker: each store's dependency key is one row, with no prefix", async () => {
  const model = lanes("cascade-breaker", await run("cascade-breaker"));
  assert.deepEqual(model.groups.map(group => [group.owner, group.prefixes.map(item => [item.prefix, item.rows.map(r => r.key)])]), [
    ["api", [[null, ["dependency"]]]], ["orders", [[null, ["dependency"]]]], ["payments", [[null, ["dependency"]]]],
  ]);
  // Every change of payments' breaker state is one bar of one row.
  assert.ok(row(model, "payments", "dependency").bars.length > 1);
});

let sequence = 0;
function record(type: string, source: string, data: Observation["data"] | undefined, time: number): Observation {
  sequence += 1;
  return { schemaVersion: 1, id: `o${sequence}`, time: simulationTime(time), sequence, type, source, ...(data === undefined ? {} : { data }) } as Observation;
}
const set = (key: string, value: Observation["data"], time: number, extra: Record<string, unknown> = {}) =>
  record("kv.changed", "kv", { key, operation: "set", before: { present: false }, after: { present: true, value }, ...extra } as Observation["data"], time);

test("grouping: keys without a prefix first, then prefixes, then keys, all in code-point order", () => {
  const observations = [set("b:2", 1, 1), set("plain", 1, 1), set("a:x:y", 1, 1), set("b:1", 1, 1), set(":lead", 1, 1), set("B:1", 1, 1)];
  const history = keyHistory(observations, [{ owner: "kv", initial: [] }] as readonly KeyValueDefinition[], simulationTime(0));
  const model = keyLanes(history, observations, { start: simulationTime(0), end: simulationTime(10) }, null);
  assert.deepEqual(model.groups[0]!.prefixes.map(item => [item.prefix, item.rows.map(r => r.key)]), [
    [null, [":lead", "plain"]], ["B", ["B:1"]], ["a", ["a:x:y"]], ["b", ["b:1", "b:2"]],
  ]);
  assert.equal(prefixOf("lock:report:token"), "lock");
  assert.equal(prefixOf("dependency"), null);
});

test("a value that is not visible is drawn without a value, and a hidden read claims neither a hit nor a miss", () => {
  const observations = [
    record("kv.changed", "kv", { key: "k", operation: "set" }, 1),
    record("kv.read", "kv", { key: "k" }, 2),
    record("kv.changed", "kv", { key: "k", operation: "compareAndSet", before: { present: true, value: 1 }, after: { present: true, value: 2 } }, 3),
    record("kv.changed", "kv", { key: "k", operation: "compareAndDelete", before: { present: true, value: 2 }, after: { present: false } }, 4),
  ];
  const history = keyHistory(observations, [{ owner: "kv", initial: [] }] as readonly KeyValueDefinition[], simulationTime(0));
  const model = keyLanes(history, observations, { start: simulationTime(0), end: simulationTime(8) }, observations.at(-1)!.id);
  const lane = model.groups[0]!.prefixes[0]!.rows[0]!;
  assert.equal(lane.bars[0]!.visible, false);
  assert.equal(Object.hasOwn(lane.bars[0]!, "value"), false);
  // A set without stored ifAbsent is not a conditional write; a CAS is, and so is a compare-and-delete at its end.
  assert.deepEqual(lane.marks.map(mark => [mark.kind, mark.position]), [["read-hidden", 0.25], ["conditional-set", 0.375], ["conditional-set", 0.5]]);
});

test("determinism: building the lanes twice gives equal results and changes nothing", async () => {
  const projection = await run("cache-invalidated");
  const before = JSON.stringify(projection.history.observations);
  assert.deepEqual(lanes("cache-invalidated", projection), lanes("cache-invalidated", projection));
  assert.equal(JSON.stringify(projection.history.observations), before);
});

test("the module is pure: it names no DOM node, host timer, clock, catalog, React, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-lanes.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker|react|i18n|Messages)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
