import assert from "node:assert/strict";
import test from "node:test";
import type { AssessmentCell, AssessmentConfiguration, AssessmentRowResult, CanonicalValue, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import {
  commerceAssessment, commerceCatalog, reliableCheckoutAssessment, reliableCheckoutOverlayPolicy, reliableCheckoutScenario,
} from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, composeOverlay, openHarness } from "@distlab/scenario";
import { messages } from "../src/i18n/catalog.ts";
import { canonicalJson, exportFile, assessmentResult, rowCells, rowFinishedText, rowOutcome, rowOverlay, rowStartedText, suiteSummary } from "../src/assessment.ts";
import { reproduceRow, runSuite } from "../src/assessment-runner.ts";
import type { SuiteHost } from "../src/assessment-runner.ts";
import { SimulationHost } from "../src/host.ts";
import type { HostSnapshot, WorkerPort } from "../src/host.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { projection } from "./support.ts";

const definition = reliableCheckoutAssessment;
const base = reliableCheckoutScenario;
const defaults: AssessmentConfiguration = { parameters: [] };
const protectedDesign: AssessmentConfiguration = { parameters: [
  { key: "compensation", value: true }, { key: "consumer-idempotency", value: true }, { key: "idempotency", value: true },
  { key: "outbox", value: true }, { key: "retries", value: 1 },
] };

