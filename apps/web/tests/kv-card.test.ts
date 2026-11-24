import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { KeyValueDefinition, Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { keyHistory, storeAt } from "../src/kv-history.ts";
import { CARD_ENTRIES, storeCards } from "../src/kv-card.ts";
import type { StoreCard } from "../src/kv-card.ts";
import { recordKind } from "../src/records.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

async function recorded(id: string): Promise<RuntimeProjectionSet> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  const choice = scenarios.find(item => item.id === id)!;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
  assert.ok(projection);
  return projection;
}

function definitions(id: string): { readonly start: number; readonly stores: readonly KeyValueDefinition[] } {
  const scenario = scenarios.find(item => item.id === id)!.scenario as unknown as { startTime: number; architecture: { stores: readonly KeyValueDefinition[] } };
  return { start: scenario.startTime, stores: scenario.architecture.stores };
}

function cardsAt(id: string, observations: readonly Observation[], positionId: string | null): readonly StoreCard[] {
  const { start, stores } = definitions(id);
  return storeCards(keyHistory(observations, stores, simulationTime(start), positionId), observations);
}

function card(cards: readonly StoreCard[], owner: string): StoreCard {
  const found = cards.find(item => item.owner === owner);
  assert.ok(found, owner);
  return found;
}

test("at every milestone of the six lessons with a store, the card's entries equal the key history there", async () => {
  for (const id of ["lease-unfenced", "lease-fenced", "cache-stale-price", "cache-invalidated", "cascade-unprotected", "cascade-breaker"]) {
    const { observations } = (await recorded(id)).history;
    const { start, stores } = definitions(id);
    for (const record of observations.filter(item => recordKind(item) !== undefined)) {
      const reading = keyHistory(observations, stores, simulationTime(start), record.id);
      const cards = storeCards(reading, observations);
      for (const state of storeAt(reading)) {
        const item = card(cards, state.owner);
        const expected = state.entries.map(entry => [entry.key, entry.value, entry.writer, entry.expiresAt]);
        assert.deepEqual(item.shown.map(entry => [entry.key, entry.value, entry.writer, entry.expiresAt]), expected.slice(0, CARD_ENTRIES), `${id} ${record.id}`);
        assert.equal(item.more, Math.max(0, expected.length - CARD_ENTRIES), `${id} ${record.id}`);
      }
    }
  }
});

test("lease-unfenced: the token at t=14, the expiry only at its own record, and the effect of worker-1's set", async () => {
  const { observations } = (await recorded("lease-unfenced")).history;
  // No record is stored at t=14: the last record at or before it is the position there.
  const at14 = observations.filter(item => Number(item.time) <= 14).at(-1)!;
  const kv14 = card(cardsAt("lease-unfenced", observations, at14.id), "kv");
  assert.deepEqual(kv14.shown.map(entry => [entry.key, entry.value]), [["lock:report:token", 1]]);
  assert.deepEqual(kv14.ended, at14.type === "kv.expired" ? [{ key: "lock:report", cause: "expired", time: 12 }] : []);
  // On the expiry record itself, the ended entry is listed.
  const expiry = observations.find(item => item.type === "kv.expired" && Number(item.time) === 12)!;
  assert.deepEqual(card(cardsAt("lease-unfenced", observations, expiry.id), "kv").ended, [{ key: "lock:report", cause: "expired", time: 12 }]);
  assert.deepEqual(card(cardsAt("lease-unfenced", observations, expiry.id), "kv").effect, { type: "kv.expired", key: "lock:report" });
  // On worker-1's set at t=2: the effect names the key, the operation, and worker-1; the lease has its whole lifetime left.
  const set = observations.find(item => item.type === "kv.changed" && Number(item.time) === 2)!;
  const kv2 = card(cardsAt("lease-unfenced", observations, set.id), "kv");
  assert.deepEqual(kv2.effect, { type: "kv.changed", key: "lock:report", operation: "set", writer: "worker-1" });
  assert.deepEqual(kv2.shown.map(entry => [entry.key, entry.value, entry.expiresAt, entry.remaining]), [["lock:report", "worker-1", 12, 1]]);
  // At worker-1's lease check (t=5), 7 of its 10 ms are left.
  const check = observations.find(item => item.type === "runtime.log" && Number(item.time) === 5)!;
  assert.equal(card(cardsAt("lease-unfenced", observations, check.id), "kv").shown.find(entry => entry.key === "lock:report")!.remaining, 0.7);
});

test("cache-invalidated at t=11: Catalog's card lists the price as deleted", async () => {
  const { observations } = (await recorded("cache-invalidated")).history;
  const deleted = observations.find(item => item.type === "kv.changed" && item.source === "catalog" && Number(item.time) === 11)!;
  const catalog = card(cardsAt("cache-invalidated", observations, deleted.id), "catalog");
  assert.deepEqual(catalog.ended, [{ key: "price:sku-1", cause: "deleted", time: 11 }]);
  assert.deepEqual(catalog.shown, []);
  assert.equal(catalog.effect?.operation, "delete");
});

test("a card lists four entries and counts the rest; a hidden value is listed without its value", () => {
  const observations = ["a", "b", "c", "d", "e", "f"].map((key, index) => ({
    schemaVersion: 1, id: `o${index + 1}`, time: simulationTime(1), sequence: index + 1, type: "kv.changed", source: "kv",
    data: key === "a" ? { key, operation: "set" } : { key, operation: "set", before: { present: false }, after: { present: true, value: index } },
  })) as unknown as Observation[];
  const reading = keyHistory(observations, [{ owner: "kv", initial: [] }] as unknown as readonly KeyValueDefinition[], simulationTime(0));
  const kv = card(storeCards(reading, observations), "kv");
  assert.deepEqual(kv.shown.map(entry => entry.key), ["a", "b", "c", "d"]);
  assert.equal(kv.more, 2);
  assert.equal(kv.shown[0]!.visible, false);
  assert.equal(Object.hasOwn(kv.shown[0]!, "value"), false);
  // Before the first record there is no effect.
  assert.equal(card(storeCards(keyHistory(observations, [{ owner: "kv", initial: [] }] as unknown as readonly KeyValueDefinition[], simulationTime(0), null), observations), "kv").effect, undefined);
});

test("the card module is pure: it names no DOM node, host timer, clock, catalog message, React, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-card.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker|react|i18n|Messages)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
