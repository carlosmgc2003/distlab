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
    const checks = state.getByRole("list", { name: "Business invariants", exact: true });
    await expect(checks).toContainText(/HOLDS|VIOLATED/);
    // A verdict is never a bare PASS or FAIL, and an unsafe lesson's violation is never green.
    await expect(state).not.toContainText(/\b(PASS|FAIL)\b/);
    await expect(checks).not.toContainText("PENDING");
    for (const item of await checks.getByRole("listitem").filter({ hasText: "VIOLATED" }).all()) {
      expect(await item.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await item.evaluate(node => getComputedStyle(node.ownerDocument.body).backgroundColor));
      await expect(item).toHaveClass(/is-violated/);
    }
    const setup = state.getByRole("list", { name: "Scenario expectations", exact: true });
    if (await setup.count()) await expect(state.getByRole("heading", { name: "Lesson setup reproduced: yes" })).toBeVisible();
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
    // Story keeps only the documented milestones, so a commerce run teaches on its network,
    // message, transaction, and fault records. runtime.log is not a milestone; its records
    // stay in Learning and Raw.
    const legend = page.getByRole("list", { name: "Milestone categories, shapes, and counts" });
    await expect(legend).not.toContainText("Business event");
    await expect(legend.locator("li")).not.toHaveCount(0);
    await expect(legend).toContainText(/Request|Response|Transaction commit|Fault|Timeout/);
    await expect(page.getByRole("region", { name: "Story diagram", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".story-table")).toBeVisible();
  });
}

test("the Saga pair shows the same invariants VIOLATED, then HOLDS, and each verdict links to its evidence", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const state = page.getByRole("region", { name: "Commerce lesson state", exact: true });
  const invariants = state.getByRole("list", { name: "Business invariants", exact: true });
  await page.getByLabel("Scenario", { exact: true }).selectOption("saga-uncompensated");
  await page.getByRole("button", { name: "Load scenario", exact: true }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  const labels = ["A failed order is cancelled", "A failed order does not keep inventory reserved", "A failed order keeps no approved payment"];
  for (const label of labels) await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText("VIOLATED");
  await expect(state.getByRole("heading", { name: "Lesson setup reproduced: yes" })).toBeVisible();

  // The evidence link opens Recorded history at that check's evaluation record.
  await invariants.getByRole("button", { name: "Show evidence: A failed order keeps no approved payment", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Recorded history", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#history-panel")).toContainText("failed-order-refunded");
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();

  await page.getByRole("button", { name: "Compare: Saga: compensate", exact: true }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  for (const label of labels) await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText("HOLDS");
  await expect(invariants).not.toContainText("VIOLATED");
});

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

test("the notifications pair shows the dead-letter queue only when the retry budget is bounded", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const state = page.getByRole("region", { name: "Commerce lesson state", exact: true });
  const orderPlaced = state.getByRole("region", { name: "OrderPlaced state", exact: true });
  for (const [name, letters] of [["notifications-dlq", 1], ["notifications-unbounded", 0]] as const) {
    await page.getByLabel("Scenario", { exact: true }).selectOption(name);
    await page.getByRole("button", { name: "Load scenario", exact: true }).click();
    await expect(status).toHaveText("READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await expect(orderPlaced).toContainText("Dead-letter queue");
    const queue = orderPlaced.getByRole("list", { name: "OrderPlaced dead-letter queue", exact: true });
    if (letters) {
      await expect(queue.getByRole("listitem")).toHaveCount(1);
      await expect(queue).toContainText("attempts: 3");
      await expect(orderPlaced).toContainText("state: DEAD");
    } else {
      await expect(queue).toHaveCount(0);
      await expect(orderPlaced).toContainText("No dead-lettered messages.");
      await expect(orderPlaced).toContainText("attempt: 6");
    }
  }
});
