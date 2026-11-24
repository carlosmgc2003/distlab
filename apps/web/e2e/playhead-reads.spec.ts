import { expect, test } from "./support/test.ts";
import type { Locator, Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { viewButton } from "./support/history.ts";
import { animationOff, control, playheadPosition, runToEnd } from "./support/playhead.ts";

// RFC 0002 P5 (#225): Recorded history and ③ Investigate read the playhead.

declare global {
  interface Window {
    readCommands: WorkerCommand[];
    outcomeAnnouncements: string[];
  }
}

async function recordCommands(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.readCommands = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.readCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

const commands = (page: Page) => page.evaluate(() => window.readCommands.map(command => command.type));
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const lessonPanel = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true });
const investigate = (page: Page) => lessonPanel(page).getByRole("region", { name: "③ Investigate", exact: true });
const currentStep = (page: Page) => lessonPanel(page).locator("[aria-current='step']");
const outcomeRegion = (page: Page) => page.getByRole("status", { name: "Lesson outcome", exact: true });
const tableRows = (page: Page) => page.locator(".story-table tbody tr");
const WAITS = "The outcome appears here when the playhead reaches the end of the run.";

async function stepTo(page: Page, milestone: number, total: number): Promise<void> {
  for (let at = 1; at <= milestone; at += 1) {
    await control(page, "Step").click();
    await expect(playheadPosition(page)).toHaveText(new RegExp(`^Milestone ${at} of ${total} `));
  }
}

async function showTable(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await expect(page.locator(".story-table")).toBeVisible();
}

async function expectPlayheadRow(rows: Locator, index: number): Promise<void> {
  await expect(rows.nth(index)).toHaveAttribute("data-selected", "true");
  await expect(rows.nth(index)).toHaveAttribute("data-reached", "true");
  if (index + 1 < await rows.count()) {
    await expect(rows.nth(index + 1)).toHaveAttribute("data-reached", "false");
    await expect(rows.nth(index + 1).getByRole("button")).toContainText("not reached");
  }
}

test("OT-READ-AC-1, AC-2, AC-3, and AC-8: the selected row is the playhead on both Story views, and no worker command is sent", async ({ page }) => {
  await recordCommands(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await showTable(page);
  // Before the run has executed nothing is marked: there is no playhead to be ahead of.
  await expect(page.locator("[data-reached]")).toHaveCount(0);

  await stepTo(page, 5, 19);
  const rows = tableRows(page);
  await expect(rows).toHaveCount(19);
  // AC-2 and AC-3: Step moved the selected row; the rows after it read as not reached, in words and as an attribute.
  await expectPlayheadRow(rows, 4);
  await expect(page.locator(".story-table tr[data-reached='false']")).toHaveCount(14);

  // AC-1: selecting row 12 moves the playhead there; the top bar and the graph show that milestone.
  await rows.nth(11).getByRole("button").click();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 12 of 19 /);
  await expect(page.locator(".run-metrics")).toContainText("12 of 19");
  await expectPlayheadRow(rows, 11);

  // AC-2: Back moves the selected row.
  await control(page, "Back").click();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 11 of 19 /);
  await expectPlayheadRow(rows, 10);
  const eleventh = await rows.nth(10).getByRole("button").getAttribute("data-observation-id");
  const twelfth = await rows.nth(11).getByRole("button").getAttribute("data-observation-id");

  // The same on the Story diagram: the pressed cell is the playhead, and Step moves it.
  await viewButton(page, "Story diagram").click();
  const pressed = page.locator(".story-milestone[aria-pressed='true']");
  await expect(pressed).toHaveAttribute("data-observation-id", eleventh!);
  await control(page, "Step").click();
  await expect(pressed).toHaveAttribute("data-observation-id", twelfth!);
  await expect(page.locator(".story-milestone[data-reached='false']")).toHaveCount(7);
  await expect(page.locator(".story-milestone[data-reached='false']").first()).toHaveAccessibleName(/, not reached yet$/);

  // The graph paints the milestone under the playhead, with its narration.
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".flight-narration")).toBeVisible();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 12 of 19 /);

  // AC-8: only the first Step executed the run.
  expect(await commands(page)).toEqual(["load", "run"]);
});

