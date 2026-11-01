import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIO_DOCUMENT_FORMAT, ScenarioDocumentLimits } from "@distlab/contracts";
import { scenarios } from "../src/scenarios.ts";

/** Hosted catalog references named in ADR-006 "Document envelope". */
const catalogs = { checkout: { id: "mvp.checkout", version: "1.0.0" }, commerce: { id: "commerce.lessons", version: "1.0.0" } } as const;

/** Containers on the deepest path, counting the document root as 1: the strictest reading of "nesting depth". */
function depth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  return 1 + Math.max(0, ...Object.values(value).map(depth));
}

type Scenario = {
  readonly architecture: { readonly components: readonly unknown[]; readonly links: readonly unknown[] };
  readonly actions?: readonly unknown[];
  readonly faults?: readonly unknown[];
  readonly assertions?: readonly unknown[];
  readonly configuration?: { readonly historyLimit?: number };
};

test("every packaged lesson, wrapped as a starter scenario document, is within ScenarioDocumentLimits", () => {
  assert.ok(scenarios.length >= 12, "both checkout lessons and every commerce lesson are checked");
  for (const lesson of scenarios) {
    const scenario = lesson.scenario as unknown as Scenario;
    // ADR-006 "Packaged lessons as starters": the packaged scenario, its catalog reference, its copy, and its policy.
    const document = {
      format: SCENARIO_DOCUMENT_FORMAT,
      formatVersion: 1,
      catalog: catalogs[lesson.family],
      presentation: { title: lesson.title, summary: lesson.description },
      scenario: lesson.scenario,
      overlayPolicy: lesson.policy,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength;
    const counts = {
      components: scenario.architecture.components.length,
      links: scenario.architecture.links.length,
      actions: scenario.actions?.length ?? 0,
      faultRules: scenario.faults?.length ?? 0,
      assertions: scenario.assertions?.length ?? 0,
    } as const;
    assert.ok(bytes <= ScenarioDocumentLimits.documentBytes, `${lesson.id}: ${bytes} bytes`);
    assert.ok(depth(document) <= ScenarioDocumentLimits.nestingDepth, `${lesson.id}: depth ${depth(document)}`);
    for (const [limit, value] of Object.entries(counts)) {
      assert.ok(value <= ScenarioDocumentLimits[limit as keyof typeof counts], `${lesson.id}: ${value} ${limit}`);
    }
    // The packaged value is the limit, and an omitted configuration takes the same engine default.
    assert.ok((scenario.configuration?.historyLimit ?? ScenarioDocumentLimits.historyLimit) <= ScenarioDocumentLimits.historyLimit, lesson.id);
    assert.ok(lesson.title.length <= ScenarioDocumentLimits.titleLength, `${lesson.id}: title`);
    assert.ok(lesson.description.length <= ScenarioDocumentLimits.summaryLength, `${lesson.id}: summary`);
  }
});
