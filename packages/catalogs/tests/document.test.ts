import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalValue, LessonOverlayPolicy } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutAssessment, checkoutAssessmentV11, checkoutCatalog, checkoutCatalogReference, checkoutCatalogV11, checkoutOverlayPolicy, checkoutScenario,
  commerceAssessment, commerceCatalog, commerceCatalogReference, commerceLessonNames, commerceOverlayPolicy, commerceScenario, hostedCatalogs,
  reliableCheckoutOverlayPolicy, reliableCheckoutScenario,
} from "@distlab/catalogs";
import { DeterministicScenarioEngine, compareExports, openHarness, validateScenarioDocument } from "@distlab/scenario";
import type { HarnessExport, HostedCatalogRegistry } from "@distlab/scenario";

// ADR-006 scenario documents against the hosted catalogs: the vision §19
// fixture (DOC-AC-1), packaged lessons as starters (DOC-AC-2), replay and
// identity (DOC-AC-3), policy integrity (DOC-AC-6), versioning (DOC-AC-7), and
// the headless `scenario check` command.

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixturePath = join(root, "examples/scenarios/processor-response-lost.json");
const fixtureText = readFileSync(fixturePath, "utf8");
type Doc = Record<string, unknown>;
const fixture = () => JSON.parse(fixtureText) as Doc;

function valid(value: unknown, registry: HostedCatalogRegistry = hostedCatalogs) {
  const result = validateScenarioDocument(typeof value === "string" ? value : JSON.stringify(value), registry);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}
function codes(value: unknown): string[] {
  const result = validateScenarioDocument(JSON.stringify(value), hostedCatalogs);
  return result.ok ? [] : result.diagnostics.map(item => `${item.path} ${item.code}`);
}
async function run(value: unknown, registry: HostedCatalogRegistry = hostedCatalogs): Promise<HarnessExport> {
  const result = valid(value, registry);
  const session = openHarness(new DeterministicScenarioEngine(result.hosted).create(result.scenario));
  await session.run();
  return session.inspect();
}

interface Packaged { name: string; scenario: CanonicalValue; policy: LessonOverlayPolicy; reference: { id: string; version: string }; engine: DeterministicScenarioEngine }
const checkoutEngine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });
const commerceEngine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const packaged: Packaged[] = [
  ...(["normal", "response-lost"] as const).map(variant => ({ name: variant, scenario: checkoutScenario(variant), policy: checkoutOverlayPolicy(variant), reference: checkoutCatalogReference, engine: checkoutEngine })),
  ...commerceLessonNames.map(name => ({ name, scenario: commerceScenario(name), policy: commerceOverlayPolicy(name), reference: commerceCatalogReference, engine: commerceEngine })),
  { name: "reliable-checkout", scenario: reliableCheckoutScenario, policy: reliableCheckoutOverlayPolicy, reference: commerceCatalogReference, engine: commerceEngine },
];

/** ADR-006 "Packaged lessons as starters": the packaged scenario under a new name, its catalog reference, and its policy for that name. */
function starter(lesson: Packaged): Doc {
  const name = `${lesson.name}-copy@1`;
  return {
    format: "distlab.scenario", formatVersion: 1, catalog: lesson.reference,
    presentation: { title: lesson.name },
    scenario: { ...(lesson.scenario as Doc), name },
    overlayPolicy: { ...lesson.policy, lesson: name },
  };
}

test("the hosted registry pairs each catalog with its assessment and reserves every packaged name", () => {
  assert.deepEqual(hostedCatalogs.catalogs.map(item => [item.catalog, item.assessment]),
    [[checkoutCatalog, checkoutAssessment], [checkoutCatalogV11, checkoutAssessmentV11], [commerceCatalog, commerceAssessment]]);
  // #148: both checkout versions are hosted, each with its own assessment version.
  assert.deepEqual(hostedCatalogs.catalogs.map(item => `${item.catalog.id}@${item.catalog.version}/${item.assessment.version}`),
    ["mvp.checkout@1.0.0/1.0.0", "mvp.checkout@1.1.0/1.1.0", "commerce.lessons@1.0.0/1.0.0"]);
  // The data-only references name exactly the hosted runtime catalogs.
  assert.deepEqual({ id: checkoutCatalog.id, version: checkoutCatalog.version }, checkoutCatalogReference);
  assert.deepEqual({ id: commerceCatalog.id, version: commerceCatalog.version }, commerceCatalogReference);
  assert.deepEqual(hostedCatalogs.reservedNames, packaged.map(lesson => (lesson.scenario as Doc).name));
  assert.equal(new Set(hostedCatalogs.reservedNames).size, 2 + commerceLessonNames.length + 1);
});

