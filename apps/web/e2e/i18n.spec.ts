import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { lessonChoice, lessonChooser } from "./support/lesson.ts";
import { messages } from "../src/i18n/catalog.ts";

/**
 * ADR-007: the interface language is presentation state. These tests read their
 * expected text from the catalogs, so a wording change is made in one place.
 */
const en = messages("en");
const es = messages("es");

/** The visible language picker: on the start screen, or in the open Lesson chooser. */
const languagePicker = (page: Page) => page.locator(".language-switcher select").filter({ visible: true });

/** Records every command the page posts to the simulation worker. */
async function recordWorkerCommands(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const commands: string[] = [];
    (window as unknown as { workerCommands: string[] }).workerCommands = commands;
    const Native = window.Worker;
    window.Worker = class extends Native {
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        if (message && typeof message === "object" && "type" in message) commands.push(String((message as { type: unknown }).type));
        return super.postMessage(message, options as StructuredSerializeOptions);
      }
    } as typeof Worker;
  });
}
const workerCommands = (page: Page) => page.evaluate(() => [...(window as unknown as { workerCommands: string[] }).workerCommands]);

/** Opens the lesson chooser from the top bar, whatever the language. */
async function chooseLesson(page: Page, id: string): Promise<void> {
  await page.locator("header.command-toolbar .lesson-trigger").click();
  await lessonChoice(page, id).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

test("I18N-AC-10: a browser set to Spanish opens in Spanish, with lang=es", async ({ browser }) => {
  const context = await browser.newContext({ locale: "es-AR" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(languagePicker(page)).toHaveValue("es");
  await expect(languagePicker(page)).toHaveAccessibleName(es.common.language);
  await context.close();
});

test("I18N-AC-11: switching language keeps the session, sends no worker command, and is remembered", async ({ page }) => {
  await recordWorkerCommands(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // The top bar stays one row (#144): the picker lives on the start screen and in the Lesson chooser.
  await expect(page.locator("header.top-bar .language-switcher")).toHaveCount(0);
  await chooseLesson(page, "retry-unsafe");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const before = await workerCommands(page);
  const graphBefore = await page.locator(".react-flow__node").count();

  await page.locator("header.command-toolbar .lesson-trigger").click();
  await languagePicker(page).selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("dialog[open]").getByLabel(es.common.language, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // The same lesson and graph stay loaded: the language is not a simulation input.
  await expect(page.locator(".react-flow__node")).toHaveCount(graphBefore);
  expect(await workerCommands(page)).toEqual(before);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(languagePicker(page)).toHaveValue("es");
  await languagePicker(page).selectOption("en");
  await expect(languagePicker(page)).toHaveAccessibleName(en.common.language);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("I18N-AC-12: the Spanish interface passes accessibility checks on the start screen, the chooser, and a lesson", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?lang=es");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator("header.command-toolbar .lesson-trigger").click();
  await expect(lessonChooser(page).or(page.locator("dialog[open]"))).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await lessonChoice(page, "retry-idempotent").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
