import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import { scenarios } from "../src/scenarios.ts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";

// #164 and #112: with the Design editor in the Experiment drawer, no lesson says its design step is
// unavailable; the graph and inspector still name the packaged gap lesson's empty slot in words.

const gap = "outbox-notifications-gap";
const lessonPanel = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Lesson", exact: true });

test("#112 the Lesson chooser shows no \"design step is not available\" notice on any lesson", async ({ page }) => {
  await page.goto("/");
  await lessonTrigger(page).click();
  await expect(lessonChooser(page)).toBeVisible();
  for (const lesson of scenarios) {
    const choice = lessonChoice(page, lesson.id);
    // The card's accessible description is the lesson description alone.
    await expect(choice).toHaveAccessibleDescription(lesson.description);
    await expect(choice).not.toContainText("not available in the browser");
  }
  const results = await new AxeBuilder({ page }).include(".lesson-chooser").analyze();
  expect(results.violations).toEqual([]);
});

test("#112 the design lesson's Goal shows no notice, and the inspector still names the empty slot", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, gap);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(lessonPanel(page).getByRole("note")).toHaveCount(0);
  await expect(lessonPanel(page)).not.toContainText("not available in the browser");

  const slot = page.locator('.react-flow__node[data-id="notifications"]');
  await expect(slot).toContainText("Empty slot");
  await expect(slot).toHaveAttribute("aria-label", "Notifications, Internal service, empty slot");
  await expect(page.locator('.react-flow__node[data-id="payments"]')).not.toContainText("Empty slot");
  await slot.click();
  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toContainText("Empty slot. No model fills this component yet.");
  await expect(inspector).toContainText("NOT_IMPLEMENTED");
  await page.screenshot({ path: test.info().outputPath("design-step-empty-slot.png") });

  // A lesson without design edits shows neither.
  await loadLesson(page, "outbox-idempotent");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(lessonPanel(page).getByRole("note")).toHaveCount(0);
  await expect(page.locator(".react-flow__node").filter({ hasText: "Empty slot" })).toHaveCount(0);
});