test("DOC-AC-1 the vision §19 document validates against mvp.checkout@1.0.0 and records the lost-response story", async () => {
  const result = valid(fixtureText);
  assert.equal(result.hosted.catalog, checkoutCatalog);
  assert.deepEqual(result.document.catalog, { id: "mvp.checkout", version: "1.0.0" });
  assert.equal(result.document.scenario.name, "processor-response-lost@1");
  const exported = await run(fixtureText);
  assert.equal(exported.status, "COMPLETED");
  assert.equal(exported.time, 1030);
  const processor = (exported.state as { components: Record<string, { visible: { authorizations: { status: string }[] } }> }).components["payment-processor"]!;
  assert.deepEqual(processor.visible.authorizations.map(item => item.status), ["APPROVED"]);
  const types = exported.history.observations.map(item => item.type);
  assert.equal(types.filter(type => type === "external.response.suppressed").length, 1);
  assert.equal(exported.history.observations.filter(item => item.type === "network.request.timedout" && item.source === "payments").length, 1);
  assert.deepEqual(exported.results.map(item => [item.id, item.status]), [["order-not-charged-twice", "PASS"]]);
});

test("DOC-AC-2 every packaged lesson, renamed and wrapped with its catalog reference and policy, validates and gives the packaged assertion results", async () => {
  // Two checkout lessons, seventeen commerce lessons, and the Reliable Checkout assessment base (#97).
  assert.equal(packaged.length, 20);
  for (const lesson of packaged) {
    const document = starter(lesson);
    assert.ok(!hostedCatalogs.reservedNames.includes((document.scenario as Doc).name as string));
    const imported = await run(document);
    const session = openHarness(lesson.engine.create(lesson.scenario));
    await session.run();
    const original = session.inspect();
    assert.equal(imported.status, original.status, lesson.name);
    // Renaming changes runId, and evidence may carry IDs derived from it (message IDs); everything else is equal.
    const results = (exported: HarnessExport) => canonicalEncode(exported.results as unknown as CanonicalValue).replaceAll(exported.history.runId, "run:<this run>");
    assert.notEqual(imported.history.runId, original.history.runId);
    assert.equal(results(imported), results(original), lesson.name);
  }
});

test("DOC-AC-2 a packaged lesson keeping its packaged name is RESERVED_NAME", () => {
  for (const lesson of packaged) {
    assert.deepEqual(codes({ ...starter(lesson), scenario: lesson.scenario, overlayPolicy: lesson.policy }), ["/scenario/name RESERVED_NAME"], lesson.name);
  }
});

test("DOC-AC-3 fresh runs, Reset, and stepping reproduce the same runId and export", async () => {
  const first = await run(fixtureText);
  const second = await run(fixtureText);
  assert.ok(compareExports(first, second));
  const result = valid(fixtureText);
  const session = openHarness(new DeterministicScenarioEngine(result.hosted).create(result.scenario));
  await session.run({ maxEvents: 7 });
  await session.run();
  assert.ok(compareExports(first, session.inspect()));
  await session.reset();
  while (session.inspect().status !== "COMPLETED") await session.step();
  assert.ok(compareExports(first, session.inspect()));
  // The normalized scenario and the scenario as written are the same run.
  const raw = openHarness(checkoutEngine.create(fixture().scenario as CanonicalValue));
  await raw.run();
  assert.ok(compareExports(first, raw.inspect()));
});

test("DOC-AC-3 whitespace and key order keep the digest and runId; presentation changes only the digest; scenario and catalog change runId", async () => {
  const base = valid(fixtureText);
  const baseRun = await run(fixtureText);
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const reshaped = JSON.stringify(reorder(fixture()), null, "\t");
  assert.notEqual(reshaped, fixtureText);
  assert.equal(valid(reshaped).digest, base.digest);
  assert.equal((await run(reshaped)).history.runId, baseRun.history.runId);

  const retitled = { ...fixture(), presentation: { title: "Lost response, again" } };
  assert.notEqual(valid(retitled).digest, base.digest);
  assert.equal((await run(retitled)).history.runId, baseRun.history.runId);

  const reseeded = { ...fixture(), scenario: { ...(fixture().scenario as Doc), seed: "another-seed" } };
  assert.notEqual((await run(reseeded)).history.runId, baseRun.history.runId);
  // Another hosted version of the catalog is another run, even with identical models.
  const nextVersion = { ...checkoutCatalog, version: "1.0.1" };
  const registry: HostedCatalogRegistry = { catalogs: [{ catalog: nextVersion, assessment: checkoutAssessment }], reservedNames: [] };
  const moved = { ...fixture(), catalog: { id: "mvp.checkout", version: "1.0.1" } };
  assert.notEqual((await run(moved, registry)).history.runId, baseRun.history.runId);
});

