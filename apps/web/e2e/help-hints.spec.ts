import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";

declare global {
  interface Window { hintEvidence: { commands: WorkerCommand[] }; }
}

async function observeCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.hintEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
      }
      override postMessage(command: WorkerCommand) {
        window.hintEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

function commands(page: Page) {
  return page.evaluate(() => window.hintEvidence.commands.map(command => command.type));
}

async function completed(page: Page) {
  const status = page.getByRole("status", { name: "Simulation status" });
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
}

test("explanations stay collapsed until a reader asks for them", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  const graphControls = page.getByRole("button", { name: "Graph controls" });
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  const body = page.locator("#graph-controls-help");
  await expect(body).toBeHidden();
  // The explanation text is always present, so it stays searchable and testable.
  await expect(body).toContainText("press Enter or Space");

  await graphControls.hover();
  await expect(graphControls).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  // Keyboard focus opens it, Escape closes it, and a click pins it.
  await graphControls.focus();
  await expect(graphControls).toBeFocused();
  await expect(body).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(graphControls).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");

  // Reading an explanation is not a simulation action.
  expect(await commands(page)).toEqual(afterRun);
});

test("the filter, row order, and strip explanations keep their text and stay out of the layout", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const afterRun = await commands(page);

  const drawer = page.locator(".history-filter-drawer");
  if ((await drawer.getAttribute("open")) === null) await drawer.locator("> summary").click();
  const before = await page.locator(".timeline-tools").evaluate(node => node.clientHeight);
  await page.locator(".timeline-filter-disclosure summary").click();
  const filterHelp = page.getByRole("button", { name: "How matching works" });
  await expect(filterHelp).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#timeline-filter-help")).toBeHidden();
  await expect(page.locator("#timeline-filter-help")).toContainText("combine with AND");
  await expect(page.locator("#timeline-filter-help")).toContainText("case-sensitive");
  await filterHelp.click();
  await expect(page.locator("#timeline-filter-help")).toBeVisible();
  await expect(page.locator("#timeline-filter-help")).toContainText("Prefix matches its start");
  // The popover is not clipped by the scrolling tools region.
  const popover = await page.locator("#timeline-filter-help").boundingBox();
  expect(popover).not.toBeNull();
  expect(popover!.x).toBeGreaterThanOrEqual(0);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press("Escape");

  await expect(page.locator("#timeline-order")).toBeHidden();
  await expect(page.locator("#timeline-order")).toContainText("it does not execute an event");
  await expect(page.locator("#story-summary")).toBeHidden();
  await expect(page.locator("#story-summary")).toContainText("component lanes");
  await expect(before).toBeGreaterThan(0);
  expect(await commands(page)).toEqual(afterRun);
});

test("a pinned explanation closes on Escape or an outside click and fits 200% zoom", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  const strip = page.getByRole("button", { name: "Reading the story" });
  await strip.click();
  await expect(page.locator("#story-summary")).toBeVisible();
  await page.getByRole("heading", { name: "Recorded history", exact: true }).click();
  await expect(page.locator("#story-summary")).toBeHidden();

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const mobileStrip = page.getByRole("button", { name: "Reading the story" });
  await expect(mobileStrip).toBeVisible();
  await mobileStrip.click();
  await expect(page.locator("#story-summary")).toBeVisible();
  const box = await page.locator("#story-summary").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(683);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#story-summary")).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
