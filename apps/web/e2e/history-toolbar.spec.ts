import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { applyMoreFilters, fillFilterField, moreFilters, moreFiltersTrigger, openMoreFilters, viewButton } from "./support/history.ts";

// #145: one view switch, one control per filter dimension, and More filters for the rest.

declare global {
  interface Window { toolbarEvidence: { commands: WorkerCommand[] } }
}

async function completedHistory(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.toolbarEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.toolbarEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "response-lost");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
}
const commands = (page: Page) => page.evaluate(() => window.toolbarEvidence.commands.map(command => command.type));
const virtualTime = (page: Page) => page.locator(".run-summary .run-metrics").innerText();

test("each filter dimension has exactly one input control, and chips only remove", async ({ page }) => {
  await completedHistory(page);
  const panel = page.locator("#timeline-panel");
  // Category: the Show select. Component: the Component select. No toggle buttons or chip buttons set them.
  await expect(panel.getByLabel("Show", { exact: true })).toHaveCount(1);
  await expect(panel.getByLabel("Component", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Faults & timeouts/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Orders (orders)", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Selected trace/ })).toHaveCount(0);
  // The toolbar holds no text field: every other dimension is in More filters.
  expect(await panel.locator("input").evaluateAll(inputs => inputs.filter(input => input.closest("dialog") === null).length)).toBe(0);

  const dialog = await openMoreFilters(page);
  await expect(dialog.getByLabel("Virtual time from", { exact: true })).toHaveCount(1);
  await expect(dialog.getByLabel("Virtual time to", { exact: true })).toHaveCount(1);
  // Type, trace, event, entity kind, and entity id each have one field; category and component do not repeat here.
  await expect(dialog.getByLabel("Filter by", { exact: true }).locator("option")).toHaveText(["Type", "Trace", "Event", "Entity kind", "Entity id"]);
  for (const [field, label] of [["type", "Type"], ["traceId", "Trace"], ["eventId", "Event"], ["entityKind", "Entity kind"], ["entityId", "Entity id"]] as const) {
    await dialog.getByLabel("Filter by", { exact: true }).selectOption(field);
    await expect(dialog.getByRole("combobox", { name: label, exact: true })).toHaveCount(1);
    await expect(dialog.locator("input[role=combobox]")).toHaveCount(1);
  }
  await expect(dialog.getByLabel("Show", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Component", { exact: true })).toHaveCount(0);
  await fillFilterField(page, "type", "network.response.dropped");
  await applyMoreFilters(page);

  await page.getByLabel("Show", { exact: true }).selectOption("faults-and-timeouts");
  await page.getByLabel("Component", { exact: true }).selectOption("payments");
  const chips = page.getByRole("list", { name: "Active filters", exact: true });
  await expect(chips.getByRole("listitem")).toHaveCount(3);
  // Chips only remove: every control in the chip list is a Remove button.
  for (const name of await chips.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label") ?? ""))) {
    expect(name).toMatch(/^Remove /);
  }
  await expect(chips.locator("input, select")).toHaveCount(0);
});

test("with no filter active the toolbar is two short rows with no disclosure and no chip row", async ({ page }) => {
  await completedHistory(page);
  const gap = await page.evaluate(() => document.querySelector("#timeline-rows")!.getBoundingClientRect().top
    - document.querySelector("#timeline-heading")!.getBoundingClientRect().top);
  expect(gap).toBeLessThanOrEqual(110);
  await expect(page.getByRole("group", { name: "Active filters and reset" })).toBeHidden();
  // Disclosures in the panel belong to the rows area (Learning groups, the floating detail), never the toolbar.
  expect(await page.locator("#timeline-panel details").evaluateAll(elements => elements.every(element => element.closest(".timeline-rows-frame") !== null))).toBe(true);
  await expect(page.getByRole("group", { name: "Timeline view", exact: true }).getByRole("button")).toHaveText(["Story diagram", "Story table", "Learning", "Raw"]);
  await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "true");
  await viewButton(page, "Story table").click();
  await expect(viewButton(page, "Story table")).toHaveAttribute("aria-pressed", "true");
  await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".story-table")).toBeVisible();
  await expect(page.getByRole("group", { name: "Story presentation" })).toHaveCount(0);
});

test("More filters moves focus in and back, discards on Escape and Cancel, and narrows on Apply", async ({ page }) => {
  await completedHistory(page);
  await viewButton(page, "Raw").click();
  const trigger = moreFiltersTrigger(page);
  const total = (await page.locator(".timeline-count").innerText()).match(/of (\d+)/)![1];

  const dialog = await openMoreFilters(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByLabel("Virtual time from", { exact: true })).toBeFocused();
  await fillFilterField(page, "type", "network.response.dropped");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".timeline-count")).toContainText(`${total} of ${total}`);
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);

  await openMoreFilters(page);
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue("");
  await fillFilterField(page, "type", "network.response.dropped");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);

  await openMoreFilters(page);
  await fillFilterField(page, "type", "network.response.dropped");
  await applyMoreFilters(page);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Type exactly network.response.dropped");
  const rows = await page.locator("#timeline-rows button").allInnerTexts();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row).toContain("network.response.dropped");

  // Reopening shows the applied draft; Clear and Apply remove it.
  await openMoreFilters(page);
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue("network.response.dropped");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue("");
  await applyMoreFilters(page);
  await expect(page.locator(".timeline-count")).toContainText(`${total} of ${total}`);
  await expect(moreFilters(page)).toBeHidden();
});

test("changing the view or the filters sends no worker command and keeps virtual time", async ({ page }) => {
  await completedHistory(page);
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  const before = await commands(page);
  const time = await virtualTime(page);
  for (const name of ["Story table", "Learning", "Raw", "Story diagram"] as const) await viewButton(page, name).click();
  await page.getByLabel("Show", { exact: true }).selectOption("messages");
  await page.getByLabel("Component", { exact: true }).selectOption("orders");
  await openMoreFilters(page);
  await moreFilters(page).getByLabel("Virtual time from", { exact: true }).fill("0");
  await applyMoreFilters(page);
  await page.getByRole("button", { name: "Clear all filters" }).click();
  expect(await commands(page)).toEqual(before);
  expect(await virtualTime(page)).toBe(time);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
});
