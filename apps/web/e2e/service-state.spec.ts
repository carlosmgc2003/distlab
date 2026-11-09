import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { loadLesson } from "./support/lesson.ts";
import { serviceStateButton, serviceStateDialog } from "./support/service-state.ts";

/**
 * Service state (#142): what each service knows right now is one modal dialog opened from ③ Investigate,
 * and the Architecture tab holds only the graph.
 */

async function completed(page: Page, lesson: string) {
  await page.goto("/");
  await loadLesson(page, lesson);
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
}

for (const lesson of ["response-lost", "saga-uncompensated", "retry-unsafe"]) {
  test(`${lesson}: the Architecture tab ends with the graph and does not scroll at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await completed(page, lesson);
    const panel = page.locator("#architecture-panel");
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    // ArchitectureView's last element is its Connections disclosure; nothing follows it in the tab panel.
    expect(await panel.evaluate(element => element.lastElementChild?.matches("details.connections") ?? false)).toBe(true);
    await expect(panel.locator(".commerce-state, .state-inspection")).toHaveCount(0);
    const { scrollHeight, clientHeight } = await panel.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(scrollHeight).toBe(clientHeight);
    // Advanced diagnostics keeps only the engine counters.
    await expect(page.locator(".lesson-panel details.advanced-diagnostics .state-inspection")).toHaveCount(0);
  });
}

for (const [lesson, content] of [["retry-unsafe", "Service knowledge and committed state"], ["response-lost", "Distributed state"]] as const) {
  test(`${lesson}: Show service state opens a modal that keeps focus, closes with Escape, and returns focus`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await completed(page, lesson);
    const button = serviceStateButton(page);
    const dialog = serviceStateDialog(page);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(/^Service state at t=\d+$/);
    await expect(dialog.getByRole("region", { name: content, exact: true })).toBeVisible();
    // The body scrolls on its own inside a dialog at most 90 vh tall.
    const box = (await dialog.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(768 * 0.9 + 1);

    // Focus never reaches the page behind the modal dialog. Past its last control, Chromium hands focus to
    // the browser's own UI, which leaves the document's active element at <body>.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement))).toBe(true);
    }
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });
}
