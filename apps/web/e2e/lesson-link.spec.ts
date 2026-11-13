import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";

// Direct lesson links (`lesson-link.ts`): an instructor shares `?lesson=<id>`, and the student starts on that lesson.

declare global {
  interface Window { linkCommands: WorkerCommand[] }
}

async function captureCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.linkCommands = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.linkCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}
const loads = async (page: Page) => (await page.evaluate(() => window.linkCommands)).filter(command => command.type === "load");
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const search = (page: Page) => new URL(page.url()).search;

test("a lesson link opens that lesson with one load and no overlay, without the chooser", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/?lesson=retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await expect(lessonTrigger(page)).toHaveText(/^Lesson: Retry without idempotency/);
  await expect(lessonChooser(page)).toBeHidden();
  const sent = await loads(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type === "load" && "overlay" in sent[0]).toBe(false);
  expect(search(page)).toBe("?lesson=retry-unsafe");
});

test("the address bar follows the chosen lesson and keeps the language, without adding history entries", async ({ page }) => {
  await page.goto("/?lang=es");
  const before = await page.evaluate(() => window.history.length);
  await page.locator("header.command-toolbar .lesson-trigger").click();
  // The chooser's name is Spanish here, so it is found by its class.
  await page.locator('dialog.lesson-chooser [data-lesson-id="cache-stale-price"]').click();
  await expect(page.locator("dialog.lesson-chooser")).toBeHidden();
  await expect(page.getByRole("status", { name: "Estado de la simulación" })).toHaveText("LISTO");
  expect(search(page)).toBe("?lang=es&lesson=cache-stale-price");
  expect(await page.evaluate(() => window.history.length)).toBe(before);
});

test("a link that names no packaged lesson says so on the welcome screen until a lesson is chosen", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/?lesson=no-such-lesson");
  const alert = page.locator(".workspace-empty").getByRole("alert");
  await expect(alert).toHaveText("This link names a lesson DistLab does not have: “no-such-lesson”. Choose one of the lessons below.");
  expect(await loads(page)).toHaveLength(0);
  await loadLesson(page, "saga-uncompensated");
  await expect(status(page)).toHaveText("READY");
  await expect(alert).toHaveCount(0);
  expect(search(page)).toBe("?lesson=saga-uncompensated");
});

test("an assessment link opens the assessment", async ({ page }) => {
  await page.goto("/?assessment=reliable-checkout");
  await expect(lessonTrigger(page)).toHaveText(/Lesson: Reliable Checkout assessment/);
  await expect(page.getByRole("tab", { name: "Assessment results" })).toHaveAttribute("aria-selected", "true");
  expect(search(page)).toBe("?assessment=reliable-checkout");
});

test("Copy link to this lesson copies the lesson's link without the language and sends no command", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await captureCommands(page);
  await page.goto("/?lang=en&lesson=retry-idempotent");
  await expect(status(page)).toHaveText("READY");
  const sent = (await page.evaluate(() => window.linkCommands)).length;
  await page.getByRole("button", { name: "Copy link to this lesson", exact: true }).click();
  await expect(page.locator(".lesson-panel").getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/?lesson=retry-idempotent`);
  expect(await page.evaluate(() => window.linkCommands)).toHaveLength(sent);
});

test("where the clipboard is refused, the link is shown to copy by hand", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await page.goto("/?lesson=retry-idempotent");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Copy link to this lesson", exact: true }).click();
  const origin = new URL(page.url()).origin;
  await expect(page.locator(".lesson-panel").getByRole("status").filter({ hasText: "could not be copied" }))
    .toHaveText(`The link could not be copied. Copy it by hand: ${origin}/?lesson=retry-idempotent`);
});
