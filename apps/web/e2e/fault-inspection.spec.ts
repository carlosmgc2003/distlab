import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadLesson } from "./support/lesson.ts";

async function revealRawState(page: Page) {
  // Advanced diagnostics is the Lesson panel's one disclosure; Distributed state nests its own raw-state disclosures.
  const raw = page.locator(".lesson-panel details.advanced-diagnostics");
  const rawToggle = raw.locator("> summary");
  await expect(raw).toBeVisible();
  if ((await raw.getAttribute("open")) === null) await rawToggle.click();
}

test("response-lost selection shows remote authorization and local timeout as distinct facts", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  const panel = page.getByRole("region", { name: "Distributed state" });
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  await revealRawState(page);
  await expect(panel).toContainText("checkout-processor-response-lost@1");
  await expect(panel).toContainText("mvp-response-lost-001");
  await expect(panel).toContainText("drop-first-processor-authorize-response");
  await expect(panel).toContainText("Status: recorded");
  const knowledge = page.locator(".knowledge-boundary");
  await expect(knowledge).toContainText("No payment row is committed yet");
  await expect(knowledge).not.toContainText("NETWORK_TIMEOUT");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expect(knowledge).toContainText("NETWORK_TIMEOUT");
  await expect(knowledge).toContainText("UNKNOWN");
  await expect(knowledge).toContainText("authorization-1 APPROVED");
  await expect(knowledge).toContainText("different facts");
  await expect(knowledge).toContainText("not proof of denial or rollback");
  await expect(panel).toContainText("UNKNOWN");
  await expect(panel).toContainText("APPROVED");
  await expect(panel).toContainText("Status: selected");
  await expect(panel).not.toContainText("payment failed");
  await expect(page.locator("body")).not.toContainText("effectCount");

  await panel.getByRole("button", { name: "Show Payments timeout", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("network.request.timedout");
  // Evidence navigation switches to history focus; reveal the command toolbar to reach the next link.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  await panel.getByRole("button", { name: "Show processor authorization", exact: true }).click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("external.effect.committed");
  await panel.getByRole("button", { name: "Show fault selection", exact: true }).click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("fault.effect.selected");

  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Orders, Internal service", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("CREATED");
  await page.getByRole("button", { name: "Payments, Internal service", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("NETWORK_TIMEOUT");
  await page.getByRole("button", { name: "Payment Processor, External service", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toContainText("authorization-1");
  await expect(inspector).toContainText("APPROVED");
  await expect(inspector).not.toContainText("effectCount");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  await expect(knowledge).not.toContainText("NETWORK_TIMEOUT");
  await expect(knowledge).toContainText("No payment row is committed yet");
  await expect(panel).toContainText("Status: recorded");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expect(knowledge).toContainText("NETWORK_TIMEOUT");
  await expect(knowledge).toContainText("authorization-1 APPROVED");

  await loadLesson(page, "normal");
  await expect(status).toHaveText("READY");
  await revealRawState(page);
  await expect(panel).toContainText("checkout-normal@1");
  await expect(panel).toContainText("mvp-normal-001");
  await expect(panel).toContainText("Status: not recorded");
  await expect(panel).toContainText("No fault rule is recorded.");
  await expect(panel).not.toContainText("authorization-1");
  await expect(panel).not.toContainText("NETWORK_TIMEOUT");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expect(panel).toContainText("AUTHORIZED");
  await expect(panel).toContainText("authorization-1");
  await expect(panel).toContainText("matches a visible processor authorization");
  await expect(panel).not.toContainText("NETWORK_TIMEOUT");
  await expect(panel).not.toContainText("payment failed");

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".graph-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Payments, Internal service", exact: true }).click();
  await expect(inspector).toContainText("AUTHORIZED");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
