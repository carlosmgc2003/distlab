import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import { commerceLessonNames } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import type { Locator, Page } from "@playwright/test";
import { measureLayout, viewports } from "./layout-budget.ts";
import { loadLesson } from "./support/lesson.ts";
import { filterByType, viewButton } from "./support/history.ts";
import { inServiceState } from "./support/service-state.ts";
import { commerceComponentNames } from "../src/component-display.ts";

/** The lesson checks live in the Lesson panel's ③ Investigate (#141); service facts in the Service state dialog (#142). */
const lessonChecks = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true }).getByRole("region", { name: "Lesson checks", exact: true });
const serviceText = (page: Page) => inServiceState(page, dialog => dialog.getByRole("region", { name: "Service knowledge and committed state", exact: true }).innerText());
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
    const recorded = [await state.innerText(), await serviceText(page)];
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(status).toHaveText("READY");
    await expect(checks).toContainText("PENDING");
    await expect(checks).not.toContainText(/HOLDS|VIOLATED/);
    await expect(summary(page)).toHaveText("Checks are pending: run the lesson");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    expect([await state.innerText(), await serviceText(page)]).toEqual(recorded);
    // One announcement per completed run, each the run's summary.
    await expect(summary(page)).toHaveText(outcome);
    expect(await announcements(page)).toEqual([outcome, outcome]);
    await checks.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}-state.png`) });
    await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
    await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "true");
    // Story keeps only the documented milestones; a commerce run's business logs and check results are among them.
    const legend = page.getByRole("list", { name: "Milestone categories, shapes, and counts" });
    await expect(legend).toContainText("Business log");
    await expect(legend).toContainText("Check result");
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
  await inServiceState(page, dialog => expect(dialog.getByRole("region", { name: "Payments state", exact: true })).toContainText("payment-2"));
  await page.getByRole("button", { name: "Compare: Retry with idempotency", exact: true }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await inServiceState(page, async dialog => {
    await expect(dialog.getByRole("region", { name: "Payments state", exact: true })).not.toContainText("payment-2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The open dialog has no axe violations.
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the notifications pair shows the dead-letter queue only when the retry budget is bounded", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  for (const [name, letters] of [["notifications-dlq", 1], ["notifications-unbounded", 0]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await inServiceState(page, async dialog => {
      const orderPlaced = dialog.getByRole("region", { name: "OrderPlaced state", exact: true });
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
    });
  }
});

test("the cache pair shows live KV entries with their expiry, the price Orders used, and TTL expiry in history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const region = (dialog: Locator, component: string) => dialog.getByRole("region", { name: `${commerceComponentNames[component]} state`, exact: true });
  const invariants = lessonChecks(page).getByRole("list", { name: "Business invariants", exact: true });
  for (const [name, price, source, verdict] of [["cache-stale-price", 1000, "cache", "VIOLATED"], ["cache-invalidated", 1200, "database", "HOLDS"]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    // Step until both carts are live: each entry shows its absolute expiry.
    const step = page.getByRole("button", { name: "Step", exact: true });
    for (let i = 0; i < 80 && !(await inServiceState(page, dialog => region(dialog, "cart").innerText())).includes("cart:cart-2"); i++) {
      await step.click();
      await expect(status).toHaveText("PAUSED");
    }
    await inServiceState(page, async dialog => {
      await expect(region(dialog, "cart")).toContainText("cart:cart-1");
      await expect(region(dialog, "cart")).toContainText("expires at t=31");
      await expect(region(dialog, "catalog")).toContainText("price:sku-1");
      await expect(region(dialog, "catalog")).toContainText("expires at t=101");
    });
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    // Every entry has expired by the end of the run; the committed rows remain.
    await inServiceState(page, async dialog => {
      await expect(region(dialog, "cart")).not.toContainText("cart:cart-1");
      await expect(region(dialog, "orders")).toContainText(`price: ${price}`);
      await expect(region(dialog, "orders")).toContainText(`priceSource: ${source}`);
      await expect(region(dialog, "orders")).toContainText("reason: CART_EXPIRED");
      await expect(region(dialog, "catalog")).toContainText("validFrom: 11");
    });
    await expect(invariants.getByRole("listitem").filter({ hasText: "An order is priced with the catalog price valid at checkout" })).toContainText(verdict);
    await expect(invariants.getByRole("listitem").filter({ hasText: "An expired cart cannot be checked out" })).toContainText("HOLDS");
  }
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  // Each expiry is a Story milestone named by its stored key.
  await filterByType(page, "kv.expired");
  const rows = page.locator("#timeline-rows .story-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Key-value entry expired: cart:cart-1" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Key-value entry expired: price:sku-1" })).toContainText("catalog");
});

test("the inventory pair shows stock with its version and each client's outcome, and the rejected commit in history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const invariants = lessonChecks(page).getByRole("list", { name: "Business invariants", exact: true });
  for (const [name, stock, version, outcome, verdict] of [["inventory-oversell", -1, 3, "RESERVED", "VIOLATED"], ["inventory-optimistic", 0, 2, "OUT_OF_STOCK", "HOLDS"]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await inServiceState(page, async dialog => {
      const inventory = dialog.getByRole("region", { name: "Inventory state", exact: true });
      await expect(inventory).toContainText(`stock: ${stock}`);
      await expect(inventory).toContainText(`version: ${version}`);
      await expect(inventory).toContainText("res-customer-app");
      await expect(dialog.getByRole("region", { name: "Partner API state", exact: true })).toContainText(`status: ${outcome}`);
    });
    for (const label of ["Stock is never negative", "A unit has at most one active reservation"]) {
      await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText(verdict);
    }
  }
  // The optimistic run is loaded: its rejected commit is in Recorded history.
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await filterByType(page, "database.transaction.rejected");
  await expect(page.locator("#timeline-rows .story-table tbody tr")).toHaveCount(1);
  await page.locator("#timeline-rows").getByRole("button", { name: "Transaction rejected (TRANSACTION_CONFLICT)", exact: true }).click();
  await expect(page.locator("#inspection-panel")).toContainText("TRANSACTION_CONFLICT");
});

test("the lease pair draws the key-value node as a shared store and shows the lease entry, the token, and the expiry in history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const invariants = lessonChecks(page).getByRole("list", { name: "Business invariants", exact: true });
  for (const [name, writer, verdict] of [["lease-unfenced", "worker-1", "VIOLATED"], ["lease-fenced", "worker-2", "HOLDS"]] as const) {
    await loadLesson(page, name);
    await expect(status).toHaveText("READY");
    // Both workers point at one store node: no service box and no separate store beside it.
    const kv = page.locator('.react-flow__node[data-id="kv"]');
    await expect(kv).toHaveAccessibleName("Key-Value Store, Shared key-value store");
    await expect(kv).toHaveClass(/symbol-kvstore/);
    await expect(kv).toContainText("Shared key-value store");
    await expect(page.locator('.react-flow__node[data-id="resource:kv:kv"]')).toHaveCount(0);
    await expect(page.locator('.react-flow__node[data-id="resource:db:storage"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status).toHaveText("COMPLETED");
    await inServiceState(page, async dialog => {
      // Both leases have expired by the end of the run; the token counter stays.
      const store = dialog.getByRole("region", { name: "Key-Value Store state", exact: true });
      await expect(store).toContainText("lock:report:token");
      await expect(store).not.toContainText("expires at");
      await expect(dialog.getByRole("region", { name: "Storage state", exact: true })).toContainText(`writer: ${writer}`);
    });
    for (const label of ["Storage never accepts a write with a smaller lease token after a larger one", "The report file holds the write with the largest lease token storage accepted"]) {
      await expect(invariants.getByRole("listitem").filter({ hasText: label })).toContainText(verdict);
    }
  }
  // The store removes each lease by itself: two expiries in Recorded history.
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await filterByType(page, "kv.expired");
  await expect(page.locator("#timeline-rows .story-table tbody tr")).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
