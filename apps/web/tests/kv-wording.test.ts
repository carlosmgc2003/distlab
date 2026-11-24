import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { CanonicalValue, Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { kvLabel, kvSentence } from "../src/kv-wording.ts";
import { recordLabel } from "../src/timeline.ts";
import { storyLabel, storyLegend, storyMilestones } from "../src/story-timeline.ts";
import { playheadSteps, recordStep, recordStepText, travelsLink } from "../src/playhead-steps.ts";
import type { RecordStep } from "../src/playhead-steps.ts";
import { componentNames } from "../src/component-display.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { messages } from "../src/i18n/catalog.ts";

const en = messages("en");
const es = messages("es");

function record(input: {
  readonly type: string; readonly id?: string; readonly source?: string; readonly time?: number; readonly sequence?: number;
  readonly causationId?: string; readonly target?: string; readonly data?: Observation["data"];
}): Observation {
  return {
    schemaVersion: 1, id: input.id ?? input.type, time: simulationTime(input.time ?? 2), sequence: input.sequence ?? 2,
    type: input.type, source: input.source ?? "kv",
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    ...(Object.hasOwn(input, "data") ? { data: input.data } : {}),
  } as Observation;
}

/** The sent request that names worker-1 as the writer, and its display name. */
const request = record({ id: "req", type: "network.request.sent", source: "worker-1", target: "kv", time: 1, sequence: 1 });
const names = new Map([["worker-1", "Worker 1"], ["kv", "Lock store"]]);
const byWorker = (type: string, data: CanonicalValue) => record({ type, causationId: "req", data });
const history = (item: Observation) => [request, item];

const absent = { present: false } as const;
const holds = (value: CanonicalValue) => ({ present: true, value });

// --- short labels: one row of the issue's table each ---

const LABELS: readonly (readonly [string, Observation, string, string])[] = [
  ["set", byWorker("kv.changed", { key: "k", operation: "set", before: absent, after: holds("v") }), "Key set: k", "Clave escrita: k"],
  ["set + ifAbsent", byWorker("kv.changed", { key: "k", operation: "set", ifAbsent: true, before: absent, after: holds("v") }),
    "Key set (set-if-absent): k", "Clave escrita (set-if-absent): k"],
  ["increment", byWorker("kv.changed", { key: "k", operation: "increment", before: absent, after: holds(1) }), "Key incremented: k", "Clave incrementada: k"],
  ["compareAndSet", byWorker("kv.changed", { key: "k", operation: "compareAndSet", before: holds("a"), after: holds("b") }),
    "Key replaced (compare-and-set): k", "Clave reemplazada (compare-and-set): k"],
  ["delete", byWorker("kv.changed", { key: "k", operation: "delete", before: holds("a"), after: absent }), "Key deleted: k", "Clave borrada: k"],
  ["compareAndDelete", byWorker("kv.changed", { key: "k", operation: "compareAndDelete", before: holds("a"), after: absent }),
    "Key deleted (compare-and-delete): k", "Clave borrada (compare-and-delete): k"],
  ["kv.expired", record({ type: "kv.expired", data: { key: "k", value: "a", expiresAt: 12, generation: 1 } }), "Key expired: k", "Clave vencida: k"],
  ["kv.read present", byWorker("kv.read", { key: "k", present: true, value: "a" }), "Key read (present): k", "Clave leída (presente): k"],
  ["kv.read absent", byWorker("kv.read", { key: "k", present: false }), "Key read (not present): k", "Clave leída (no presente): k"],
  ["kv.condition.failed", byWorker("kv.condition.failed", { key: "k", operation: "set" }),
    "Key condition failed: k", "Falló la condición de la clave: k"],
];

test("each key-value record gets its short label, with the stored key, in English and Spanish, word for word", () => {
  for (const [name, item, english, spanish] of LABELS) {
    assert.equal(recordLabel(item, en), english, name);
    assert.equal(recordLabel(item, es), spanish, name);
    // The Story strip and table use the same short label.
    assert.equal(storyLabel(item, en), english, name);
    assert.equal(storyLabel(item, es), spanish, name);
  }
});

test("an unknown operation, or a redacted or omitted payload, falls back to the record type's label", () => {
  const unknown = byWorker("kv.changed", { key: "k", operation: "rename", before: absent, after: holds("v") });
  assert.equal(kvLabel(unknown, en), undefined);
  assert.equal(recordLabel(unknown, en), "Key-value entry changed: k");
  assert.equal(recordLabel(unknown, es), "Entrada clave-valor modificada: k");
  // A read whose presence is not stored names no presence.
  assert.equal(recordLabel(byWorker("kv.read", { key: "k" }), en), "Key-value read: k");
  // `ifAbsent` is read only on a set.
  assert.equal(recordLabel(byWorker("kv.changed", { key: "k", operation: "increment", ifAbsent: true, before: absent, after: holds(1) }), en), "Key incremented: k");
  for (const [type, english, spanish] of [
    ["kv.changed", "Key-value entry changed", "Entrada clave-valor modificada"],
    ["kv.expired", "Key-value entry expired", "Entrada clave-valor vencida"],
    ["kv.read", "Key-value read", "Lectura clave-valor"],
    ["kv.condition.failed", "Key-value condition failed", "Falló la condición clave-valor"],
  ] as const) {
    for (const hidden of [record({ type, data: { redacted: true } }), record({ type })]) {
      assert.equal(kvLabel(hidden, en), undefined, type);
      assert.equal(recordLabel(hidden, en), english, type);
      assert.equal(recordLabel(hidden, es), spanish, type);
      assert.equal(kvSentence(hidden, history(hidden), en, names), undefined, `${type}: a hidden payload adds nothing`);
    }
  }
});

// --- sentences: one row of the issue's table each ---

const SENTENCES: readonly (readonly [string, Observation, string, string])[] = [
  ["set", byWorker("kv.changed", { key: "k", operation: "set", before: absent, after: holds({ a: 1 }) }),
    "Worker 1 set k.", "Worker 1 escribió k."],
  ["set + ifAbsent", byWorker("kv.changed", { key: "k", operation: "set", ifAbsent: true, before: absent, after: holds([1]) }),
    "Worker 1 set k with set-if-absent.", "Worker 1 escribió k con set-if-absent."],
  ["increment", byWorker("kv.changed", { key: "k", operation: "increment", before: holds(1), after: holds(2) }),
    "Worker 1 incremented k to 2.", "Worker 1 incrementó k a 2."],
  ["compareAndSet", byWorker("kv.changed", { key: "k", operation: "compareAndSet", before: holds("a"), after: holds({ b: 2 }) }),
    "Worker 1 replaced k with compare-and-set.", "Worker 1 reemplazó k con compare-and-set."],
  ["delete", byWorker("kv.changed", { key: "k", operation: "delete", before: holds("a"), after: absent }),
    "Worker 1 deleted k.", "Worker 1 borró k."],
  ["compareAndDelete", byWorker("kv.changed", { key: "k", operation: "compareAndDelete", before: holds("a"), after: absent }),
    "Worker 1 deleted k with compare-and-delete.", "Worker 1 borró k con compare-and-delete."],
  ["after set (scalar value)", byWorker("kv.changed", { key: "k", operation: "set", before: absent, after: holds("worker-1") }),
    "Worker 1 set k. It now holds worker-1.", "Worker 1 escribió k. Ahora guarda worker-1."],
  ["after compareAndSet (scalar value)", byWorker("kv.changed", { key: "k", operation: "compareAndSet", before: holds(1), after: holds(false) }),
    "Worker 1 replaced k with compare-and-set. It now holds false.", "Worker 1 reemplazó k con compare-and-set. Ahora guarda false."],
  ["stored expiresAt on kv.changed", byWorker("kv.changed", { key: "k", operation: "set", before: absent, after: holds({ a: 1 }), expiresAt: 12 }),
    "Worker 1 set k. It expires at t=12.", "Worker 1 escribió k. Vence en t=12."],
  ["kv.expired", record({ type: "kv.expired", time: 12, data: { key: "k", value: "a", expiresAt: 12, generation: 1 } }),
    "k expired at t=12. No component removed it: its lifetime ended.", "k venció en t=12. Ningún componente la borró: terminó su tiempo de vida."],
  ["kv.read present", byWorker("kv.read", { key: "k", present: true, value: { a: 1 } }),
    "Worker 1 read k: present.", "Worker 1 leyó k: presente."],
  ["kv.read present (scalar value)", byWorker("kv.read", { key: "k", present: true, value: 1000 }),
    "Worker 1 read k: present. It holds 1000.", "Worker 1 leyó k: presente. Guarda 1000."],
  ["kv.read absent", byWorker("kv.read", { key: "k", present: false }),
    "Worker 1 read k: not present.", "Worker 1 leyó k: no está presente."],
  ["failed set", byWorker("kv.condition.failed", { key: "k", operation: "set", expected: absent }),
    "Worker 1 could not set k: it was already present.", "Worker 1 no pudo escribir k: ya estaba presente."],
  ["failed compareAndSet", byWorker("kv.condition.failed", { key: "k", operation: "compareAndSet", expected: holds(1) }),
    "Worker 1 could not replace k: it did not hold the expected value.", "Worker 1 no pudo reemplazar k: no guardaba el valor esperado."],
  ["failed compareAndDelete", byWorker("kv.condition.failed", { key: "k", operation: "compareAndDelete", expected: holds(1) }),
    "Worker 1 could not delete k: it did not hold the expected value.", "Worker 1 no pudo borrar k: no guardaba el valor esperado."],
  ["actual present (scalar value), with expiresAt", byWorker("kv.condition.failed", {
    key: "lock:report", operation: "set", expected: absent, actual: { present: true, value: "worker-2", expiresAt: 12 },
  }), "Worker 1 could not set lock:report: it was already present. It held worker-2 until t=12.",
  "Worker 1 no pudo escribir lock:report: ya estaba presente. Guardaba worker-2 hasta t=12."],
  ["actual present (scalar value), no expiresAt", byWorker("kv.condition.failed", {
    key: "k", operation: "compareAndSet", expected: holds(1), actual: { present: true, value: 2 },
  }), "Worker 1 could not replace k: it did not hold the expected value. It held 2.",
  "Worker 1 no pudo reemplazar k: no guardaba el valor esperado. Guardaba 2."],
  ["actual absent", byWorker("kv.condition.failed", { key: "k", operation: "compareAndDelete", expected: holds(1), actual: absent }),
    "Worker 1 could not delete k: it did not hold the expected value. It was not present.",
    "Worker 1 no pudo borrar k: no guardaba el valor esperado. No estaba presente."],
];

test("each sentence of the table is produced for its case, in English and Spanish, word for word", () => {
  for (const [name, item, english, spanish] of SENTENCES) {
    assert.equal(kvSentence(item, history(item), en, names), english, name);
    assert.equal(kvSentence(item, history(item), es, names), spanish, name);
  }
});

test("a stored value is printed as stored only when it is a scalar; an object or a list gives no value sentence", () => {
  const sentence = (value: CanonicalValue) =>
    kvSentence(byWorker("kv.read", { key: "k", present: true, value }), [request], en, names);
  assert.equal(sentence("a b"), "Worker 1 read k: present. It holds a b.");
  assert.equal(sentence(0), "Worker 1 read k: present. It holds 0.");
  assert.equal(sentence(true), "Worker 1 read k: present. It holds true.");
  assert.equal(sentence(null), "Worker 1 read k: present. It holds null.");
  assert.equal(sentence({ price: 1000 }), "Worker 1 read k: present.");
  assert.equal(sentence([1, 2]), "Worker 1 read k: present.");
  // A failed condition whose live value is an object states no held value.
  const failed = byWorker("kv.condition.failed", { key: "k", operation: "set", expected: absent, actual: { present: true, value: { a: 1 }, expiresAt: 9 } });
  assert.equal(kvSentence(failed, history(failed), en, names), "Worker 1 could not set k: it was already present.");
});

test("a failed condition recorded without actual gets only the first sentence", () => {
  const older = byWorker("kv.condition.failed", { key: "lock:report", operation: "set" });
  assert.equal(kvSentence(older, history(older), en, names), "Worker 1 could not set lock:report: it was already present.");
  assert.equal(kvSentence(older, history(older), es, names), "Worker 1 no pudo escribir lock:report: ya estaba presente.");
});

test("the writer is the sender of the request the record's causationId names, else the store's owner, by display name", () => {
  const read = byWorker("kv.read", { key: "k", present: false });
  assert.equal(kvSentence(read, history(read), en, names), "Worker 1 read k: not present.");
  // Without display names, the component ID.
  assert.equal(kvSentence(read, history(read), en), "worker-1 read k: not present.");
  // A cause that is not in the history, or not a sent request, names the store's owner.
  assert.equal(kvSentence(read, [], en, names), "Lock store read k: not present.");
  const delivered = record({ id: "req", type: "network.request.delivered", source: "worker-1", target: "kv", time: 1, sequence: 1 });
  assert.equal(kvSentence(read, [delivered, read], en, names), "Lock store read k: not present.");
  // An unknown operation, a missing key, or another record type gives no sentence.
  assert.equal(kvSentence(byWorker("kv.changed", { key: "k", operation: "rename" }), [request], en), undefined);
  assert.equal(kvSentence(byWorker("kv.condition.failed", { key: "k", operation: "increment" }), [request], en), undefined);
  assert.equal(kvSentence(byWorker("kv.read", { present: false }), [request], en), undefined);
  assert.equal(kvSentence(record({ type: "runtime.log", data: { key: "k", message: "x" } }), [], en), undefined);
});

test("building labels and sentences never changes the records and gives the same text twice", () => {
  const all = [request, ...SENTENCES.map(([, item]) => item)];
  const before = JSON.stringify(all);
  const once = all.map(item => [recordLabel(item, en), kvSentence(item, all, en, names)]);
  const twice = all.map(item => [recordLabel(item, en), kvSentence(item, all, en, names)]);
  assert.deepEqual(once, twice);
  assert.equal(JSON.stringify(all), before);
});

test("contention is drawn with its own glyph and named in the legend, never as a failure", () => {
  const failed = byWorker("kv.condition.failed", { key: "k", operation: "set" });
  const read = byWorker("kv.read", { key: "k", present: false });
  const milestones = storyMilestones([request, { ...read, id: "r", sequence: 3 }, { ...failed, id: "f", sequence: 4 }], en);
  assert.deepEqual(milestones.map(item => [item.kind, item.shape]), [["request", "→"], ["kv-read", "▢"], ["contention", "⇆"]]);
  assert.deepEqual(storyLegend(milestones, en).map(item => item.label), ["Request", "Key-value read", "Contention"]);
  assert.deepEqual(storyLegend(milestones, es).map(item => item.label), ["Solicitud", "Lectura clave-valor", "Contención"]);
});

test("a key-value step carries its sentence into the playback narration; other steps carry none", () => {
  const failed = byWorker("kv.condition.failed", { key: "k", operation: "set", actual: absent });
  const step = recordStep(failed, "contention", en, history(failed), names);
  assert.equal(step.sentence, "Worker 1 could not set k: it was already present. It was not present.");
  assert.equal(recordStepText(step, en, names).announcement,
    "Key condition failed: k at Lock store, virtual time 2. Worker 1 could not set k: it was already present. It was not present.");
  const log = recordStep(record({ type: "runtime.log", data: { message: "x" } }), "log", en);
  assert.equal(Object.hasOwn(log, "sentence"), false);
});

test("the module is pure: it names no DOM node, host timer, clock, or worker command", () => {
  const source = fileURLToPath(new URL("../src/kv-wording.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage|Worker)\b/;
  const body = readFileSync(source, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden);
});

// --- the recorded runs the issue names ---

async function lessonRun(id: string) {
  const lesson = scenarios.find(item => item.id === id);
  assert.ok(lesson, `${id} is a packaged lesson`);
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: lesson.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
  assert.ok(projection, `${id} publishes a projection`);
  const metadata = packagedMetadata(lesson);
  const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name, en);
  const observations = projection.history.observations;
  const at = (time: number, type: string) => {
    const found = observations.find(item => Number(item.time) === time && item.type === type);
    assert.ok(found, `${id} records ${type} at t=${time}`);
    return found;
  };
  return { observations, edges: movementEdges(graph.edges), names: componentNames({ source: "commerce" }, projection.architecture.components, en), at };
}

test("recorded lessons: the lease is set and expires, a cached price is read, a cart is read not present", async () => {
  const lease = await lessonRun("lease-unfenced");
  const taken = lease.at(2, "kv.changed");
  // `ifAbsent` is stored once #240 lands; until then the lock's set reads as a plain set.
  const ifAbsent = (taken.data as { ifAbsent?: boolean }).ifAbsent === true;
  assert.equal(recordLabel(taken, en), ifAbsent ? "Key set (set-if-absent): lock:report" : "Key set: lock:report");
  assert.equal(kvSentence(taken, lease.observations, en, lease.names),
    `Worker 1 set lock:report${ifAbsent ? " with set-if-absent" : ""}. It now holds worker-1. It expires at t=12.`);
  const expired = lease.at(12, "kv.expired");
  assert.equal(kvSentence(expired, lease.observations, en, lease.names), "lock:report expired at t=12. No component removed it: its lifetime ended.");

  const stale = await lessonRun("cache-stale-price");
  const read = stale.at(24, "kv.read");
  assert.equal(recordLabel(read, en), "Key read (present): price:sku-1");
  // The stored value is an object, so there is no value sentence. The actor is the K1 writer: the sender of the
  // request the read's causationId names, here Orders (docs/spec/architecture-visualization.md, Key history).
  assert.equal(kvSentence(read, stale.observations, en, stale.names), "Orders read price:sku-1: present.");
  // The read at t=24 is a Story milestone and a playhead step, narrated with its sentence.
  assert.ok(storyMilestones(stale.observations, en).some(item => item.observation.id === read.id && item.kind === "kv-read"));
  const step = playheadSteps(stale.observations, stale.edges, en, stale.names).find(item => item.observationId === read.id);
  assert.ok(step && !travelsLink(step));
  assert.equal((step as RecordStep).sentence, "Orders read price:sku-1: present.");

  const invalidated = await lessonRun("cache-invalidated");
  assert.equal(kvSentence(invalidated.at(42, "kv.read"), invalidated.observations, en, invalidated.names), "Orders read cart:cart-2: not present.");
});
