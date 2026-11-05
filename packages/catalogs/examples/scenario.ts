import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ScenarioDocumentLimits } from "@distlab/contracts";
import type { ScenarioDiagnostic } from "@distlab/contracts";
import { hostedCatalogs } from "@distlab/catalogs";
import { DeterministicScenarioEngine, openHarness, validateScenarioDocument } from "@distlab/scenario";

/**
 * Instructor check for an ADR-006 scenario document. Prints diagnostics, or
 * runs the scenario and prints its assertion results. Exit code 0 means the
 * document is valid and its run completed; a failing assertion is the
 * document's finding, not a runner failure. Exit code 1 means diagnostics or a
 * run that did not complete; 2 means usage or a missing file.
 */
const [command, file, ...rest] = process.argv.slice(2);
if (command !== "check" || !file || rest.length) {
  console.error("Usage: npm run scenario -- check <file.json>");
  process.exitCode = 2;
} else {
  // `npm run` starts in the repository root; resolve the path from where the user typed it.
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const result = check(path);
  if (!result.ok) {
    console.log(`Invalid scenario document${result.stage ? ` (${result.stage} stage)` : ""}: ${path}`);
    for (const item of result.diagnostics) console.log(`  ${item.path === "" ? "(document)" : item.path} ${item.code}`);
    process.exitCode = 1;
  } else {
    const { document, digest, hosted } = result;
    const session = openHarness(new DeterministicScenarioEngine(hosted).create(result.scenario));
    await session.run();
    const run = session.inspect();
    console.log(`Valid scenario document: ${document.presentation.title}`);
    console.log(`  scenario ${document.scenario.name} · seed ${document.scenario.seed}`);
    console.log(`  catalog  ${document.catalog.id}@${document.catalog.version}`);
    console.log(`  digest   ${digest}`);
    console.log(`Run ${run.status} at t=${run.time} · ${run.history.runId}`);
    const labels = document.presentation.assertions ?? {};
    for (const item of run.results) console.log(`  ${item.id} ${item.status}${labels[item.id] ? `  ${labels[item.id]}` : ""}`);
    if (run.status !== "COMPLETED") process.exitCode = 1;
  }
}

function check(path: string): ReturnType<typeof validateScenarioDocument> | { ok: false; stage?: undefined; diagnostics: readonly ScenarioDiagnostic[] } {
  if (!existsSync(path)) {
    console.error(`No such file: ${path}`);
    process.exit(2);
  }
  // As in the browser: the size is checked before the file is read, and the text is decoded as UTF-8 with any BOM removed.
  if (statSync(path).size > ScenarioDocumentLimits.documentBytes) return { ok: false, diagnostics: [{ path: "", code: "DOCUMENT_SIZE" }] };
  return validateScenarioDocument(new TextDecoder("utf-8").decode(readFileSync(path)), hostedCatalogs);
}
