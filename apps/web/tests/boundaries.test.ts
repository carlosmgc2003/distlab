import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const app = resolve(root, "apps/web/src");
const dataModule = resolve(root, "packages/catalogs/src/scenarios.ts");
const commerceDataModule = resolve(root, "packages/catalogs/src/commerce/scenarios.ts");
// The Reliable Checkout base lesson and its packaged assessment definition (#97): data only.
const assessmentDataModule = resolve(root, "packages/catalogs/src/commerce/reliable-checkout.ts");
// Data-only model descriptors (ADR-005): the main thread may import them.
const descriptorModules = [resolve(root, "packages/catalogs/src/descriptors.ts"), resolve(root, "packages/catalogs/src/commerce/descriptors.ts")];
const dataModules = new Set([dataModule, commerceDataModule, assessmentDataModule, ...descriptorModules]);
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [resolve(directory, entry.name)] : []);
}
function imports(file: string): { path: string; names: string[]; typeOnly: boolean }[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const result: { path: string; names: string[]; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const bindings = clause?.namedBindings;
      result.push({ path: node.moduleSpecifier.text, typeOnly: clause?.isTypeOnly ?? false,
        names: bindings && ts.isNamedImports(bindings) ? bindings.elements.map(item => (item.propertyName ?? item.name).text) : [] });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) assert.fail(`Unexpected dynamic runtime import in ${file}`);
    ts.forEachChild(node, visit);
  };
  visit(source); return result;
}

test("main-thread import graph uses application contracts and data, never runtime mutation ports", () => {
  const allowed = new Set(["ArchitectureDefinition", "ArchitectureProjection", "ComponentNodeProjection", "DatabaseDefinition", "KeyValueDefinition", "ComponentId", "ScenarioDefinition", "ApplicationError", "CanonicalValue", "RuntimeProjectionSet", "WorkerCommand", "WorkerEvent", "Observation", "ObservationFilter", "EntityRef", "SimulationTime",
    // Session overlay data shapes (ADR-004). Types only: no validation or application code.
    "SessionIdentity", "SessionOverlay", "LessonOverlayPolicy", "LessonParameter", "ParameterOverride", "FaultRule", "FaultEffect", "FaultPoint", "ScheduledFault", "OverlayScheduledFault", "ScenarioDiagnostic",
    // Model descriptor data shapes (ADR-005). Types only: no composition code.
    "ModelDescriptor", "ModelPeer", "ModelOption", "ModelStorage",
    // Architecture edit and allowance shapes (ADR-005). Types only: no validation or application code.
    "ArchitectureEdits", "SlotEdit", "BindingEdit", "ResourceEdit", "SubscriptionEdit", "LessonArchitectureAllowance",
    // Scenario document shapes (ADR-006). Types only: no parser, validator, or registry.
    "CatalogReference", "ScenarioDocument", "ScenarioDocumentPresentation", "SessionOrigin",
    // Assessment shapes (docs/spec/assessment.md). Types only: no definition validation.
    "AssessmentDefinition", "AssessmentRow", "AssessmentConfiguration", "AssessmentVerdict", "AssessmentCell", "AssessmentRowResult", "AssessmentResult",
    "Duration"]);
  // Contract constants the main thread shares with the worker (ADR-006 "Bounded size"). Data only.
  const allowedValues = new Set(["ScenarioDocumentLimits"]);
  const visited = new Set<string>();
  function walk(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!file.startsWith(resolve(app, "worker")), `Runtime code on main thread: ${file}`);
    for (const dependency of imports(file)) {
      if (dependency.path === "@distlab/contracts") {
        assert.ok(dependency.typeOnly || dependency.names.every(name => allowedValues.has(name)), `Contracts must be type-only on main thread, apart from shared constants: ${file}`);
        assert.ok(dependency.names.every(name => dependency.typeOnly ? allowed.has(name) : allowedValues.has(name)), `Low-level contract in ${file}`);
      } else if (dependency.path.startsWith(".")) {
        // Package sources import siblings by their emitted `.js` name; the walk reads the `.ts` source.
        const named = resolve(dirname(file), dependency.path);
        const target = !named.startsWith(app) && named.endsWith(".js") ? named.replace(/\.js$/, ".ts") : named;
        assert.ok(target.startsWith(app) || dataModules.has(target), `Only the catalog's data-only source may cross a source boundary: ${target}`);
        if (!target.endsWith(".css")) walk(target);
      } else assert.ok([
        "react", "react-dom/client", "@xyflow/react", "@xyflow/react/dist/style.css",
        // Presentation layout: the small ELK API, and the URL of the engine script it runs in its own worker.
        "elkjs/lib/elk-api.js", "elkjs/lib/elk-worker.min.js?url",
      ].includes(dependency.path), `Runtime dependency ${dependency.path} in ${file}`);
    }
  }
  walk(resolve(app, "main.tsx"));
  assert.ok(visited.has(resolve(app, "host.ts")));
  assert.ok(visited.has(dataModule));
  assert.ok(visited.has(commerceDataModule));
  assert.ok(visited.has(assessmentDataModule), "the assessment view reads its definition from the data-only module");
  // #116: the starter file builder is on the main thread, so the walk above holds it to contract types and data-only modules.
  assert.ok(visited.has(resolve(app, "starter-file.ts")));
  // ARCH-AC-7 (#112): the Design editor's draft and section are on the main thread, held to the same rules,
  // and they read the descriptors from the data-only modules only.
  assert.ok(visited.has(resolve(app, "design-edits.ts")));
  assert.ok(visited.has(resolve(app, "ArchitectureSection.tsx")));
  for (const module of descriptorModules) assert.ok(visited.has(module), `${module} is read as data`);
  // Descriptor modules obey the same data-only rules whether or not the app imports them yet.
  for (const module of descriptorModules) walk(module);
});

