import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { hostedCatalogs } from "@distlab/catalogs";
import { validateScenarioDocument } from "@distlab/scenario";
import { loadLesson } from "./support/lesson.ts";

// #116: save a packaged lesson as a starter scenario file, open it, and run it (ADR-006).

declare global {
  interface Window { starterEvidence: { commands: WorkerCommand[] } }
}

const status = (page: import("@playwright/test").Page) => page.getByRole("status", { name: "Simulation status" });
const label = "A retried payment request charges the order once";

test("Save as scenario file downloads Retry: idempotent as a starter that opens and runs with the packaged result", async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.starterEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.starterEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
  await page.goto("/");
  await loadLesson(page, "retry-idempotent");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  await expect(page.getByRole("list", { name: "Business invariants", exact: true }).getByRole("listitem").filter({ hasText: label })).toContainText("HOLDS");
  const sent = (await page.evaluate(() => window.starterEvidence.commands)).length;

  // The action lives in the Lesson panel's ④ Experiment section, with nothing to open first.
  const save = page.getByRole("button", { name: "Save as scenario file", exact: true });
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  expect(download.suggestedFilename()).toBe("retry-idempotent-copy.json");
  // Saving is a local download: no worker command, and the loaded session stays.
  expect(await page.evaluate(() => window.starterEvidence.commands)).toHaveLength(sent);
  await expect(status(page)).toHaveText("COMPLETED");

  const text = readFileSync((await download.path())!, "utf8");
  expect(text).toMatch(/^\{\n {2}"format": "distlab\.scenario",\n/);
  const validated = validateScenarioDocument(text, hostedCatalogs);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
  expect(validated.document.scenario.name).toBe("retry-idempotent-copy@1");

  await page.getByLabel("Scenario file", { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text, "utf8") });
  await expect(status(page)).toHaveText("READY");
  const header = page.getByLabel("Imported scenario", { exact: true });
  await expect(header).toContainText("Imported · Retry with idempotency · retry-idempotent-copy@1 · seed commerce-classroom-1 · commerce.lessons@1.0.0");
  // The starter keeps the lesson's overlay policy, so the student choices stay available.
  await expect(page.getByRole("button", { name: "Add or change faults" })).toBeVisible();
  // A starter is offered only for a packaged lesson.
  await expect(save).toHaveCount(0);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  const checks = page.getByRole("list", { name: "Scenario checks", exact: true });
  await expect(checks.getByRole("listitem")).toHaveCount(1);
  await expect(checks.getByRole("listitem")).toContainText(`PASS — ${label}`);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Choosing a packaged lesson again offers the starter again.
  await loadLesson(page, "retry-idempotent");
  await expect(status(page)).toHaveText("READY");
  await expect(save).toBeVisible();
});
