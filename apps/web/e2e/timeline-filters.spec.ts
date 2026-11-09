import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { applyMoreFilters, moreFilters, openMoreFilters, viewButton } from "./support/history.ts";

declare global {
  interface Window { filterEvidence: { commands: WorkerCommand[] }; }
}

async function observeCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.filterEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
      }
      override postMessage(command: WorkerCommand) {
        window.filterEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function countPair(page: Page) {
  const text = await page.locator(".timeline-count").innerText();
  const match = /(\d+) of (\d+)/.exec(text);
  expect(match).not.toBeNull();
  return { shown: Number(match?.[1]), total: Number(match?.[2]) };
}

test("discoverable filters suggest the current run and keep partial matching explicit", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // These assertions read canonical rows; the teaching Story view has its own spec.
  await viewButton(page, "Raw").click();
  const active = page.getByRole("list", { name: "Active filters" });
  const dialog = moreFilters(page);
  const typeInput = dialog.getByLabel("Type", { exact: true });
  const typeMatch = dialog.getByLabel("Type match", { exact: true });

  await openMoreFilters(page);
  await expect(page.locator("#timeline-filter-help")).toContainText("combine with AND");
  await expect(page.locator("#timeline-filter-help")).toContainText("case-sensitive");
  await typeInput.fill("network");
  const beforeRun = await page.getByRole("option").allTextContents();
  expect(beforeRun).not.toContain("network.response.dropped");
  const commandsAtReady = await page.evaluate(() => window.filterEvidence.commands.map(command => command.type));
  // The dialog is modal: close it to reach Run, then reopen it on the recorded run.
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await openMoreFilters(page);
  await typeInput.fill("network");
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "network.request.sent", exact: true })).toBeVisible();
  const afterRun = await page.getByRole("option").allTextContents();
  expect(afterRun).not.toEqual(beforeRun);
  // Nothing narrows the rows until Apply.
  await expect(page.locator(".timeline-count")).toHaveText(/^(\d+) of \1 observations in virtual-time order\.$/);
  await typeInput.press("Escape");
  await applyMoreFilters(page);
  await expect(page.locator(".timeline-count")).toHaveText(/^0 of \d+ observations in virtual-time order\.$/);
  await expect(page.locator(".timeline-empty")).toContainText("network.response.dropped");
  await expect(page.locator(".timeline-empty")).toContainText("clear all filters");

  await openMoreFilters(page);
  await typeMatch.selectOption("prefix");
  await applyMoreFilters(page);
  await expect(active).toContainText("Type starting with network");
  const prefixed = await countPair(page);
  expect(prefixed.shown).toBeGreaterThan(1);
  expect(prefixed.shown).toBeLessThan(prefixed.total);
  const visibleRows = await page.locator("#timeline-rows button").allInnerTexts();
  expect(visibleRows.length).toBeGreaterThan(0);
  for (const row of visibleRows) expect(row).toContain("network.");

  await openMoreFilters(page);
  await typeInput.fill("network.response.dropped");
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toBeVisible();
  await typeInput.press("ArrowDown");
  await typeInput.press("Enter");
  await expect(typeInput).toHaveValue("network.response.dropped");
  await expect(typeMatch).toHaveValue("exact");
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);
  await applyMoreFilters(page);
  await expect(active).toContainText("Type exactly network.response.dropped");
  const exact = await countPair(page);
  expect(exact.shown).toBeGreaterThan(0);
  expect(exact.shown).toBeLessThan(prefixed.shown);
  const exactRows = await page.locator("#timeline-rows button").allInnerTexts();
  expect(exactRows.length).toBeGreaterThan(0);
  for (const row of exactRows) expect(row).toContain("network.response.dropped");

  const selected = page.locator("#timeline-rows button").first();
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await page.locator("#inspection-panel").getByText("Record fields & filter shortcuts", { exact: true }).click();
  await page.getByRole("button", { name: "Use source as component filter" }).click();
  // Component has one control, in the toolbar.
  const component = page.getByLabel("Component", { exact: true });
  await expect(component).toHaveValue("payment-processor");
  await expect(active).toContainText("Payment Processor (payment-processor)");
  const observationId = await page.locator("#timeline-rows button[aria-pressed='true']").getAttribute("data-observation-id");
  await page.locator("#inspection-panel").getByText("Technical record", { exact: true }).click();
  await page.getByRole("button", { name: "Copy observation id" }).click();
  await expect(page.getByRole("button", { name: "Copied observation id" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(observationId);
  await page.locator("#inspection-panel").getByText("Related evidence", { exact: true }).click();
  await page.getByRole("button", { name: "Show this trace" }).click();
  // More filters opens on the applied draft: the trace is set and the type was cleared.
  await openMoreFilters(page);
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("traceId");
  await expect(dialog.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("type");
  await expect(typeInput).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Clear all filters" }).click();
  await openMoreFilters(page);
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("traceId");
  await expect(dialog.getByLabel("Trace", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const cleared = await countPair(page);
  expect(cleared.shown).toBe(cleared.total);

  await component.selectOption("orders");
  await expect(active).toContainText("Component exactly Orders (orders)");
  await page.getByRole("button", { name: "Remove component filter" }).click();
  await expect(component).toHaveValue("");
  await expect(active).toHaveCount(0);

  // An invalid range stays in the dialog with its error and changes nothing.
  await openMoreFilters(page);
  await dialog.getByLabel("Virtual time from").fill("1.5");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#timeline-filter-error")).toContainText('Virtual time from "1.5" is not a whole simulation time');
  await dialog.getByLabel("Virtual time from").fill("4");
  await dialog.getByLabel("Virtual time to").fill("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#timeline-filter-error")).toContainText("Virtual time from 4 is after virtual time to 1");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(active).toHaveCount(0);
  await openMoreFilters(page);
  await expect(page.locator("#timeline-filter-error")).toHaveCount(0);
  await expect(dialog.getByLabel("Virtual time from")).toHaveValue("");

  await typeInput.fill("network");
  await expect(page.getByRole("listbox", { name: "Type choices" })).toBeVisible();
  // Escape closes the suggestion list first, and keeps the dialog open.
  await typeInput.press("Escape");
  await expect(page.getByRole("listbox", { name: "Type choices" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(typeInput).toHaveValue("network");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.filterEvidence.commands.map(command => command.type))).toEqual([...commandsAtReady, "run"]);

  await loadLesson(page, "normal");
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await openMoreFilters(page);
  await typeInput.fill("network.response.dropped");
  await expect(page.getByText('No recorded values contain "network.response.dropped".')).toBeVisible();
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);
  await typeInput.fill("network");
  await expect(page.getByRole("option", { name: "network.request.sent", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);

  await typeInput.press("Escape");
  // axe with the More filters dialog open.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await openMoreFilters(page);
  await typeInput.click();
  await expect(page.getByRole("listbox", { name: "Type choices" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await typeInput.press("Escape");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
