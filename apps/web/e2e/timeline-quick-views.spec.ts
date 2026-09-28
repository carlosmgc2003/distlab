import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";

declare global {
  interface Window { quickViewEvidence: { commands: WorkerCommand[] }; }
}

async function observeCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.quickViewEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
      }
      override postMessage(command: WorkerCommand) {
        window.quickViewEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function completed(page: Page) {
  const status = page.getByRole("status", { name: "Simulation status" });
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(status).toHaveText("READY");
  // Run while the simulation controls are visible (the architecture tab), then review history.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // The committed-state summary lives in the command toolbar, hidden in history focus.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
}

/** The quick views live inside the collapsed filter drawer. */
async function openFilterDrawer(page: Page) {
  const drawer = page.locator(".history-filter-drawer");
  if ((await drawer.getAttribute("open")) === null) await drawer.locator("> summary").click();
}

function commands(page: Page) {
  return page.evaluate(() => window.quickViewEvidence.commands.map(command => command.type));
}

test("one quick view reaches the dropped response and the timeout in the faulted checkout", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);
  expect(afterRun).toEqual(["load", "run"]);

  await openFilterDrawer(page);
  const faults = page.getByRole("button", { name: /^Faults & timeouts/ });
  await expect(faults).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#timeline-quick-count")).toContainText("No quick view is active");
  await faults.click();
  await expect(faults).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeline-quick-count")).toContainText("Faults & timeouts shows 4 of 267 recorded observations.");
  await expect(page.locator("#timeline-quick-help")).toContainText("they never change the run");
  await expect(page.locator(".timeline-count")).toContainText("Filters show 4 of 267 observations");

  await expect(page.locator(".story-milestone").filter({ hasText: "Response dropped" })).toHaveCount(1);
  await expect(page.locator(".story-milestone").filter({ hasText: "Request timed out" })).toHaveCount(1);
  await expect(page.locator(".story-milestone").filter({ hasText: "scheduler.event.scheduled" })).toHaveCount(0);
  // Quick views are display-only: the run, its virtual time, and its history are unchanged.
  expect(await commands(page)).toEqual(afterRun);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");

  // Raw reads the same canonical rows as the Story milestone table.
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const types = await page.locator("#timeline-rows button").allInnerTexts();
  expect(types.length).toBe(4);
  for (const text of types) expect(text).toMatch(/network\.response\.dropped|network\.request\.timedout|fault\./);
  expect(await commands(page)).toEqual(afterRun);
});

test("quick views and advanced filters compose through removable chips", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  await openFilterDrawer(page);
  await page.getByRole("button", { name: /^Faults & timeouts/ }).click();
  await page.locator(".timeline-filter-disclosure summary").click();
  await page.getByLabel("Filter by", { exact: true }).selectOption("component");
  await page.getByLabel("Component", { exact: true }).fill("payments");
  await page.getByLabel("Component", { exact: true }).press("ArrowDown");
  await page.getByLabel("Component", { exact: true }).press("Enter");
  await expect(page.getByLabel("Component", { exact: true })).toHaveValue("payments");
  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("Quick view Faults & timeouts");
  await expect(chips).toContainText("Component exactly Payments (payments)");
  // A component matches its source or its target, so both faulted records of Payments remain.
  await expect(page.locator("#timeline-quick-count")).toContainText("shows 2 of 267 recorded observations");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const types = await page.locator("#timeline-rows button").allInnerTexts();
  assert.deepEqual(types.map(text => /network\.[a-z.]+|fault\.[a-z.]+/.exec(text)?.[0]).sort(),
    ["network.request.timedout", "network.response.dropped"]);

  // Switching the quick view keeps the advanced criterion.
  await page.getByRole("button", { name: /^Requests & responses/ }).click();
  await expect(chips).toContainText("Quick view Requests & responses");
  await expect(chips).toContainText("Component exactly Payments (payments)");
  await expect(page.getByLabel("Component", { exact: true })).toHaveValue("payments");

  // Removing the chips one at a time restores the recorded history.
  await page.getByRole("button", { name: "Remove the Requests & responses quick view" }).click();
  await expect(chips).not.toContainText("Quick view");
  await expect(page.getByLabel("Component", { exact: true })).toHaveValue("payments");
  await page.getByRole("button", { name: "Remove component filter" }).click();
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  await expect(page.locator(".timeline-count")).toContainText("267");
  expect(await commands(page)).toEqual(afterRun);
});

test("an empty result names the active quick view and the canonical filters, and clears them", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  await openFilterDrawer(page);
  await page.getByRole("button", { name: /^Faults & timeouts/ }).click();
  await page.getByRole("button", { name: /^Key events/ }).click();
  await page.getByRole("button", { name: "Orders (orders)", exact: true }).click();
  await page.getByRole("button", { name: /^Faults & timeouts/ }).click();
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await page.getByRole("button", { name: /^Faults & timeouts/ }).click();
  await page.getByRole("button", { name: "Customer App (customer-app)", exact: true }).click();
  const empty = page.locator(".timeline-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("faults & timeouts quick view");
  await expect(empty).toContainText("Remove the faults & timeouts quick view chip or clear all filters");
  await expect(page.getByRole("button", { name: "Clear all filters" })).toBeEnabled();
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page.locator(".timeline-count")).toContainText("267");
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  expect(await commands(page)).toEqual(afterRun);
});

test("quick views are keyboard operable and stay reachable at 200% zoom", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  await openFilterDrawer(page);
  const faults = page.getByRole("button", { name: /^Faults & timeouts/ });
  await faults.focus();
  await expect(faults).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(faults).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Quick view Faults & timeouts");
  await page.keyboard.press(" ");
  await expect(faults).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(faults).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeline-feedback")).toContainText("Quick view Faults & timeouts applied");
  expect(await commands(page)).toEqual(afterRun);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const mobileFaults = page.getByRole("button", { name: /^Faults & timeouts/ });
  await expect(mobileFaults).toBeVisible();
  await expect(page.locator("#timeline-quick-count")).toContainText("shows 4 of 267 recorded observations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobileFaults.click();
  await expect(mobileFaults).toHaveAttribute("aria-pressed", "false");
  await mobileFaults.click();
  await expect(mobileFaults).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.locator("#timeline-rows")).toContainText("network.response.dropped");
  await expect(page.locator("#timeline-rows")).toContainText("network.request.timedout");
  await expect(page.locator(".timeline-empty")).toHaveCount(0);
  expect(await commands(page)).toEqual(afterRun);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