/** The worker runtime in-process, behind the real host: every command crosses the protocol as in the browser. */
class AdapterWorker extends EventTarget implements WorkerPort {
  readonly commands: WorkerCommand[] = [];
  readonly #adapter = new WorkerAdapter(event => { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: event }))); });
  postMessage(command: WorkerCommand): void { this.commands.push(structuredClone(command)); void this.#adapter.receive(command); }
  terminate(): void {}
}
function workerHost() {
  const workers: AdapterWorker[] = [];
  const host = new SimulationHost(() => { const worker = new AdapterWorker(); workers.push(worker); return worker; });
  return { host, commands: () => workers.flatMap(worker => worker.commands) };
}

/** The stored verdicts a headless run of the same row gives, for comparison. */
async function headless(row: (typeof definition.rows)[number], configuration: AssessmentConfiguration) {
  const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
  const composed = composeOverlay(base, reliableCheckoutOverlayPolicy, rowOverlay(row, configuration) as unknown as CanonicalValue, value => engine.validate(value), commerceCatalog);
  assert.ok(composed.ok);
  const session = openHarness(engine.create(composed.document));
  await session.run();
  return session.inspect().results;
}

const client = (assertions: CanonicalValue): RuntimeProjectionSet => ({
  ...projection("COMPLETED"),
  components: [{ componentId: "client", visibility: "student", state: { role: "commerce-client", observed: {}, assertions } }],
  history: { observations: [
    { id: "obs-1", sequence: 1, time: 5, type: "scenario.assertion.evaluated", data: { assertionId: "charged-at-most-once", status: "PASS" } },
    { id: "obs-2", sequence: 2, time: 200, type: "scenario.assertion.evaluated", data: { assertionId: "failed-order-uncharged", status: "FAIL" } },
    { id: "obs-3", sequence: 3, time: 200, type: "scenario.assertion.evaluated", data: { assertionId: "notified-exactly-once", status: "PASS" } },
  ] as unknown as RuntimeProjectionSet["history"]["observations"] },
});

test("a row's overlay is its faults plus the configuration's parameters, unchanged across rows (ASSESS-INV-4)", () => {
  for (const row of definition.rows) {
    const overlay = rowOverlay(row, protectedDesign);
    assert.deepEqual(overlay, { version: 1, faults: row.faults, scheduledFaults: row.scheduledFaults, parameters: protectedDesign.parameters });
  }
  assert.equal(rowOverlay(definition.rows[0]!, defaults).architecture, undefined, "no architecture edits until #112");
});

test("ASSESS-AC-3: a cell is the stored verdict; PENDING or INCOMPLETE at the end of a run reads INCOMPLETE", () => {
  const cells = rowCells(definition, client([
    { id: "notified-exactly-once", status: "PASS", time: 200, evidence: null },
    { id: "charged-at-most-once", status: "PASS", time: 5, evidence: null },
    { id: "failed-order-uncharged", status: "FAIL", time: 200, evidence: null },
    { id: "order-final", status: "PENDING", time: 0, evidence: null },
  ]));
  // Column order is the definition's, not the stored order.
  assert.deepEqual(cells, [
    { invariant: "charged-at-most-once", verdict: "HOLDS", time: 5, evidence: "obs-1" },
    { invariant: "failed-order-uncharged", verdict: "VIOLATED", time: 200, evidence: "obs-2" },
    { invariant: "notified-exactly-once", verdict: "HOLDS", time: 200, evidence: "obs-3" },
    { invariant: "order-final", verdict: "INCOMPLETE", time: 0, evidence: null },
  ]);
  const incomplete = rowCells(definition, client([{ id: "charged-at-most-once", status: "INCOMPLETE", time: 7, evidence: null }]));
  assert.deepEqual(incomplete.map(cell => [cell.verdict, cell.evidence]), [["INCOMPLETE", null], ["INCOMPLETE", null], ["INCOMPLETE", null], ["INCOMPLETE", null]],
    "an INCOMPLETE stored verdict, and a check with no stored verdict, link no evidence");
});

test("a row passes when every invariant holds (D-4), and the live region names the row and its count", () => {
  const result = (verdicts: string[]): AssessmentRowResult => ({ row: "processor-response-lost", runId: "run:x", status: "COMPLETED",
    cells: verdicts.map((verdict, index) => ({ invariant: `i${index}`, verdict: verdict as "HOLDS", time: 0 as never, evidence: null })) });
  assert.equal(rowOutcome(result(["HOLDS", "HOLDS", "HOLDS", "HOLDS"])), "PASS");
  assert.equal(rowOutcome(result(["HOLDS", "VIOLATED", "INCOMPLETE", "HOLDS"])), "FAIL");
  assert.equal(rowOutcome(result(["HOLDS", "INCOMPLETE", "HOLDS", "HOLDS"])), "INCOMPLETE");
  const row = definition.rows[3]!;
  assert.equal(rowStartedText(3, 6, definition, row, messages("en")), "Row 4 of 6: Processor response lost — running");
  assert.equal(rowFinishedText(2, 6, definition, row, result(["HOLDS", "VIOLATED", "HOLDS", "HOLDS"]), messages("en")), "Row 3 of 6: Processor response lost — 1 of 4 invariants violated");
  assert.equal(rowFinishedText(2, 6, definition, row, result(["HOLDS", "HOLDS", "HOLDS", "HOLDS"]), messages("en")), "Row 3 of 6: Processor response lost — all 4 invariants hold");
  assert.equal(suiteSummary([result(["HOLDS"]), result(["VIOLATED"])], 6, messages("en")), "2 of 6 rows run, 1 pass");
  assert.equal(suiteSummary([result(["HOLDS"])], 1, messages("en")), "1 of 1 row pass");
  // Spanish: whole phrases per plural form, and the row's label from the catalog's translation by id.
  const es = messages("es");
  assert.equal(rowStartedText(3, 6, definition, row, es), "Fila 4 de 6: Respuesta del procesador perdida — en ejecución");
  assert.equal(rowFinishedText(2, 6, definition, row, result(["HOLDS", "VIOLATED", "HOLDS", "HOLDS"]), es), "Fila 3 de 6: Respuesta del procesador perdida — 1 de 4 invariantes violados");
  assert.equal(rowFinishedText(2, 6, definition, row, result(["HOLDS"]), es), "Fila 3 de 6: Respuesta del procesador perdida — se cumple el único invariante");
  assert.equal(suiteSummary([result(["HOLDS"]), result(["VIOLATED"])], 6, es), "2 de 6 filas ejecutadas, 1 superada");
  assert.equal(suiteSummary([result(["HOLDS"]), result(["HOLDS"])], 2, es), "2 de 2 filas superadas");
});

test("the export is canonical JSON: sorted keys, the same encoding the kernel uses, and no wall-clock time", () => {
  const value = { b: [1, { d: true, c: null }], a: "x" } as unknown as CanonicalValue;
  assert.equal(canonicalJson(value), `${canonicalEncode(value)}\n`);
  const result = assessmentResult(definition, "reliable-checkout-1", defaults, []);
  const file = exportFile(result);
  assert.equal(file.fileName, "reliable-checkout-assessment@1-result.json");
  assert.deepEqual(JSON.parse(file.text), result);
  assert.deepEqual(Object.keys(JSON.parse(file.text)), ["assessment", "base", "configuration", "format", "formatVersion", "rows", "seed"]);
});

test("ASSESS-AC-1 and ASSESS-AC-3: each row is one load of the exact base document with the row's overlay, then run; cells equal the stored verdicts", async () => {
  const { host, commands } = workerHost();
  const progress: string[] = [];
  const outcome = await runSuite(host, definition, base, defaults, { onProgress: item => progress.push(`${item.type}:${item.row.id}`) });
  assert.equal(outcome.status, "completed");
  const sent = commands();
  assert.deepEqual([...new Set(sent.map(command => command.type))].sort(), ["load", "run"], "no other command type is sent");
  const loads = sent.filter((command): command is Extract<WorkerCommand, { type: "load" }> => command.type === "load");
  assert.equal(loads.length, definition.rows.length);
  loads.forEach((command, index) => {
    assert.equal(canonicalEncode(command.scenario!), canonicalEncode(base), "the exact packaged base document");
    assert.deepEqual(command.overlay, rowOverlay(definition.rows[index]!, defaults));
  });
  assert.deepEqual(progress, definition.rows.flatMap(row => [`row-started:${row.id}`, `row-finished:${row.id}`]));
  for (const [index, row] of definition.rows.entries()) {
    const stored = await headless(row, defaults);
    const cells: readonly AssessmentCell[] = outcome.rows[index]!.cells;
    assert.deepEqual(cells.map(cell => cell.verdict), stored.map(item => item.status === "PASS" ? "HOLDS" : item.status === "FAIL" ? "VIOLATED" : "INCOMPLETE"), row.id);
    assert.deepEqual(cells.map(cell => cell.time), stored.map(item => item.time), row.id);
    assert.ok(cells.every(cell => cell.evidence !== null), `${row.id}: every settled verdict links its evaluation record`);
  }
  // The spec's expected outcomes (ASSESS-AC-4), now through the browser runtime.
  assert.deepEqual(outcome.rows.map(rowOutcome), ["PASS", "FAIL", "FAIL", "FAIL", "PASS", "FAIL"]);
  // D-5: the worker holds the last row's session.
  assert.equal(host.getSnapshot().projection?.simulation.runId, outcome.rows.at(-1)!.runId);
});

test("ASSESS-AC-5: the same definition and configuration export byte-identical results, and reloading any row reproduces its runId", async () => {
  const first = await runSuite(workerHost().host, definition, base, protectedDesign);
  const { host } = workerHost();
  const second = await runSuite(host, definition, base, protectedDesign);
  const text = (rows: readonly AssessmentRowResult[]) => exportFile(assessmentResult(definition, "reliable-checkout-1", protectedDesign, rows)).text;
  assert.equal(text(second.rows), text(first.rows));
  assert.deepEqual(first.rows.map(rowOutcome), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
  for (const [index, row] of definition.rows.entries()) {
    const reproduced = await reproduceRow(host, definition, base, row, protectedDesign, second.rows[index]!);
    assert.deepEqual(reproduced, { status: "reproduced" }, row.id);
    assert.equal(host.getSnapshot().projection?.simulation.runId, second.rows[index]!.runId);
  }
});

test("ASSESS-AC-6: a reloaded row whose runId differs is reported, not opened", async () => {
  const { host } = workerHost();
  const outcome = await runSuite(host, definition, base, defaults);
  const row = definition.rows[0]!;
  const forged = { ...outcome.rows[0]!, runId: "run:not-this-one" };
  const result = await reproduceRow(host, definition, base, row, defaults, forged);
  assert.equal(result.status, "mismatch");
  assert.equal(result.status === "mismatch" ? result.runId : "", outcome.rows[0]!.runId);
});

test("ASSESS-AC-8: a rejected row load stops the suite and names the row and its diagnostics", async () => {
  const { host, commands } = workerHost();
  const outcome = await runSuite(host, definition, base, { parameters: [{ key: "retries", value: 9 }] });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.status === "rejected" ? outcome.row.id : "", "happy-path");
  assert.deepEqual(outcome.status === "rejected" ? outcome.diagnostics : [], [{ path: "/parameters/0/value", code: "PARAMETER_VALUE" }]);
  assert.deepEqual(outcome.rows, []);
  assert.deepEqual(commands().map(command => command.type), ["load"], "nothing runs after the rejection");
});

/** A host whose second row's run fails: its projection ends FAILED with unsettled verdicts. */
function failingHost(): SuiteHost & { readonly commands: string[] } {
  const commands: string[] = [];
  let loads = 0;
  let current: RuntimeProjectionSet | null = null;
  const snapshot = (): HostSnapshot => ({ projection: current, error: null, loading: false, pendingCommands: [], attempt: 0, session: null, document: null });
  const settled = (status: "COMPLETED" | "FAILED", verdict: string): RuntimeProjectionSet => ({
    ...client(definition.invariants.map(({ id }) => ({ id, status: verdict, time: 9, evidence: null }))),
    simulation: { ...projection(status).simulation, runId: `run:${loads}`, status, time: 9 as never },
  });
  return {
    commands,
    getSnapshot: snapshot,
    load: async () => { commands.push("load"); loads++; current = { ...projection("READY"), simulation: { ...projection("READY").simulation, runId: `run:${loads}` } }; return { version: 1, requestId: "r", type: "loaded" } as unknown as WorkerEvent; },
    run: async () => {
      commands.push("run");
      if (loads === 2) { current = settled("FAILED", "PENDING"); throw { code: "SIMULATION_FAILED", message: "failed", context: null }; }
      current = settled("COMPLETED", "PASS");
      return { version: 1, requestId: "r", type: "run.finished", status: "COMPLETED" };
    },
  };
}

test("ASSESS-AC-8: a FAILED row run does not stop the suite; its unsettled cells read INCOMPLETE", async () => {
  const host = failingHost();
  const outcome = await runSuite(host, definition, base, defaults);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.rows.length, definition.rows.length);
  assert.equal(outcome.rows[1]!.status, "FAILED");
  assert.deepEqual(outcome.rows[1]!.cells.map(cell => cell.verdict), ["INCOMPLETE", "INCOMPLETE", "INCOMPLETE", "INCOMPLETE"]);
  assert.deepEqual(outcome.rows[1]!.cells[0], { invariant: "charged-at-most-once", verdict: "INCOMPLETE", time: 9, evidence: null });
  assert.equal(rowOutcome(outcome.rows[2]!), "PASS", "the suite continued with the next row");
});

test("Stop ends the suite after the current row and keeps the rows already finished", async () => {
  const host = failingHost();
  let stop = false;
  const outcome = await runSuite(host, definition, base, defaults, { onProgress: item => { if (item.type === "row-finished") stop = true; }, stopRequested: () => stop });
  assert.equal(outcome.status, "stopped");
  assert.equal(outcome.rows.length, 1);
  assert.deepEqual(host.commands, ["load", "run"]);
});