test("OT-READ-AC-4, AC-6, and AC-7: with Animation on, the outcome waits for the end, is announced once, and survives Back but not Reset", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await expect(currentStep(page)).toHaveAccessibleName("② Run");
  await expect(investigate(page)).toContainText(WAITS);
  await expect(investigate(page).locator(".lesson-outcome")).toHaveCount(0);

  await page.evaluate(() => {
    window.outcomeAnnouncements = [];
    const region = document.querySelector("[role='status'][aria-label='Lesson outcome']")!;
    new MutationObserver(() => {
      const text = region.textContent ?? "";
      if (text) window.outcomeAnnouncements.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });

  // The run has executed, and the playhead left the start: no step is current, and the outcome still waits.
  await stepTo(page, 1, 19);
  await expect(status(page)).toHaveText("COMPLETED");
  await expect(currentStep(page)).toHaveCount(0);
  await expect(investigate(page)).toContainText(WAITS);
  await expect(investigate(page).getByRole("region", { name: "Lesson checks", exact: true })).toHaveCount(0);
  await expect(outcomeRegion(page)).toHaveText("");

  // The playhead reaches the last milestone: the outcome is revealed and announced.
  await showTable(page);
  await tableRows(page).nth(18).getByRole("button").click();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 19 of 19 /);
  await expect(investigate(page).locator(".lesson-outcome")).toBeVisible();
  await expect(investigate(page).getByRole("region", { name: "Lesson checks", exact: true })).toBeVisible();
  await expect(investigate(page)).not.toContainText(WAITS);
  await expect(outcomeRegion(page)).not.toHaveText("");
  await expect(currentStep(page)).toHaveAccessibleName("③ Investigate");

  // AC-6: Back keeps it, and nothing is announced again.
  await control(page, "Back").click();
  await control(page, "Back").click();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 17 of 19 /);
  await expect(investigate(page).locator(".lesson-outcome")).toBeVisible();
  await expect(currentStep(page)).toHaveAccessibleName("③ Investigate");
  expect(await page.evaluate(() => window.outcomeAnnouncements.length)).toBe(1);

  // Reset withholds it again.
  await control(page, "Reset").click();
  await expect(status(page)).toHaveText("READY");
  await expect(investigate(page)).toContainText(WAITS);
  await expect(investigate(page).locator(".lesson-outcome")).toHaveCount(0);
  await expect(currentStep(page)).toHaveAccessibleName("② Run");
});

test("OT-READ-AC-5: with Animation off, the outcome is shown as soon as the run completes", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await runToEnd(page);
  await expect(investigate(page).locator(".lesson-outcome")).toBeVisible();
  await expect(currentStep(page)).toHaveAccessibleName("③ Investigate");

  // Step executes the run too, and with Animation off the outcome does not wait for the playhead.
  await control(page, "Reset").click();
  await expect(status(page)).toHaveText("READY");
  await animationOff(page);
  await control(page, "Step").click();
  await expect(playheadPosition(page)).toHaveText(/^Milestone 1 of 19 /);
  await expect(investigate(page).locator(".lesson-outcome")).toBeVisible();
});

test("OT-READ-AC-9: Show evidence selects its record, focuses its row, and moves the playhead to it or to the milestone before it", async ({ page }) => {
  await recordCommands(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await runToEnd(page);
  await expect(playheadPosition(page)).toHaveText(/^Milestone 19 of 19 /);
  await investigate(page).getByRole("button", { name: "Show evidence: A retried payment request charges the order once", exact: true }).click();

  const focused = page.locator(".story-table button:focus");
  await expect(focused).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#inspection-panel")).toContainText("A retried payment request charges the order once — The check did not pass at t=22.");
  // The playhead stands on the evidence record, or on the last milestone before it; the record stays selected.
  await expect(playheadPosition(page)).toHaveText(/^Milestone \d+ of 19 /);
  const row = page.locator(".story-table tr[data-selected='true']");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-reached", "true");
  expect(await commands(page)).toEqual(["load", "run"]);
});
