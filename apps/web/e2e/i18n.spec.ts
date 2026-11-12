import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { messages } from "../src/i18n/catalog.ts";

/**
 * ADR-007: the interface language is presentation state. These tests read their
 * expected text from the catalogs, so a wording change is made in one place.
 */
const en = messages("en");
const es = messages("es");

/** The visible language picker: on the start screen, or in the open Lesson chooser. */
/** A lesson in the open Lesson chooser, found by packaged id rather than the dialog's English name. */
const lessonChoice = (page: Page, id: string) => page.locator(`dialog[open] [data-lesson-id="${id}"]`);

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
  await expect(page.locator("dialog[open]")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await lessonChoice(page, "retry-idempotent").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

/**
 * Visible text outside a pseudo-locale span ⟦…⟧ that still reads as English prose. Identifiers,
 * numbers, glyphs, and recorded data have no two consecutive words, so they are not reported.
 */
async function untranslatedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || element.closest("script, style, [hidden], .sr-only[aria-hidden='true']")) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) continue;
      // Payload values and raw records are data (ADR-007 §1), and the graph library's attribution is a product name.
      if (element.closest("pre, code, kbd, [data-raw-record], .react-flow__attribution")) continue;
      const outside = (node.textContent ?? "").replace(/⟦[^⟧]*⟧/g, " ");
      if (/\b[A-Za-z]{3,}[,;:]? [A-Za-z]{3,}\b/.test(outside)) found.push(outside.trim().replace(/\s+/g, " ").slice(0, 120));
    }
    for (const element of document.querySelectorAll<HTMLElement>("[aria-label], [title], [placeholder]")) {
      if (element.closest(".react-flow__attribution")) continue;
      for (const name of ["aria-label", "title", "placeholder"]) {
        const value = (element.getAttribute(name) ?? "").replace(/⟦[^⟧]*⟧/g, " ");
        if (/\b[A-Za-z]{3,}[,;:]? [A-Za-z]{3,}\b/.test(value)) found.push(`[${name}] ${value.trim().slice(0, 120)}`);
      }
    }
    return [...new Set(found)];
  });
}

test("I18N-AC-15: in the pseudo-locale, no English prose is left on the start screen, the chooser, or a run lesson", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?lang=en-XA");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await untranslatedText(page)).toEqual([]);
  await page.locator("header.command-toolbar .lesson-trigger").click();
  expect(await untranslatedText(page)).toEqual([]);
  await lessonChoice(page, "retry-unsafe").click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(await untranslatedText(page)).toEqual([]);
  const run = page.locator(".control-buttons button").first();
  await run.click();
  await expect(run).toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  expect(await untranslatedText(page)).toEqual([]);
  await page.locator("#tab-history").click();
  expect(await untranslatedText(page)).toEqual([]);
});

test("I18N-AC-16: in Spanish the top bar stays one row, before and after a lesson loads", async ({ page }) => {
  test.setTimeout(60_000);
  // The same viewports as the English contract in top-bar.spec.ts.
  for (const size of [{ width: 1366, height: 768 }, { width: 1534, height: 897 }]) {
    await page.setViewportSize(size);
    await page.goto("/?lang=es");
    expect((await page.locator("header.top-bar").boundingBox())!.height, `empty, ${size.width}px`).toBeLessThanOrEqual(64);
    await page.locator("header.command-toolbar .lesson-trigger").click();
    await lessonChoice(page, "retry-unsafe").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    const run = page.locator(".control-buttons button").first();
    await run.click();
    await expect(run).toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    expect((await page.locator("header.top-bar").boundingBox())!.height, `completed, ${size.width}px`).toBeLessThanOrEqual(64);
    // No control in the bar overlaps another (the Spanish group label once covered "Abrir…").
    const boxes = await page.locator("header.top-bar :is(button, h2:not(.sr-only), .run-status)").evaluateAll(elements =>
      elements.filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect()).map(r => [r.left, r.top, r.right, r.bottom] as const));
    const overlapping = boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1).map(() => i));
    expect(overlapping, `overlaps at ${size.width}px`).toEqual([]);
  }
});