// --- DOC-AC-6: policy integrity ---------------------------------------------------------

const retry = packaged.find(lesson => lesson.name === "retry-unsafe")!;
const gap = packaged.find(lesson => lesson.name === "outbox-notifications-gap")!;
const withPolicy = (lesson: Packaged, change: (policy: LessonOverlayPolicy) => unknown) => {
  const document = starter(lesson);
  return { ...document, overlayPolicy: change(document.overlayPolicy as LessonOverlayPolicy) };
};

test("DOC-AC-6 the policy must govern this scenario: lesson equals scenario.name", () => {
  assert.deepEqual(codes(withPolicy(retry, policy => ({ ...policy, lesson: "retry-unsafe@1" }))), ["/overlayPolicy/lesson REFERENCE"]);
});

test("DOC-AC-6 POLICY_TARGET: each target resolves to exactly one location, parameterizable fields only, and no two parameters share one", () => {
  const [idempotency, timeout] = retry.policy.parameters;
  assert.equal(timeout!.key, "timeout");
  const linkTarget = timeout!.targets[0]!;
  assert.deepEqual(codes(withPolicy(retry, policy => ({ ...policy, parameters: [
    idempotency,
    { ...timeout, targets: [{ ...linkTarget, target: "nowhere" }] },
    { key: "again", domain: timeout!.domain, targets: [linkTarget] },
    { key: "shadow", domain: timeout!.domain, targets: [linkTarget] },
    { key: "rename", domain: { type: "choice", default: "client", choices: ["client"] }, targets: [{ ...linkTarget, field: "source" }] },
    { key: "orphan", domain: { type: "boolean", default: true }, targets: [] },
    { key: "start", domain: { type: "boolean", default: true }, targets: [{ kind: "action", action: "start-payments", field: "state" }] },
  ] }))), [
    "/overlayPolicy/parameters/1/targets/0 POLICY_TARGET",
    "/overlayPolicy/parameters/3/targets/0 POLICY_TARGET",
    "/overlayPolicy/parameters/4/targets/0 POLICY_TARGET",
    "/overlayPolicy/parameters/5/targets POLICY_TARGET",
    "/overlayPolicy/parameters/6/targets/0 POLICY_TARGET",
  ]);
});

test("DOC-AC-6 POLICY_DEFAULT: each default lies in its domain and equals the document's value at every target", () => {
  const [idempotency, timeout] = retry.policy.parameters;
  assert.deepEqual(codes(withPolicy(retry, policy => ({ ...policy, parameters: [
    { ...idempotency, domain: { type: "boolean", default: true } },
    { ...timeout, domain: { type: "integer", default: 99, minimum: 1, maximum: 60 } },
  ] }))), [
    "/overlayPolicy/parameters/0/targets/0 POLICY_DEFAULT",
    "/overlayPolicy/parameters/1/domain/default POLICY_DEFAULT",
    "/overlayPolicy/parameters/1/targets/0 POLICY_DEFAULT",
  ]);
});

