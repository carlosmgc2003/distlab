import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { commerceScenario } from "@distlab/catalogs";
import { scenarios } from "../src/scenarios.ts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";

// #139: one Lesson chooser replaces the Scenario select and Load scenario.

declare global {
  interface Window { chooserCommands: WorkerCommand[] }
}

async function captureCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.chooserCommands = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.chooserCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}
const commands = (page: Page) => page.evaluate(() => window.chooserCommands);
const loads = async (page: Page) => (await commands(page)).filter(command => command.type === "load");
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const runIdentity = (page: Page) => page.getByLabel("Run identity", { exact: true });

test("with no lesson loaded, choosing Lost processor response loads it with no further click", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/");
  // The Scenario select and Load scenario are gone.
  await expect(page.locator("select#scenario")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load scenario" })).toHaveCount(0);
  await expect(lessonTrigger(page)).toHaveText(/^Choose a lesson/);

  await lessonTrigger(page).click();
  const chooser = lessonChooser(page);
  await expect(chooser).toBeVisible();
  await expect(chooser).toHaveAttribute("aria-modal", "true");
  // Focus moves into the dialog; before any load no lesson is current.
  await expect(chooser.locator("[aria-current='true']")).toHaveCount(0);
  await expect(chooser.locator(":focus")).toHaveCount(1);
  await expect(chooser).not.toContainText("discards your unapplied");

  await chooser.getByRole("button", { name: "Lost processor response", exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(status(page)).toHaveText("READY");
  await expect(lessonTrigger(page)).toHaveText(/^Lesson: Lost processor response/);
  // Focus returns to the trigger once the load has settled.
  await expect(lessonTrigger(page)).toBeFocused();
  const sent = await loads(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type === "load" && "overlay" in sent[0]).toBe(false);
});

test("the empty state's Choose a lesson opens the same chooser", async ({ page }) => {
  await page.goto("/");
  const empty = page.locator(".workspace-empty").getByRole("button", { name: "Choose a lesson", exact: true });
  await empty.click();
  await expect(lessonChooser(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lessonChooser(page)).toBeHidden();
  await expect(empty).toBeFocused();
  await empty.click();
  await lessonChoice(page, "saga-uncompensated").click();
  await expect(status(page)).toHaveText("READY");
  await expect(lessonTrigger(page)).toHaveText(/^Lesson: Saga: no compensation/);
});

test("with a lesson loaded, Escape and Cancel change nothing and return focus to the trigger", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  const run = await runIdentity(page).innerText();
  const before = (await commands(page)).length;

  await lessonTrigger(page).click();
  const chooser = lessonChooser(page);
  await expect(chooser).toBeVisible();
  // The loaded lesson is current, and focus starts on it.
  await expect(chooser.locator("[aria-current='true']")).toHaveCount(1);
  await expect(lessonChoice(page, "retry-unsafe")).toHaveAttribute("aria-current", "true");
  await expect(lessonChoice(page, "retry-unsafe")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await expect(lessonTrigger(page)).toBeFocused();
  await expect(runIdentity(page)).toHaveText(run);

  await lessonTrigger(page).click();
  await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(lessonTrigger(page)).toBeFocused();
  await expect(runIdentity(page)).toHaveText(run);
  expect(await commands(page)).toHaveLength(before);
  await expect(status(page)).toHaveText("READY");
});

test("each packaged lesson appears once, in the same card as the lesson it compares with", async ({ page }) => {
  await page.goto("/");
  await lessonTrigger(page).click();
  const cards = await lessonChooser(page).locator(".lesson-card").evaluateAll(elements =>
    elements.map(card => [...card.querySelectorAll("[data-lesson-id]")].map(button => button.getAttribute("data-lesson-id")!)));
  const listed = cards.flat();
  expect(listed).toHaveLength(19);
  expect(new Set(listed)).toEqual(new Set(scenarios.map(lesson => lesson.id)));
  const cardOf = new Map(cards.flatMap((card, index) => card.map(id => [id, index] as const)));
  for (const lesson of scenarios) {
    if (lesson.compare) expect(cardOf.get(lesson.compare), `${lesson.id} and ${lesson.compare}`).toBe(cardOf.get(lesson.id));
  }
  // Pairs are what the lessons are built around: a failing lesson sits beside its fix.
  expect(cards).toContainEqual(["retry-unsafe", "retry-idempotent"]);
  expect(cards).toContainEqual(["normal", "response-lost"]);
});

test("unapplied changes are named once, and choosing a lesson discards them and loads without an overlay", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  const designChoices = page.getByRole("region", { name: "Design choices" });
  await designChoices.getByRole("button", { name: "Change design choices" }).click();
  await designChoices.getByLabel("Idempotency key").check();
  await expect(designChoices).toContainText("These choices are not applied yet.");

  await lessonTrigger(page).click();
  const chooser = lessonChooser(page);
  await expect(chooser.getByText("Choosing a lesson discards your unapplied design choices and faults.", { exact: true })).toBeVisible();
  // Choosing the loaded lesson reloads it without the session overlay.
  await lessonChoice(page, "retry-unsafe").click();
  await expect(chooser).toBeHidden();
  await expect(status(page)).toHaveText("READY");
  const last = (await loads(page)).at(-1);
  expect(last?.type === "load" && last.scenario).toEqual(commerceScenario("retry-unsafe"));
  expect(last?.type === "load" && "overlay" in last).toBe(false);
  await expect(runIdentity(page)).toContainText("packaged faults only");
  await expect(runIdentity(page)).not.toContainText("idempotency");

  // With nothing unapplied, the sentence is gone.
  await lessonTrigger(page).click();
  await expect(chooser).toBeVisible();
  await expect(chooser).not.toContainText("discards your unapplied");
  await page.keyboard.press("Escape");
});

test("the open Lesson chooser passes accessibility checks before and after a load", async ({ page }) => {
  await page.goto("/");
  await lessonTrigger(page).click();
  await expect(lessonChooser(page)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await lessonChoice(page, "normal").click();
  await expect(status(page)).toHaveText("READY");
  await lessonTrigger(page).click();
  await expect(lessonChooser(page)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
