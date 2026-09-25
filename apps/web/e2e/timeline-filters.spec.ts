import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";

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
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(status).toHaveText("READY");
  await expect(page.locator("#timeline-filter-help")).toContainText("combine with AND");
  await expect(page.locator("#timeline-filter-help")).toContainText("case-sensitive");

  const typeInput = page.getByLabel("Type", { exact: true });
  await typeInput.fill("network");
  const beforeRun = await page.getByRole("option").allTextContents();
  expect(beforeRun).not.toContain("network.response.dropped");
  const commandsAtReady = await page.evaluate(() => window.filterEvidence.commands.map(command => command.type));

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await typeInput.focus();
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "network.request.sent", exact: true })).toBeVisible();
  const afterRun = await page.getByRole("option").allTextContents();
  expect(afterRun).not.toEqual(beforeRun);
  await expect(page.locator(".timeline-count")).toHaveText(/^0 of \d+ observations in virtual-time order\.$/);
  await expect(page.locator(".timeline-empty")).toContainText("network.response.dropped");
  await expect(page.locator(".timeline-empty")).toContainText("clear all filters");

  await page.getByLabel("Type match", { exact: true }).selectOption("prefix");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Type starting with network");
  const prefixed = await countPair(page);
  expect(prefixed.shown).toBeGreaterThan(1);
  expect(prefixed.shown).toBeLessThan(prefixed.total);
  const visibleRows = await page.locator("#timeline-rows button").allInnerTexts();
  expect(visibleRows.length).toBeGreaterThan(0);
  for (const row of visibleRows) expect(row).toContain("network.");

  await typeInput.fill("network.response.dropped");
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toBeVisible();
  await typeInput.press("ArrowDown");
  await typeInput.press("Enter");
  await expect(typeInput).toHaveValue("network.response.dropped");
  await expect(page.getByLabel("Type match", { exact: true })).toHaveValue("exact");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Type exactly network.response.dropped");
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);
  const exact = await countPair(page);
  expect(exact.shown).toBeGreaterThan(0);
  expect(exact.shown).toBeLessThan(prefixed.shown);
  const exactRows = await page.locator("#timeline-rows button").allInnerTexts();
  expect(exactRows.length).toBeGreaterThan(0);
  for (const row of exactRows) expect(row).toContain("network.response.dropped");

  const selected = page.locator("#timeline-rows button").first();
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await typeInput.press("ArrowDown");
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Use source as component filter" }).click();
  await expect(page.getByLabel("Component", { exact: true })).toHaveValue("payment-processor");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Payment Processor (payment-processor)");
  const observationId = await page.locator(".timeline-detail dd span").first().innerText();
  await page.getByRole("button", { name: "Copy observation id" }).click();
  await expect(page.getByRole("button", { name: "Copied observation id" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(observationId);
  await page.getByRole("button", { name: "Show this trace" }).click();
  await expect(page.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");

  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page.getByLabel("Trace", { exact: true })).toHaveValue("");
  const cleared = await countPair(page);
  expect(cleared.shown).toBe(cleared.total);

  const component = page.getByLabel("Component", { exact: true });
  await component.fill("Orders");
  await expect(page.getByRole("option", { name: "Orders (orders)", exact: true })).toBeVisible();
  await component.press("ArrowDown");
  await component.press("Enter");
  await expect(component).toHaveValue("orders");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Component exactly Orders (orders)");
  await page.getByRole("button", { name: "Remove component filter" }).click();
  await expect(component).toHaveValue("");
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);

  await page.getByLabel("Virtual time from").fill("1.5");
  await expect(page.locator("#timeline-filter-error")).toContainText('Virtual time from "1.5" is not a whole simulation time');
  await page.getByLabel("Virtual time from").fill("4");
  await page.getByLabel("Virtual time to").fill("1");
  await expect(page.locator("#timeline-filter-error")).toContainText("Virtual time from 4 is after virtual time to 1");
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page.locator("#timeline-filter-error")).toHaveCount(0);

  await typeInput.fill("network");
  await expect(page.getByRole("listbox", { name: "Type choices" })).toBeVisible();
  await typeInput.press("Escape");
  await expect(page.getByRole("listbox", { name: "Type choices" })).toHaveCount(0);
  await expect(typeInput).toHaveValue("network");
  expect(await page.evaluate(() => window.filterEvidence.commands.map(command => command.type))).toEqual([...commandsAtReady, "run"]);

  await page.getByLabel("Scenario", { exact: true }).selectOption("normal");
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await typeInput.fill("network.response.dropped");
  await expect(page.getByText('No recorded values contain "network.response.dropped".')).toBeVisible();
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);
  await typeInput.fill("network");
  await expect(page.getByRole("option", { name: "network.request.sent", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "network.response.dropped", exact: true })).toHaveCount(0);

  await typeInput.press("Escape");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await typeInput.click();
  await expect(page.getByRole("listbox", { name: "Type choices" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await typeInput.press("Escape");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
