import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { loadLesson } from "./support/lesson.ts";

// #165: Show evidence shows the rows the check stored, readable without opening the technical record.

const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const invariants = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true })
  .getByRole("region", { name: "Lesson checks", exact: true }).getByRole("list", { name: "Business invariants", exact: true });

test("#165 Show evidence on the double charge shows both payment rows above the technical record", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  await invariants(page).getByRole("button", { name: "Show evidence: A retried payment request charges the order once", exact: true }).click();

  const detail = page.locator("#inspection-panel");
  await expect(detail).toContainText("A retried payment request charges the order once — The check did not pass at t=22.");
  const rows = detail.getByRole("list", { name: "Stored evidence", exact: true }).getByRole("listitem");
  await expect(rows).toHaveText([
    "payment-1 — paymentId: payment-1 · status: APPROVED · orderId: order-1 · amount: 5000",
    "payment-2 — paymentId: payment-2 · status: APPROVED · orderId: order-1 · amount: 5000",
  ]);
  // Visible without expanding the technical record, and on screen in the docked detail panel.
  await expect(detail.locator("details", { hasText: "Technical record" })).not.toHaveAttribute("open", "");
  for (const row of await rows.all()) await expect(row).toBeInViewport();
  await expect(detail).not.toContainText("No before or after values were stored.");
  await page.screenshot({ path: test.info().outputPath("check-evidence.png") });
});

test("#165 a check that holds shows its evidence too, labelled with the lesson's wording", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "inventory-optimistic");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  await invariants(page).getByRole("button", { name: "Show evidence: Stock is never negative", exact: true }).click();
  const detail = page.locator("#inspection-panel");
  await expect(detail).toContainText("Stock is never negative — The check passed at t=8.");
  await expect(detail.getByRole("list", { name: "Stored evidence", exact: true }).getByRole("listitem")).toHaveText(["sku: sku-1 · stock: 0 · version: 2"]);
});
