import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(new URL("../src/", import.meta.url));
const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));
test("simulation code uses no wall clock, timers, unseeded random, fetch or host network", () => {
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|XMLHttpRequest|WebSocket|EventSource|node:net|node:http|node:https)\b/;
  for (const name of readdirSync(source).filter(name => name.endsWith(".ts"))) {
    const text = readFileSync(join(source, name), "utf8");
    assert.doesNotMatch(text, forbidden, name);
  }
});
test("kernel has no UI, catalog, assessment, or scenario package dependency", () => {
  const pkg = JSON.parse(readFileSync(packageFile, "utf8")) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies), ["@distlab/contracts"]);
  for (const name of readdirSync(source).filter(name => name.endsWith(".ts"))) {
    const text = readFileSync(join(source, name), "utf8");
    assert.doesNotMatch(text, /from ["'](?:@distlab\/(?:ui|scenario|catalog|assessment)|\.\.\/\.\.\/apps\/)/, name);
  }
});
