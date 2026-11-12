import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import { hostedCatalogs } from "@distlab/catalogs";
import { canonicalEncode } from "@distlab/kernel";
import { DeterministicScenarioEngine, openHarness, resolveHostedCatalog, validateScenarioDocument } from "@distlab/scenario";
import type { HarnessExport } from "@distlab/scenario";
import { messages } from "../src/i18n/catalog.ts";
import { assessments, lessonDescription, lessonTitle, scenarios, starterSource } from "../src/scenarios.ts";
import { starterDocument, starterFile, starterName } from "../src/starter-file.ts";

// #116: save a packaged lesson as a starter scenario file (ADR-006 "Follow-up work" item 4, DOC-AC-2).

type Doc = Record<string, unknown>;
const en = messages("en");
const es = messages("es");
const packagedNames = scenarios.map(choice => (choice.scenario as Doc).name as string);

async function results(run: Promise<HarnessExport>): Promise<{ status: string; runId: string; results: string }> {
  const exported = await run;
  // Renaming changes runId, and evidence may carry IDs derived from it (message IDs); everything else must be equal.
  return { status: exported.status, runId: exported.history.runId, results: canonicalEncode(exported.results as unknown as CanonicalValue).replaceAll(exported.history.runId, "run:<this run>") };
}
async function inspect(engine: DeterministicScenarioEngine, scenario: CanonicalValue): Promise<HarnessExport> {
  const session = openHarness(engine.create(scenario));
  await session.run();
  return session.inspect();
}

test("a starter's scenario name puts -copy before the packaged version", () => {
  assert.equal(starterName("retry-unsafe@1"), "retry-unsafe-copy@1");
  assert.equal(starterName("checkout-processor-response-lost@1"), "checkout-processor-response-lost-copy@1");
  assert.equal(starterName("unversioned"), "unversioned-copy");
});

test("Retry: idempotent downloads retry-idempotent-copy.json with the lesson's copy, catalog, labels, and renamed policy", () => {
  const choice = scenarios.find(item => item.id === "retry-idempotent")!;
  const file = starterFile(starterSource(choice, en));
  assert.equal(file.fileName, "retry-idempotent-copy.json");
  const document = starterDocument(starterSource(choice, en));
  // Pretty-printed JSON of exactly the built document, ending in a newline.
  assert.equal(file.text, `${JSON.stringify(document, null, 2)}\n`);
  assert.deepEqual(Object.keys(document), ["format", "formatVersion", "catalog", "presentation", "scenario", "overlayPolicy"]);
  assert.equal(document.format, "distlab.scenario");
  assert.equal(document.formatVersion, 1);
  assert.deepEqual(document.catalog, { id: "commerce.lessons", version: "1.0.0" });
  assert.deepEqual(document.presentation, {
    title: "Retry with idempotency",
    summary: "The same lost response and retry produce one payment and the original result.",
    assertions: { "one-payment-per-order": "A retried payment request charges the order once" },
  });
  assert.equal((document.scenario as Doc).name, "retry-idempotent-copy@1");
  assert.equal(document.overlayPolicy.lesson, "retry-idempotent-copy@1");
  // Apart from its name, the scenario and the policy are the packaged ones, unchanged.
  assert.deepEqual({ ...(document.scenario as Doc), name: (choice.scenario as Doc).name }, choice.scenario);
  assert.deepEqual({ ...document.overlayPolicy, lesson: choice.policy.lesson }, choice.policy);
});

test("checkout starters carry no assertion labels, so each check shows its ID", () => {
  for (const id of ["normal", "response-lost"]) {
    const choice = scenarios.find(item => item.id === id)!;
    const document = starterDocument(starterSource(choice, en));
    assert.deepEqual(document.presentation, { title: lessonTitle(choice, en), summary: lessonDescription(choice, en) });
    assert.deepEqual(document.catalog, { id: "mvp.checkout", version: "1.0.0" });
  }
  assert.equal(starterFile(starterSource(scenarios.find(item => item.id === "response-lost")!, en)).fileName, "checkout-processor-response-lost-copy.json");
});

test("DOC-AC-2 every packaged lesson's starter file validates with no diagnostics and gives the packaged assertion results", async () => {
  // Every lesson card, plus each assessment's base lesson, which has no card of its own (#97).
  assert.equal(scenarios.length + assessments.length, hostedCatalogs.reservedNames.length);
  for (const choice of scenarios) {
    const file = starterFile(starterSource(choice, en));
    const validated = validateScenarioDocument(file.text, hostedCatalogs);
    assert.ok(validated.ok, `${choice.id}: ${JSON.stringify(validated.ok ? null : validated.diagnostics)}`);
    // The starter never reuses a packaged lesson name.
    const name = validated.document.scenario.name;
    assert.ok(!packagedNames.includes(name), name);
    assert.ok(!hostedCatalogs.reservedNames.includes(name), name);
    assert.equal(validated.document.overlayPolicy?.lesson, name);
    // The packaged lesson runs against the catalog its data-only reference names.
    const hosted = resolveHostedCatalog(hostedCatalogs, choice.catalog);
    assert.ok(typeof hosted === "object", choice.id);
    assert.equal(validated.hosted, hosted);
    const imported = await results(inspect(new DeterministicScenarioEngine(validated.hosted), validated.scenario as unknown as CanonicalValue));
    const packaged = await results(inspect(new DeterministicScenarioEngine(hosted), choice.scenario as CanonicalValue));
    assert.notEqual(imported.runId, packaged.runId, choice.id);
    assert.equal(imported.status, packaged.status, choice.id);
    assert.equal(imported.results, packaged.results, choice.id);
  }
});

test("building a starter is pure: it leaves the frozen packaged lesson untouched and gives the same text every time", () => {
  for (const choice of scenarios) {
    const before = canonicalEncode(choice.scenario as CanonicalValue);
    assert.equal(starterFile(starterSource(choice, en)).text, starterFile(starterSource(choice, en)).text);
    assert.equal(canonicalEncode(choice.scenario as CanonicalValue), before);
    assert.equal((choice.scenario as Doc).name, packagedNames[scenarios.indexOf(choice)]);
  }
});

test("a starter file is exported in the active language, and still validates and keeps its identifiers", () => {
  const choice = scenarios.find(item => item.id === "retry-idempotent")!;
  const document = starterDocument(starterSource(choice, es));
  assert.deepEqual(document.presentation, {
    title: "Reintento con idempotencia",
    summary: "La misma respuesta perdida y el mismo reintento producen un solo pago y el resultado original.",
    assertions: { "one-payment-per-order": "Una solicitud de pago reintentada cobra el pedido una sola vez" },
  });
  // Identifiers, the scenario, and the policy do not depend on the language.
  assert.deepEqual(starterDocument(starterSource(choice, en)).scenario, document.scenario);
  assert.deepEqual(starterDocument(starterSource(choice, en)).overlayPolicy, document.overlayPolicy);
  for (const item of scenarios) {
    const validated = validateScenarioDocument(starterFile(starterSource(item, es)).text, hostedCatalogs);
    assert.ok(validated.ok, `${item.id}: ${JSON.stringify(validated.ok ? null : validated.diagnostics)}`);
  }
});
