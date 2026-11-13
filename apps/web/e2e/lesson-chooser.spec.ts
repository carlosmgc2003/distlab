import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { commerceScenario } from "@distlab/catalogs";
import { scenarios } from "../src/scenarios.ts";
import { messages } from "../src/i18n/catalog.ts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";
import { choicesSection, experimentDrawer, openExperiment } from "./support/experiment.ts";

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
  expect(listed).toHaveLength(23);
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
  await openExperiment(page);
  await choicesSection(page).getByLabel("Idempotency key").check();
  await expect(experimentDrawer(page)).toContainText("These changes are not applied yet.");

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

test("lessons are sorted into topics, and the topic filter and search narrow them", async ({ page }) => {
  await page.goto("/");
  await lessonTrigger(page).click();
  const chooser = lessonChooser(page);
  const topics = chooser.getByRole("group", { name: "Topic" });
  await expect(topics.getByRole("button", { name: "All topics" })).toHaveAttribute("aria-pressed", "true");
  await expect(chooser.locator(".lesson-topic h3")).toHaveText([
    "Partial failure and idempotency", "Fault tolerance and overload", "Distributed transactions and messaging",
    "Replication and consistency", "Concurrency control", "Time, ordering, and coordination",
  ]);
  await expect(chooser.getByRole("status")).toHaveText("23 lessons");

  await topics.getByRole("button", { name: "Concurrency control" }).click();
  await expect(chooser.locator(".lesson-topic h3")).toHaveText(["Concurrency control"]);
  await expect(chooser.locator("[data-lesson-id]")).toHaveCount(2);
  await expect(chooser.locator("[data-assessment-id]")).toHaveCount(0);
  await expect(chooser.getByRole("status")).toHaveText("2 of 23 lessons");

  await topics.getByRole("button", { name: "All topics" }).click();
  await chooser.getByRole("searchbox", { name: "Search" }).fill("circuit breaker");
  await expect(chooser.locator("[data-lesson-id]")).toHaveCount(2);
  await expect(lessonChoice(page, "cascade-unprotected")).toBeVisible();
  await chooser.getByRole("searchbox", { name: "Search" }).fill("no such concept");
  await expect(chooser.getByText("No lesson matches.", { exact: false })).toBeVisible();

  // In a non-empty search box, Escape clears the search first; the next Escape closes the dialog.
  await page.keyboard.press("Escape");
  await expect(chooser.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  await expect(chooser).toBeVisible();
  // Filters are UI state for one opening: the next opening shows every topic again.
  await topics.getByRole("button", { name: "Concurrency control" }).click();
  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await lessonTrigger(page).click();
  await expect(chooser.locator("[data-lesson-id]")).toHaveCount(23);
  await expect(chooser.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a topic on the empty workspace opens the chooser on that topic", async ({ page }) => {
  await page.goto("/");
  const empty = page.locator(".workspace-empty");
  await expect(empty).not.toContainText("checkout and payment");
  await empty.getByRole("button", { name: "Replication and consistency" }).click();
  const chooser = lessonChooser(page);
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("group", { name: "Topic" }).getByRole("button", { name: "Replication and consistency" })).toHaveAttribute("aria-pressed", "true");
  await expect(chooser.locator("[data-lesson-id]")).toHaveCount(3);
  await expect(chooser.locator(":focus")).toHaveAttribute("data-lesson-id", "cqrs-delayed");
  await page.keyboard.press("Escape");
  await expect(empty.getByRole("button", { name: "Replication and consistency" })).toBeFocused();
});

test("a lesson shows its version and last update on its card and under Goal, in the interface language", async ({ page }) => {
  const english = messages("en"), spanish = messages("es");
  for (const id of ["retry-unsafe", "normal"]) {
    const lesson = scenarios.find(item => item.id === id)!;
    const text = english.lessons.revision(lesson.revision);
    expect(text).toMatch(/^Version \d+ · updated [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await page.goto("/");
    await lessonTrigger(page).click();
    const card = lessonChoice(page, id);
    await expect(card.locator(".lesson-choice-revision")).toHaveText(text);
    // The revision is read after the description, as part of the choice's accessible description.
    await expect(card).toHaveAccessibleDescription(new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await card.click();
    await expect(status(page)).toHaveText("READY");
    await expect(page.locator(".lesson-goal-revision")).toHaveText(text);
  }
  // Spanish: the same data, with the date in Spanish.
  const lesson = scenarios.find(item => item.id === "retry-unsafe")!;
  await page.goto("/?lang=es");
  await page.locator(".lesson-trigger").click();
  await expect(page.locator('[data-lesson-id="retry-unsafe"] .lesson-choice-revision')).toHaveText(spanish.lessons.revision(lesson.revision));
  expect(spanish.lessons.revision(lesson.revision)).toMatch(/^Versión \d+ · actualizada el \d{1,2} [a-z]{3,4} \d{4}$/);
});
