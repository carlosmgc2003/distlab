import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import { commerceLessonNames } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import type { Page } from "@playwright/test";
import { measureLayout, viewports } from "./layout-budget.ts";
import { loadLesson } from "./support/lesson.ts";
import { filterByType, viewButton } from "./support/history.ts";

/** The lesson checks live in the Lesson panel's ③ Investigate (#141); service facts stay below the graph. */
const lessonChecks = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true }).getByRole("region", { name: "Lesson checks", exact: true });
const serviceState = (page: Page) => page.getByRole("region", { name: "Service knowledge and committed state", exact: true });
const summary = (page: Page) => page.locator(".lesson-step-investigate .lesson-outcome");

/** Records every non-empty text the polite "Lesson outcome" live region takes, in order. */
async function recordAnnouncements(page: Page) {
  await page.getByRole("status", { name: "Lesson outcome", exact: true }).evaluate(region => {
    const seen: string[] = [];
    (window as unknown as { announcements: string[] }).announcements = seen;
    let last = region.textContent ?? "";
    new MutationObserver(() => {
      const text = region.textContent ?? "";
      if (text !== last && text) seen.push(text);
      last = text;
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);

for (const name of commerceLessonNames) {
  test(`${name}: select, step, run, inspect facts and checks, reset and replay`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewports["1366x768"]);
    await page.goto("/");
    const status = page.getByRole("status", { name: "Simulation status" });
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    await recordAnnouncements(page);
    await page.getByRole("button", { name: "Step", exact: true }).click();
    await expect(status).toHaveText("PAUSED");
    // Run from the keyboard: the reveal must leave focus on the element that had it.
    const run = page.getByRole("button", { name: "Run", exact: true });
    await run.focus();
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("COMPLETED");
    await expect(run).toBeFocused();
    const state = lessonChecks(page);
    const checks = state.getByRole("list", { name: "Business invariants", exact: true });
    // The first verdict is revealed in the Lesson panel without any scrolling by the test.
    await expect.poll(async () => (await measureLayout(page)).firstVerdictVisible, { message: `${name}: first verdict on screen at 1366x768` }).toBe(true);
    await expect(summary(page)).toHaveText(/^(\d+ of \d+ business invariants violated|All \d+ business invariants hold)$/);
    const outcome = await summary(page).innerText();
    expect(await announcements(page)).toEqual([outcome]);
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
    const recorded = [await state.innerText(), await serviceState(page).innerText()];
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(status).toHaveText("READY");
    await expect(checks).toContainText("PENDING");
    await expect(checks).not.toContainText(/HOLDS|VIOLATED/);
    await expect(summary(page)).toHaveText("Checks are pending: run the lesson");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    expect([await state.innerText(), await serviceState(page).innerText()]).toEqual(recorded);
    // One announcement per completed run, each the run's summary.
    await expect(summary(page)).toHaveText(outcome);
    expect(await announcements(page)).toEqual([outcome, outcome]);
    await checks.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}-state.png`) });
    await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
    await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "true");
    // Story keeps only the documented milestones, so a commerce run teaches on its network,
    // message, transaction, and fault records. runtime.log is not a milestone; its records
    // stay in Learning and Raw.
    const legend = page.getByRole("list", { name: "Milestone categories, shapes, and counts" });
    await expect(legend).not.toContainText("Business event");
    await expect(legend.locator("li")).not.toHaveCount(0);
    await expect(legend).toContainText(/Request|Response|Transaction commit|Fault|Timeout/);
    await expect(page.getByRole("region", { name: "Story diagram", exact: true })).toBeVisible();
    await viewButton(page, "Story table").click();
    await expect(page.locator(".story-table")).toBeVisible();
  });
}

test("the Saga pair shows the same invariants VIOLATED, then HOLDS, and each verdict links to its evidence", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const state = lessonChecks(page);
  const invariants = state.getByRole("list", { name: "Business invariants", exact: true });
  await loadLesson(page, "saga-uncompensated");
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  const labels = ["A failed order is cancelled", "A failed order does not keep inventory reserved", "A failed order keeps no approved payment"];
  for (const label of labels) await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText("VIOLATED");
  await expect(summary(page)).toHaveText("3 of 3 business invariants violated");
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
  await expect(summary(page)).toHaveText("All 3 business invariants hold");
});

test("compare replaces the experiment; commerce state fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
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
  const state = serviceState(page);
  const orderPlaced = state.getByRole("region", { name: "OrderPlaced state", exact: true });
  for (const [name, letters] of [["notifications-dlq", 1], ["notifications-unbounded", 0]] as const) {
    await loadLesson(page, name);
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

test("the cache pair shows live KV entries with their expiry, the price Orders used, and TTL expiry in history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const state = serviceState(page);
  const cart = state.getByRole("region", { name: "cart state", exact: true });
  const catalog = state.getByRole("region", { name: "catalog state", exact: true });
  const orders = state.getByRole("region", { name: "orders state", exact: true });
  const invariants = lessonChecks(page).getByRole("list", { name: "Business invariants", exact: true });
  for (const [name, price, source, verdict] of [["cache-stale-price", 1000, "cache", "VIOLATED"], ["cache-invalidated", 1200, "database", "HOLDS"]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    // Step until both carts are live: each entry shows its absolute expiry.
    const step = page.getByRole("button", { name: "Step", exact: true });
    for (let i = 0; i < 80 && !(await cart.innerText()).includes("cart:cart-2"); i++) {
      await step.click();
      await expect(status).toHaveText("PAUSED");
    }
    await expect(cart).toContainText("cart:cart-1");
    await expect(cart).toContainText("expires at t=31");
    await expect(catalog).toContainText("price:sku-1");
    await expect(catalog).toContainText("expires at t=101");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    // Every entry has expired by the end of the run; the committed rows remain.
    await expect(cart).not.toContainText("cart:cart-1");
    await expect(orders).toContainText(`price: ${price}`);
    await expect(orders).toContainText(`priceSource: ${source}`);
    await expect(orders).toContainText("reason: CART_EXPIRED");
    await expect(catalog).toContainText("validFrom: 11");
    await expect(invariants.getByRole("listitem").filter({ hasText: "An order is priced with the catalog price valid at checkout" })).toContainText(verdict);
    await expect(invariants.getByRole("listitem").filter({ hasText: "An expired cart cannot be checked out" })).toContainText("HOLDS");
  }
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  // Raw renders a window of rows, so narrow it to the expiry records with the Type filter.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  await filterByType(page, "kv.expired");
  const rows = page.locator("#timeline-rows");
  await expect(page.locator(".timeline-count")).toHaveText(/^3 of \d+ observations/);
  await expect(rows).toContainText("cart");
  await expect(rows).toContainText("catalog");
});

test("the inventory pair shows stock with its version and each client's outcome, and the rejected commit in history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const state = serviceState(page);
  const inventory = state.getByRole("region", { name: "inventory state", exact: true });
  const partner = state.getByRole("region", { name: "partner-api state", exact: true });
  const invariants = lessonChecks(page).getByRole("list", { name: "Business invariants", exact: true });
  for (const [name, stock, version, outcome, verdict] of [["inventory-oversell", -1, 3, "RESERVED", "VIOLATED"], ["inventory-optimistic", 0, 2, "OUT_OF_STOCK", "HOLDS"]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await expect(inventory).toContainText(`stock: ${stock}`);
    await expect(inventory).toContainText(`version: ${version}`);
    await expect(inventory).toContainText("res-customer-app");
    await expect(partner).toContainText(`status: ${outcome}`);
    for (const label of ["Stock is never negative", "A unit has at most one active reservation"]) {
      await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText(verdict);
    }
  }
  // The optimistic run is loaded: its rejected commit is in Recorded history.
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  await filterByType(page, "database.transaction.rejected");
  await expect(page.locator(".timeline-count")).toHaveText(/^1 of \d+ observations/);
  await page.locator("#timeline-rows").getByRole("button", { name: /database.transaction.rejected inventory/ }).click();
  await expect(page.locator("#inspection-panel")).toContainText("TRANSACTION_CONFLICT");
});
