import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ArchitectureDefinition, DatabaseDefinition, KeyValueDefinition, Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { keyHistory } from "../src/kv-history.ts";
import { keyLenses, roleOf } from "../src/kv-lenses.ts";
import type { KeyLens } from "../src/kv-lenses.ts";
import { commerceKeyRoles } from "../../../packages/catalogs/src/commerce/key-roles.ts";
import { commerceDescriptors } from "../../../packages/catalogs/src/commerce/descriptors.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

interface Recorded { readonly projection: RuntimeProjectionSet; readonly lenses: readonly KeyLens[] }

async function recorded(id: string): Promise<Recorded> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  const choice = scenarios.find(item => item.id === id)!;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
  assert.ok(projection);
  const scenario = choice.scenario as unknown as { startTime: number; architecture: ArchitectureDefinition };
  const { observations } = projection.history;
  const history = keyHistory(observations, scenario.architecture.stores as readonly KeyValueDefinition[], simulationTime(scenario.startTime));
  return { projection, lenses: keyLenses({ history, observations, components: scenario.architecture.components,
    databases: scenario.architecture.databases as readonly DatabaseDefinition[], roles: commerceKeyRoles }) };
}

function lens<R extends KeyLens["role"]>(lenses: readonly KeyLens[], owner: string, key: string, role: R): Extract<KeyLens, { role: R }> {
  const found = lenses.find(item => item.owner === owner && item.key === key);
  assert.ok(found, `${owner} ${key}`);
  assert.equal(found.role, role);
  return found as Extract<KeyLens, { role: R }>;
}

test("lease-unfenced: worker-1's late storage commit is outside its lease, and the token is a fencing counter", async () => {
  const { projection, lenses } = await recorded("lease-unfenced");
  const lease = lens(lenses, "kv", "lock:report", "lease");
  const byId = new Map(projection.history.observations.map(record => [record.id, record]));
  assert.deepEqual(lease.overruns.map(item => [item.holder, item.endedAt]), [["worker-1", 12], ["worker-2", 27]]);
  const late = lease.overruns[0]!.recordIds.map(id => byId.get(id)!);
  const commit = late.find(record => record.type === "database.transaction.committed");
  assert.ok(commit, "the storage commit is outside worker-1's lease");
  assert.equal(commit.source, "storage");
  assert.equal(Number(commit.time), 36);
  // Every marked record is after the lease ended, in the trace of the set that took it, and none is the expiry itself.
  const acquired = byId.get(lease.overruns[0]!.acquiredId)!;
  assert.ok(late.every(record => record.traceId === acquired.traceId && Number(record.time) >= 12 && record.type !== "kv.expired"));
  // Worker-2's write and answer came before its lease ended, so nothing of its trace is outside it.
  assert.ok(lease.overruns[1]!.recordIds.every(id => byId.get(id)!.type !== "database.transaction.committed"));
  lens(lenses, "kv", "lock:report:token", "fencing-counter");
});

test("cache-stale-price: the cached price is stale from the price commit at t=11 to the entry's end at t=101", async () => {
  const { projection, lenses } = await recorded("cache-stale-price");
  const price = lens(lenses, "catalog", "price:sku-1", "cached-copy");
  assert.deepEqual(price.stale.map(item => [Number(item.start), Number(item.end)]), [[11, 101]]);
  // The read at t=24 that returned the stale price falls inside the band.
  const hit = projection.history.observations.find(record => record.type === "kv.read" && record.source === "catalog" && Number(record.time) === 24);
  assert.ok(hit && Number(hit.time) >= 11 && Number(hit.time) < 101);
  lens(lenses, "cart", "cart:cart-1", "session");
  lens(lenses, "cart", "cart:cart-2", "session");
});

test("cache-invalidated: the cached price is never stale for any length of time", async () => {
  const { lenses } = await recorded("cache-invalidated");
  assert.deepEqual(lens(lenses, "catalog", "price:sku-1", "cached-copy").stale, []);
});

test("cascade-breaker: payments' breaker moves CLOSED, OPEN, HALF_OPEN, CLOSED", async () => {
  const { lenses } = await recorded("cascade-breaker");
  const payments = lens(lenses, "payments", "dependency", "breaker-state");
  assert.deepEqual(payments.states.map(item => [item.label, Number(item.start)]), [["CLOSED", 3], ["OPEN", 24], ["HALF_OPEN", 68], ["CLOSED", 70]]);
  // Consecutive states share their boundaries, and the last is still held.
  for (let index = 1; index < payments.states.length; index += 1) assert.equal(Number(payments.states[index - 1]!.end), Number(payments.states[index]!.start));
  assert.equal(payments.states.at(-1)!.end, undefined);
  assert.deepEqual(lens(lenses, "api", "dependency", "breaker-state").states.map(item => item.label), ["CLOSED"]);
});

test("a key with no matching role yields no lens, and the owner's model is consulted before the writers'", () => {
  const components = [
    { id: "kv", kind: "service", model: "commerce.kv-server", version: "1.0.0", configuration: {} },
    { id: "worker", kind: "service", model: "commerce.lease-worker", version: "1.0.0", configuration: {} },
  ] as unknown as ArchitectureDefinition["components"];
  assert.equal(roleOf("lock:report", ["kv", "worker"], components, commerceKeyRoles)?.role, "lease");
  assert.equal(roleOf("lock:report:token", ["kv", "worker"], components, commerceKeyRoles)?.role, "fencing-counter");
  assert.equal(roleOf("other", ["kv", "worker"], components, commerceKeyRoles), undefined);
  // An unknown version of a model declares nothing.
  assert.equal(roleOf("lock:report", ["worker"], [{ ...components[1]!, version: "9.9.9" }], commerceKeyRoles), undefined);
  const observations = [{ schemaVersion: 1, id: "o1", time: simulationTime(1), sequence: 1, type: "kv.changed", source: "kv",
    data: { key: "other", operation: "set", before: { present: false }, after: { present: true, value: 1 } } }] as unknown as Observation[];
  const history = keyHistory(observations, [{ owner: "kv", initial: [] }] as unknown as readonly KeyValueDefinition[], simulationTime(0));
  assert.deepEqual(keyLenses({ history, observations, components, databases: [], roles: commerceKeyRoles }), []);
});

test("every key role names a commerce descriptor's model and version", () => {
  for (const declared of commerceKeyRoles) {
    assert.ok(commerceDescriptors.some(descriptor => descriptor.model === declared.model && descriptor.version === declared.version), `${declared.model}@${declared.version}`);
  }
});

test("determinism: the lenses are equal twice and change no record", async () => {
  const first = await recorded("cache-stale-price");
  const before = JSON.stringify(first.projection.history.observations);
  assert.deepEqual(first.lenses, (await recorded("cache-stale-price")).lenses);
  assert.equal(JSON.stringify(first.projection.history.observations), before);
});

test("the lens module is pure: it names no DOM node, host timer, clock, catalog message, React, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-lenses.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker|react|i18n|Messages)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
