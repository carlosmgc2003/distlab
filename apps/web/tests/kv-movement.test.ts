import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { RuntimeProjectionSet } from "@distlab/contracts";
import { kvCue, kvCues, kvSatelliteId } from "../src/kv-movement.ts";
import { mapArchitecture } from "../src/architecture-view.ts";
import { messages } from "../src/i18n/catalog.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
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

const architecture = (id: string) => packagedMetadata(scenarios.find(item => item.id === id)!).architecture;

test("cache-invalidated at t=11: a delete moves from Catalog to its key-value satellite", async () => {
  const { observations } = (await recorded("cache-invalidated")).history;
  const deleted = observations.find(item => item.type === "kv.changed" && item.source === "catalog" && Number(item.time) === 11)!;
  assert.deepEqual(kvCue(deleted, architecture("cache-invalidated").components), {
    kind: "movement", recordId: deleted.id, from: "catalog", to: "resource:kv:catalog", type: "kv.changed", operation: "delete", failed: false,
  });
  // A read moves with the read operation.
  const read = observations.find(item => item.type === "kv.read" && item.source === "catalog")!;
  assert.equal((kvCue(read, architecture("cache-invalidated").components) as { operation?: string }).operation, "get");
});

test("cache-stale-price at t=31: two expiries on Cart's store, with no movement", async () => {
  const { observations } = (await recorded("cache-stale-price")).history;
  const cues = kvCues(observations.filter(item => Number(item.time) === 31), architecture("cache-stale-price").components);
  assert.deepEqual(cues.map(cue => [cue.kind, "node" in cue ? cue.node : undefined]), [["no-caller", "resource:kv:cart"], ["no-caller", "resource:kv:cart"]]);
});

test("a shared key-value node never yields a kv movement: its records are card effects and its expiries cues on the node", async () => {
  const { observations } = (await recorded("lease-unfenced")).history;
  const cues = kvCues(observations, architecture("lease-unfenced").components);
  assert.ok(cues.length > 0);
  assert.ok(cues.every(cue => cue.kind !== "movement"));
  assert.deepEqual([...new Set(cues.map(cue => `${cue.kind}:${"node" in cue ? cue.node : ""}`))].sort(), ["effect:kv", "no-caller:kv"]);
});

test("the satellite id is the one the architecture graph draws for a store its service owns", async () => {
  for (const id of ["cache-stale-price", "cascade-breaker"]) {
    const metadata = architecture(id);
    const graph = mapArchitecture((await recorded(id)).architecture, metadata, id, messages("en"));
    for (const store of metadata.stores) assert.ok(graph.resourceNodes.some(node => node.id === kvSatelliteId(store.owner)), `${id} ${store.owner}`);
  }
});

test("a redacted record still moves, without an operation", () => {
  const components = architecture("cache-invalidated").components;
  const cue = kvCue({ schemaVersion: 1, id: "o1", time: 1, sequence: 1, type: "kv.changed", source: "catalog", data: { redacted: true } } as never, components);
  assert.deepEqual(cue, { kind: "movement", recordId: "o1", from: "catalog", to: "resource:kv:catalog", type: "kv.changed", failed: false });
  assert.equal(kvCue({ schemaVersion: 1, id: "o2", time: 1, sequence: 2, type: "network.request.sent", source: "catalog" } as never, components), undefined);
});

test("the movement module is pure: it names no DOM node, host timer, clock, catalog message, React, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-movement.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker|react|i18n|Messages)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});
