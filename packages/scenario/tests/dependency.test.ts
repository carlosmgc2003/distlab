import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = fileRoot();

test("kernel sources do not import the scenario package, catalogs, or UI", () => {
  const kernel = join(root, "packages/kernel");
  const packageJson = JSON.parse(readFileSync(join(kernel, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(packageJson.dependencies?.["@distlab/scenario"], undefined);
  for (const file of readdirSync(join(kernel, "src"))) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(kernel, "src", file), "utf8");
    assert.equal(source.includes("@distlab/scenario"), false);
    assert.equal(source.includes("from \"react\""), false);
    assert.equal(source.includes("react-flow"), false);
    assert.equal(source.includes("scenario-engine"), false);
  }
});

test("scenario sources do not import React, YAML, or worker hosts", () => {
  const sourceRoot = join(root, "packages/scenario/src");
  for (const file of readdirSync(sourceRoot)) {
    const source = readFileSync(join(sourceRoot, file), "utf8");
    assert.equal(/from ["']react["']|react-flow|js-yaml|worker_threads|Date\.now|setTimeout|Math\.random/.test(source), false);
  }
});

function fileRoot(): string {
  return join(import.meta.dirname, "../../..");
}
