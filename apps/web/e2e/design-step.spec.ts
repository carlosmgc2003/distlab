import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import { lessonDescription, scenarios } from "../src/scenarios.ts";
import { designStepUnavailable } from "../src/design-step.ts";
import { messages } from "../src/i18n/catalog.ts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";

const DESIGN_STEP_NOTICE = messages("en").designChoices.stepNotice;

// #164: until the Design editor (#112) exists, the design lesson says that its design step is not
// available, and the graph and inspector name its empty slot in words.

const gap = "outbox-notifications-gap";
const lessonPanel = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Lesson", exact: true });

test("#164 the Lesson chooser states the missing design step on exactly the lessons that ask for one", async ({ page }) => {
  await page.goto("/");
  await lessonTrigger(page).click();
  await expect(lessonChooser(page)).toBeVisible();
  for (const lesson of scenarios) {
    const choice = lessonChoice(page, lesson.id);
    // The notice is part of the card's accessible description, read right after the instruction.
    if (designStepUnavailable(lesson.policy)) await expect(choice).toHaveAccessibleDescription(`${lessonDescription(lesson, messages("en"))} ${DESIGN_STEP_NOTICE}`);
    else await expect(choice).not.toContainText("not available in the browser");
  }
  expect(scenarios.filter(lesson => designStepUnavailable(lesson.policy)).map(lesson => lesson.id)).toEqual([gap]);
  const results = await new AxeBuilder({ page }).include(".lesson-chooser").analyze();
  expect(results.violations).toEqual([]);
});

test("#164 the design lesson's Goal states the missing step, and the inspector names the empty slot", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, gap);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(lessonPanel(page).getByRole("note")).toHaveText(DESIGN_STEP_NOTICE);

  const slot = page.locator('.react-flow__node[data-id="notifications"]');
  await expect(slot).toContainText("Empty slot");
  await expect(slot).toHaveAttribute("aria-label", "notifications, Internal service, empty slot");
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
