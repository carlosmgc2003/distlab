import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { lessonTrigger, loadLesson } from "./support/lesson.ts";

/**
 * The top bar (#144): one row, identical on both tabs, holding the lesson trigger, Simulation
 * execution, and the run summary. Replay lives in the Architecture tab, not here.
 */

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });

/** Visible elements whose own text, or whose accessible name, is a label containing "Recorded history". */
function recordedHistoryLabels(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    };
    const labelled = [...document.querySelectorAll("[aria-label]")]
      .filter(element => /Recorded history/.test(element.getAttribute("aria-label") ?? "") && visible(element));
    const texts = [...document.body.querySelectorAll("*")]
      .filter(element => (element.textContent ?? "").trim() === "Recorded history" && ![...element.children].some(child => (child.textContent ?? "").trim() === "Recorded history"))
      .filter(visible);
    return [...new Set([...labelled, ...texts])].map(element => element.getAttribute("role") ?? element.tagName.toLowerCase());
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1534, height: 897 }]) {
  test(`the top bar is one identical row on both tabs, and the simulation runs from Recorded history at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await loadLesson(page, "response-lost");
    await expect(status(page)).toHaveText("READY");
    const bar = page.locator("header.top-bar");
    const onArchitecture = (await bar.boundingBox())!;
    expect(onArchitecture.height).toBeLessThanOrEqual(64);
    expect(await recordedHistoryLabels(page)).toEqual(["tab"]);

    await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
    expect(await bar.boundingBox()).toEqual(onArchitecture);
    await expect(button(page, "Show simulation controls")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Replay recorded movements" })).toHaveCount(0);
    expect(await recordedHistoryLabels(page)).toEqual(["tab", "h2"]);
    for (const name of ["Run", "Pause", "Step", "Reset"]) await expect(button(page, name)).toBeVisible();

    // The simulation is operable from the Recorded history tab.
    await button(page, "Step").click();
    await expect(status(page)).toHaveText("PAUSED");
    await button(page, "Run").click();
    await expect(status(page)).toHaveText("COMPLETED");
    expect(await bar.boundingBox()).toEqual(onArchitecture);
    await button(page, "Reset").click();
    await expect(status(page)).toHaveText("READY");
    await expect(page.getByRole("tab", { name: "Recorded history", exact: true })).toHaveAttribute("aria-selected", "true");
  });
}

test("with no lesson loaded the top bar offers Choose a lesson and shows disabled simulation controls", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(lessonTrigger(page)).toHaveText(/Choose a lesson/);
  await expect(lessonTrigger(page)).toBeEnabled();
  for (const name of ["Run", "Pause", "Step", "Reset"]) {
    await expect(button(page, name)).toBeVisible();
    await expect(button(page, name)).toHaveAttribute("aria-disabled", "true");
  }
  expect((await page.locator("header.top-bar").boundingBox())!.height).toBeLessThanOrEqual(64);
  // The tagline left the bar; the empty state may keep its own introduction.
  await expect(page.locator("header.top-bar")).not.toContainText("Distributed systems, explained");
});
