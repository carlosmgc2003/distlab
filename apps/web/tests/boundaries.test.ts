import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const app = resolve(root, "apps/web/src");
const dataModule = resolve(root, "packages/catalogs/src/scenarios.ts");
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
  const allowed = new Set(["ArchitectureDefinition", "ArchitectureProjection", "ComponentNodeProjection", "ScenarioDefinition", "ApplicationError", "CanonicalValue", "RuntimeProjectionSet", "WorkerCommand", "WorkerEvent"]);
  const visited = new Set<string>();
  function walk(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!file.startsWith(resolve(app, "worker")), `Runtime code on main thread: ${file}`);
    for (const dependency of imports(file)) {
      if (dependency.path === "@distlab/contracts") {
        assert.ok(dependency.typeOnly, `Contracts must be type-only on main thread: ${file}`);
        assert.ok(dependency.names.every(name => allowed.has(name)), `Low-level contract in ${file}`);
      } else if (dependency.path.startsWith(".")) {
        const target = resolve(dirname(file), dependency.path);
        assert.ok(target.startsWith(app) || target === dataModule, `Only the catalog's data-only source may cross a source boundary: ${target}`);
        if (!target.endsWith(".css")) walk(target);
      } else assert.ok(["react", "react-dom/client", "@xyflow/react", "@xyflow/react/dist/style.css"].includes(dependency.path), `Runtime dependency ${dependency.path} in ${file}`);
    }
  }
  walk(resolve(app, "main.tsx"));
  assert.ok(visited.has(resolve(app, "host.ts")));
  assert.ok(visited.has(dataModule));
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
