import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { KeyValueDefinition, Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { keyHistory } from "../src/kv-history.ts";
import type { KeyHistoryReading } from "../src/kv-history.ts";
import { compareKeyHistories } from "../src/kv-compare.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

async function history(id: string): Promise<KeyHistoryReading> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  const choice = scenarios.find(item => item.id === id)!;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
  assert.ok(projection);
  const scenario = choice.scenario as unknown as { startTime: number; architecture: { stores: readonly KeyValueDefinition[] } };
  return keyHistory(projection.history.observations, scenario.architecture.stores, simulationTime(scenario.startTime));
}

let sequence = 0;
function changed(key: string, value: Observation["data"] | undefined, time: number, operation = "set", extra: Record<string, unknown> = {}): Observation {
  sequence += 1;
  const data = value === undefined ? { key, operation } : { key, operation, before: { present: false }, after: { present: true, value }, ...extra };
  return { schemaVersion: 1, id: `o${sequence}`, time: simulationTime(time), sequence, type: "kv.changed", source: "kv", data } as Observation;
}
const read = (observations: readonly Observation[]): KeyHistoryReading =>
  keyHistory(observations, [{ owner: "kv", initial: [] }] as readonly KeyValueDefinition[], simulationTime(0));

test("cache-stale-price against cache-invalidated: the price key differs three times, the carts not at all", async () => {
  const comparison = compareKeyHistories(await history("cache-stale-price"), await history("cache-invalidated"));
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.stores.map(store => [store.owner, store.keys.map(key => key.key)]), [
    ["catalog", ["price:sku-1"]], ["cart", ["cart:cart-1", "cart:cart-2"]],
  ]);
  const price = comparison.stores[0]!.keys[0]!;
  assert.deepEqual(price.earlier.map(segment => [segment.value, segment.start, segment.end?.time, segment.end?.cause]), [
    [{ sku: "sku-1", price: 1000, version: 1 }, 1, 101, "expired"],
  ]);
  assert.deepEqual(price.current.map(segment => [segment.value, segment.start, segment.end?.time, segment.end?.cause]), [
    [{ sku: "sku-1", price: 1000, version: 1 }, 1, 11, "delete"],
    [{ sku: "sku-1", price: 1200, version: 2 }, 24, 124, "expired"],
  ]);
  assert.deepEqual(price.differences, [
    { side: "earlier", index: 0, kind: "end" },
    { side: "current", index: 0, kind: "end" },
    { side: "current", index: 1, kind: "only-here" },
  ]);
  for (const key of comparison.stores[1]!.keys) assert.deepEqual(key.differences, [], key.key);
});

test("two equal histories yield no difference", async () => {
  const comparison = compareKeyHistories(await history("lease-unfenced"), await history("lease-fenced"));
  // The pair differs only in storage's fencing check, so the key-value node holds the same keys at the same times.
  assert.equal(comparison.equal, true);
  const synthetic = [changed("k", 1, 1), changed("k", 2, 3)];
  assert.equal(compareKeyHistories(read(synthetic), read(synthetic)).equal, true);
});

test("structural equality: equal objects with keys in another order are equal", () => {
  const left = read([changed("k", { a: 1, b: [1, { c: 2, d: 3 }] }, 1)]);
  const right = read([changed("k", { b: [1, { d: 3, c: 2 }], a: 1 }, 1)]);
  assert.equal(compareKeyHistories(left, right).equal, true);
  const other = read([changed("k", { a: 1, b: [{ c: 2, d: 3 }, 1] }, 1)]);
  assert.deepEqual(compareKeyHistories(left, other).stores[0]!.keys[0]!.differences, [
    { side: "earlier", index: 0, kind: "value" }, { side: "current", index: 0, kind: "value" },
  ]);
});

test("a value that is not visible on either side is compared by time and cause only", () => {
  const hidden = read([changed("k", undefined, 1), changed("k", 3, 5)]);
  const visible = read([changed("k", 99, 1), changed("k", 3, 5)]);
  assert.equal(compareKeyHistories(hidden, visible).equal, true);
  // The time still counts: same end and cause, so each side started differently.
  const later = read([changed("k", 99, 2), changed("k", 3, 5)]);
  assert.deepEqual(compareKeyHistories(hidden, later).stores[0]!.keys[0]!.differences, [
    { side: "earlier", index: 0, kind: "start" }, { side: "current", index: 0, kind: "start" },
  ]);
});

test("a store or key on one side only is only-here", () => {
  const left = read([changed("a", 1, 1)]);
  const right = keyHistory([{ ...changed("b", 1, 1), source: "other" }], [{ owner: "kv", initial: [] }] as readonly KeyValueDefinition[], simulationTime(0));
  const comparison = compareKeyHistories(left, right);
  assert.deepEqual(comparison.stores.map(store => [store.owner, store.keys.map(key => [key.key, key.differences])]), [
    ["kv", [["a", [{ side: "earlier", index: 0, kind: "only-here" }]]]],
    ["other", [["b", [{ side: "current", index: 0, kind: "only-here" }]]]],
  ]);
});

test("the module is pure: it names no DOM node, host timer, clock, catalog, React, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-compare.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker|react|i18n|Messages)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