test("DOC-AC-6 POLICY_ALLOWANCE: ARCH-AC-6 allowance checks run at import", () => {
  const allowance = gap.policy.architecture!;
  const slot = allowance.slots[0]!;
  const architecture = (change: Partial<typeof allowance>, parameters?: unknown[]) =>
    codes(withPolicy(gap, policy => ({ ...policy, ...(parameters ? { parameters } : {}), architecture: { ...allowance, ...change } })));
  assert.deepEqual(architecture({}), []);
  assert.deepEqual(architecture({
    slots: [{ ...slot, models: [...slot.models, { model: "commerce.not-a-model", version: "1.0.0" }, { model: "commerce.client", version: "1.0.0" }] }, { component: "ghost", models: slot.models }],
    bindings: [{ component: "ghost", peer: "orders", candidates: ["payments", "nowhere"] }],
    resources: [...allowance.resources, { owner: "client", resource: "store" }],
    subscriptions: [...allowance.subscriptions, { consumer: "notifications", destination: "NoSuchTopic" }],
  }), [
    "/overlayPolicy/architecture/bindings/0/candidates/1 POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/bindings/0/component POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/resources/1/owner POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/slots/0/models/1 POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/slots/0/models/2 POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/slots/1/component POLICY_ALLOWANCE",
    "/overlayPolicy/architecture/subscriptions/1/destination POLICY_ALLOWANCE",
  ]);
  // Without the database the allowance offers, or within too few edits, the allowed model cannot give a valid scenario.
  assert.deepEqual(architecture({ resources: [] }), ["/overlayPolicy/architecture/slots/0/models/0 POLICY_ALLOWANCE"]);
  assert.deepEqual(architecture({ maxEdits: 1 }), ["/overlayPolicy/architecture/slots/0/models/0 POLICY_ALLOWANCE"]);
  // No parameter targets a slot component.
  assert.deepEqual(architecture({}, [...gap.policy.parameters, { key: "slot-flag", domain: { type: "boolean", default: false }, targets: [{ kind: "component", component: "notifications", field: "idempotent" }] }])
    .filter(item => item.includes("parameters/1")), ["/overlayPolicy/parameters/1/targets/0 POLICY_ALLOWANCE", "/overlayPolicy/parameters/1/targets/0 POLICY_TARGET"]);
});

// --- DOC-AC-7: versioning against the hosted registry -----------------------------------

test("DOC-AC-7 versioning: FORMAT_VERSION, UNSUPPORTED, UNKNOWN_CATALOG, and CATALOG_VERSION", () => {
  assert.deepEqual(codes({ ...fixture(), formatVersion: 2 }), ["/formatVersion FORMAT_VERSION"]);
  assert.deepEqual(codes({ ...fixture(), catalog: { id: "commerce.lesson", version: "1.0.0" } }), ["/catalog/id UNKNOWN_CATALOG"]);
  assert.deepEqual(codes({ ...fixture(), catalog: { id: "mvp.checkout", version: "0.9.0" } }), ["/catalog/version CATALOG_VERSION"]);
  assert.deepEqual(codes({ ...fixture(), presentation: { ...(fixture().presentation as Doc), theme: "dark" } }), ["/presentation/theme UNSUPPORTED"]);
  const scenario = fixture().scenario as Doc;
  assert.deepEqual(codes({ ...fixture(), scenario: { ...scenario, expect: { invariants: ["order-not-charged-twice"] } } }), ["/scenario/expect UNSUPPORTED"]);
  // The checkout scenario names models the commerce catalog does not host: the catalog is never inferred.
  assert.ok(codes({ ...fixture(), catalog: commerceCatalogReference }).every(item => item.startsWith("/scenario/")));
});

// --- Headless check command -------------------------------------------------------------

test("npm run scenario -- check runs a valid file and lists diagnostics for an invalid one", () => {
  const script = join(root, "packages/catalogs/examples/scenario.ts");
  const node = (file: string) => {
    try { return { code: 0, out: execFileSync(process.execPath, ["--experimental-strip-types", script, "check", file], { encoding: "utf8", env: { ...process.env, INIT_CWD: root } }) }; }
    catch (error) { const failure = error as { status: number; stdout: string }; return { code: failure.status, out: failure.stdout }; }
  };
  const ok = node("examples/scenarios/processor-response-lost.json");
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Valid scenario document: Processor response lost/);
  assert.match(ok.out, /catalog {2}mvp\.checkout@1\.0\.0/);
  assert.match(ok.out, /Run COMPLETED at t=1030/);
  assert.match(ok.out, /order-not-charged-twice PASS {2}The customer is charged at most once\./);

  const directory = mkdtempSync(join(tmpdir(), "distlab-scenario-"));
  try {
    const invalid = join(directory, "duplicate.json");
    writeFileSync(invalid, fixtureText.replace('"seed": "processor-response-lost-1",', '"seed": "processor-response-lost-1", "seed": "other",'));
    const rejected = node(invalid);
    assert.equal(rejected.code, 1, rejected.out);
    assert.match(rejected.out, /Invalid scenario document \(text stage\)/);
    assert.match(rejected.out, /\/scenario\/seed DUPLICATE_KEY/);
    assert.doesNotMatch(rejected.out, /Run /);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