test("kernel and contracts have no upward application, catalog or browser dependencies", () => {
  for (const name of ["kernel", "contracts"]) {
    const directory = resolve(root, "packages", name);
    const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) assert.equal(dependency, "@distlab/contracts");
    for (const file of files(resolve(directory, "src"))) {
      for (const dependency of imports(file)) assert.ok(dependency.path.startsWith(".") || dependency.path.startsWith("@distlab/contracts"), `${file}: ${dependency.path}`);
    }
  }
});

test("OVL-AC-5 and ARCH-AC-7: the main thread reads overlay policies from data-only modules and never applies an overlay or a design", () => {
  const mainThread = files(app).filter(file => !file.startsWith(resolve(app, "worker")));
  for (const file of mainThread) {
    const text = readFileSync(file, "utf8");
    // Assessment definition validation composes every row's overlay, so it stays off the main thread too (docs/spec/assessment.md).
    for (const name of ["composeOverlay", "applyOverlay", "validateOverlay", "resolveTarget", "applyArchitectureEdits", "readArchitectureEdits", "attributeDiagnostic", "validateAssessmentDefinition", "@distlab/scenario", "@distlab/catalogs\""]) {
      assert.ok(!text.includes(name), `${file} must not reference ${name}`);
    }
  }
  const policies = imports(resolve(app, "scenarios.ts")).filter(item => item.path.startsWith(".") && item.names.some(name => name.endsWith("OverlayPolicy")));
  assert.deepEqual(policies.map(item => resolve(app, item.path)).sort(), [assessmentDataModule, commerceDataModule, dataModule].sort());
  // The worker resolves the policy from its own catalog, never from a command.
  const adapter = imports(resolve(app, "worker/adapter.ts"));
  const catalog = adapter.find(item => item.path === "@distlab/catalogs");
  assert.ok(catalog?.names.includes("checkoutOverlayPolicy") && catalog.names.includes("commerceOverlayPolicy"));
  assert.ok(adapter.some(item => item.path === "@distlab/scenario" && item.names.includes("composeOverlay")));
  // Architecture edits are validated against the allowance in that same policy; the worker passes its own catalog's descriptors.
  assert.match(readFileSync(resolve(app, "worker/adapter.ts"), "utf8"), /composeOverlay\(lesson\.scenario, lesson\.policy, command\.overlay, [^)]*\), catalog\)/);
});

test("DOC-AC-5 and APP-AC-9: the main thread sends scenario file text unparsed and imports no document parser, validator, or catalog registry", () => {
  const mainThread = files(app).filter(file => !file.startsWith(resolve(app, "worker")));
  const hosted = resolve(root, "packages/catalogs/src/hosted.ts");
  for (const file of mainThread) {
    const text = readFileSync(file, "utf8");
    // Parsing untrusted text happens once, in the worker: JSON.parse would also hide duplicate keys.
    for (const name of ["JSON.parse", "validateScenarioDocument", "parseDocumentText", "documentDigest", "resolveHostedCatalog", "hostedCatalogs", "SUPPORTED_FORMAT_VERSIONS"]) {
      assert.ok(!text.includes(name), `${file} must not reference ${name}`);
    }
    for (const dependency of imports(file).filter(item => item.path.startsWith("."))) {
      assert.notEqual(resolve(dirname(file), dependency.path), hosted, `${file} must not import the hosted catalog registry`);
    }
  }
  // The host forwards the text it was given as the command's `document`, unchanged.
  assert.match(readFileSync(resolve(app, "host.ts"), "utf8"), /loadDocument\(document: string, overlay\?: CanonicalValue\)[^}]*this\.#load\(\{ document,/);
  // The worker validates the text against its own registry; nothing else resolves a catalog for an imported document.
  const adapter = readFileSync(resolve(app, "worker/adapter.ts"), "utf8");
  assert.match(adapter, /validateScenarioDocument\(command\.document, hostedCatalogs\)/);
});
