import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { commerceLessonNames } from "../../../packages/catalogs/src/commerce/scenarios.ts";

for (const name of commerceLessonNames) {
  test(`${name}: select, step, run, inspect facts and checks, reset and replay`, async ({ page }, testInfo) => {
    await page.goto("/");
    const status = page.getByRole("status", { name: "Simulation status" });
    await page.getByLabel("Scenario", { exact: true }).selectOption(name);
    await page.getByRole("button", { name: "Load scenario", exact: true }).click();
    await expect(status).toHaveText("READY");
    await page.getByRole("button", { name: "Step", exact: true }).click();
    await expect(status).toHaveText("PAUSED");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    const state = page.getByRole("region", { name: "Commerce lesson state", exact: true });
    const checks = state.getByRole("list", { name: "Lesson checks", exact: true });
    await expect(checks).toContainText("PASS");
    await expect(checks).not.toContainText("FAIL");
    await expect(checks).not.toContainText("PENDING");
    const recorded = await state.innerText();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(status).toHaveText("READY");
    await expect(checks).toContainText("PENDING");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    expect(await state.innerText()).toBe(recorded);
    await checks.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}-state.png`) });
    await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
    await expect(page.getByRole("button", { name: "Story", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("list", { name: "Milestone categories, shapes, and counts" })).toContainText("Business event");
    await expect(page.getByRole("region", { name: "Story diagram", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".story-table")).toBeVisible();
  });
}

test("compare replaces the experiment; commerce state fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption("retry-unsafe");
  await page.getByRole("button", { name: "Load scenario", exact: true }).click();
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expect(page.getByRole("region", { name: "payments state", exact: true })).toContainText("payment-2");
  await page.getByRole("button", { name: "Compare: Retry with idempotency", exact: true }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expect(page.getByRole("region", { name: "payments state", exact: true })).not.toContainText("payment-2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
