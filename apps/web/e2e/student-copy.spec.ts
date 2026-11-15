import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { scenarios } from "../src/scenarios.ts";
import { loadLesson } from "./support/lesson.ts";

/**
 * Student-facing panels state guarantees in plain words (#204). These terms name how DistLab is
 * built, so they stay out of the Lesson panel and the Architecture tab outside the canvas, hint
 * bodies included. Only **Advanced diagnostics** keeps the precise wording.
 */
const banned = ["projection", "projected", "worker session", "student-visible", "host-only", "simulation command", "authorized start", "boundaries only"];

/**
 * The text a student can read in one region, hidden hint bodies included (textContent, not
 * innerText). Advanced diagnostics and the graph canvas are removed from a copy before reading.
 */
function regionText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate(element => {
    const copy = element.cloneNode(true) as Element;
    for (const excluded of copy.querySelectorAll("details.advanced-diagnostics, .graph-canvas")) excluded.remove();
    return copy.textContent ?? "";
  });
}

async function expectPlainWording(page: Page, context: string) {
  for (const [region, selector] of [["Lesson panel", ".lesson-panel"], ["Architecture tab", "#architecture-panel"]] as const) {
    const text = (await regionText(page, selector)).toLowerCase();
    const found = banned.filter(term => text.includes(term));
    expect(found, `${region} at ${context} contains ${found.join(", ")}`).toEqual([]);
  }
}

for (const scenario of scenarios) {
  test(`${scenario.id}: the Lesson panel and Architecture tab use no implementation terms, READY and COMPLETED`, async ({ page }) => {
    const status = page.getByRole("status", { name: "Simulation status" });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    await loadLesson(page, scenario.id);
    await expect(status).toHaveText("READY");
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await expectPlainWording(page, "READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await expectPlainWording(page, "COMPLETED");
  });
}

test("response-lost: the scenario details are read only inside Advanced diagnostics", async ({ page }) => {
  const status = page.getByRole("status", { name: "Simulation status" });
  await page.goto("/");
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  const sentence = page.getByText(/^Scenario details: /);
  await expect(sentence).toHaveCount(1);
  await expect(page.locator(".lesson-panel details.advanced-diagnostics").getByText(/^Scenario details: checkout-processor-response-lost@1; seed /)).toHaveCount(1);
});
