import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { viewButton } from "./support/history.ts";

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
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  // Run while the simulation controls are visible (the architecture tab), then review history.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
}

/** Show: the one category control, a select of quick views with their counts (#145). */
const show = (page: Page) => page.getByLabel("Show", { exact: true });
const component = (page: Page) => page.getByLabel("Component", { exact: true });

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

  await expect(show(page)).toHaveValue("all");
  await expect(page.locator("#timeline-quick-count")).toContainText("No quick view is active");
  await show(page).selectOption("faults-and-timeouts");
  await expect(show(page)).toHaveValue("faults-and-timeouts");
  await expect(page.locator("#timeline-quick-count")).toContainText("Faults & timeouts shows 4 of 267 recorded observations.");
  await expect(page.locator("#timeline-quick-help")).toContainText("they never change the run");
  await expect(page.locator(".timeline-count")).toContainText("Filters show 4 of 267 observations");

  await expect(page.locator(".story-milestone").filter({ hasText: "Response dropped" })).toHaveCount(1);
  await expect(page.locator(".story-milestone").filter({ hasText: "Request timed out" })).toHaveCount(1);
  await expect(page.locator(".story-milestone").filter({ hasText: "scheduler.event.scheduled" })).toHaveCount(0);
  // Quick views are display-only: the run, its virtual time, and its history are unchanged.
  expect(await commands(page)).toEqual(afterRun);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");

  // The Story table lists the same milestones as the diagram.
  await viewButton(page, "Story table").click();
  const labels = await page.locator(".story-table button[data-observation-id]").allInnerTexts();
  expect(labels.length).toBe(4);
  for (const text of labels) expect(text).toMatch(/^(Response dropped|Request timed out|Fault .+)$/);
  expect(await commands(page)).toEqual(afterRun);
});

test("each Show option names the count its quick view keeps", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);
  const options = await show(page).locator("option").evaluateAll(elements => elements.map(option => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? "" })));
  expect(options.map(option => option.value)).toEqual(["all", "faults-and-timeouts", "requests-and-responses", "messages", "state-changes", "failures"]);
  for (const option of options.slice(1)) {
    const match = /^(.+) \((\d+)\)$/.exec(option.text);
    expect(match, option.text).not.toBeNull();
    await show(page).selectOption(option.value);
    // The count in the option is the count the quick view applies.
    await expect(page.locator("#timeline-quick-count")).toContainText(`${match![1]} shows ${match![2]} of 267 recorded observations.`);
  }
  await show(page).selectOption("all");
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  expect(await commands(page)).toEqual(afterRun);
});

test("quick views and advanced filters compose through removable chips", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  await show(page).selectOption("faults-and-timeouts");
  await component(page).selectOption("payments");
  await expect(component(page)).toHaveValue("payments");
  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("Quick view Faults & timeouts");
  await expect(chips).toContainText("Component exactly Payments (payments)");
  // A component matches its source or its target, so both faulted records of Payments remain.
  await expect(page.locator("#timeline-quick-count")).toContainText("shows 2 of 267 recorded observations");
  await viewButton(page, "Story table").click();
  const labels = await page.locator(".story-table button[data-observation-id]").allInnerTexts();
  assert.deepEqual([...labels].sort(), ["Request timed out", "Response dropped"]);

  // Switching the quick view keeps the component criterion.
  await show(page).selectOption("requests-and-responses");
  await expect(chips).toContainText("Quick view Requests & responses");
  await expect(chips).toContainText("Component exactly Payments (payments)");
  await expect(component(page)).toHaveValue("payments");

  // Removing the chips one at a time restores the recorded history.
  await page.getByRole("button", { name: "Remove the Requests & responses quick view" }).click();
  await expect(chips).not.toContainText("Quick view");
  await expect(show(page)).toHaveValue("all");
  await expect(component(page)).toHaveValue("payments");
  await page.getByRole("button", { name: "Remove component filter" }).click();
  await expect(component(page)).toHaveValue("");
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

  await show(page).selectOption("faults-and-timeouts");
  await show(page).selectOption("messages");
  await component(page).selectOption("orders");
  await show(page).selectOption("faults-and-timeouts");
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(show(page)).toHaveValue("all");
  await expect(component(page)).toHaveValue("");
  await show(page).selectOption("faults-and-timeouts");
  await component(page).selectOption("customer-app");
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

  // Show is a native select: keyboard focus and arrow keys choose a quick view.
  await show(page).focus();
  await expect(show(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(show(page)).toHaveValue("faults-and-timeouts");
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Quick view Faults & timeouts");
  await expect(page.locator("#timeline-feedback")).toContainText("Quick view Faults & timeouts applied");
  await page.keyboard.press("Home");
  await expect(show(page)).toHaveValue("all");
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(show(page)).toHaveValue("faults-and-timeouts");
  expect(await commands(page)).toEqual(afterRun);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(show(page)).toBeVisible();
  await expect(page.locator("#timeline-quick-count")).toContainText("shows 4 of 267 recorded observations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await show(page).selectOption("all");
  await expect(show(page)).toHaveValue("all");
  await show(page).selectOption("faults-and-timeouts");
  await viewButton(page, "Story table").click();
  await expect(page.locator("#timeline-rows")).toContainText("Response dropped");
  await expect(page.locator("#timeline-rows")).toContainText("Request timed out");
  await expect(page.locator(".timeline-empty")).toHaveCount(0);
  expect(await commands(page)).toEqual(afterRun);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
