import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { lessonTrigger, loadLesson } from "./support/lesson.ts";

/**
 * The top bar (#144): one row, identical on both tabs, holding the lesson trigger, Simulation
 * execution, and the run summary. There is no second control group (RFC 0002 P2).
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
    // OT-PLAY-AC-5: one control group; the Replay toolbar is gone.
    await expect(page.getByRole("group", { name: "Replay recorded movements" })).toHaveCount(0);
    expect(await recordedHistoryLabels(page)).toEqual(["tab", "h2"]);
    for (const name of ["Run", "Back", "Step", "Reset"]) await expect(button(page, name)).toBeVisible();

    // The simulation is operable from the Recorded history tab: the first Step executes the run.
    await button(page, "Step").click();
    await expect(status(page)).toHaveText("COMPLETED");
    // After a Step, Run reads Continue: it plays on from the playhead.
    await button(page, "Continue").click();
    await expect(button(page, "Pause")).toBeVisible();
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
  for (const name of ["Run", "Back", "Step", "Reset"]) {
    await expect(button(page, name)).toBeVisible();
    await expect(button(page, name)).toHaveAttribute("aria-disabled", "true");
  }
  expect((await page.locator("header.top-bar").boundingBox())!.height).toBeLessThanOrEqual(64);
  // The tagline left the bar; the empty state may keep its own introduction.
  await expect(page.locator("header.top-bar")).not.toContainText("Distributed systems, explained");
});

test("OT-PLAY-AC-5 and OT-PLAY-AC-6: the top bar states the playhead with one virtual time, and the event counts are in Advanced diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  const bar = page.locator("header.top-bar");
  const value = (label: string) => bar.locator(".run-metrics div", { hasText: label }).locator("dd");
  // One virtual time in the bar, and no engine counter.
  await expect(bar.locator(".run-metrics dt")).toHaveText(["Milestone", "Virtual time"]);
  await expect(bar.getByText("Virtual time", { exact: true })).toHaveCount(1);
  await expect(bar).not.toContainText("Processed events");
  await expect(bar).not.toContainText("Pending events");
  // Before the run executes, the bar states no position and no time.
  await expect(value("Milestone")).toHaveText("—");
  await expect(value("Virtual time")).toHaveText("—");

  // The first Step executes the run: the bar follows the playhead, not the end of the run.
  await button(page, "Step").click();
  await expect(status(page)).toHaveText("COMPLETED");
  await expect(value("Milestone")).toHaveText("1 of 19");
  await expect(value("Virtual time")).toHaveText("0");
  for (let at = 2; at <= 4; at += 1) await button(page, "Step").click();
  await expect(value("Milestone")).toHaveText("4 of 19");
  await expect(page.getByRole("status", { name: "Playhead position" })).toHaveText(/^Milestone 4 of 19 · virtual time 1 · observation #\d+\.$/);
  await expect(value("Virtual time")).toHaveText("1");
  await button(page, "Back").click();
  await expect(value("Milestone")).toHaveText("3 of 19");
  // Nothing beside the graph restates a virtual time: the position readout left the Architecture tab.
  await expect(page.locator("#architecture-panel .flight-readout")).toHaveCount(0);

  // The engine counters are in Advanced diagnostics, for a commerce lesson too, and they state the whole run.
  const diagnostics = page.locator(".lesson-panel details.advanced-diagnostics");
  await diagnostics.locator("summary").click();
  const counters = diagnostics.getByLabel("Engine counters", { exact: true });
  await expect(counters.locator("dt")).toHaveText(["Processed events", "Pending events", "Random draws", "Observations"]);
  await expect(counters.locator("dd").nth(1)).toHaveText("0");
  expect(Number(await counters.locator("dd").first().innerText())).toBeGreaterThan(0);
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(64);
});
