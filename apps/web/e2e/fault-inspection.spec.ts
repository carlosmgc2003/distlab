import { expect, test } from "./support/test.ts";
import { loadLesson } from "./support/lesson.ts";
import { inServiceState, openServiceState, serviceStateButton, serviceStateDialog } from "./support/service-state.ts";

test("response-lost selection shows remote authorization and local timeout as distinct facts", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  // Distributed state lives in the Service state dialog, opened from ③ Investigate (#142).
  const dialog = serviceStateDialog(page);
  const panel = dialog.getByRole("region", { name: "Distributed state" });
  const knowledge = dialog.locator(".knowledge-boundary");
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  await openServiceState(page);
  await expect(dialog.getByRole("heading", { name: "Service state at t=0" })).toBeVisible();
  await expect(panel).toContainText("checkout-processor-response-lost@1");
  await expect(panel).toContainText("mvp-response-lost-001");
  await expect(panel).toContainText("drop-first-processor-authorize-response");
  await expect(panel).toContainText("Status: recorded");
  await expect(knowledge).toContainText("No payment row is committed yet");
  await expect(knowledge).not.toContainText("NETWORK_TIMEOUT");
  // Close returns focus to the button that opened the dialog.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(serviceStateButton(page)).toBeFocused();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await openServiceState(page);
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

  // An evidence button closes the dialog, then selects and focuses the record in Recorded history.
  await panel.getByRole("button", { name: "Show Payments timeout", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
  const selected = page.locator("#timeline-rows button[aria-pressed='true']");
  await expect(selected).toContainText("network.request.timedout");
  await expect(selected).toBeFocused();
  await openServiceState(page);
  await panel.getByRole("button", { name: "Show processor authorization", exact: true }).click();
  await expect(selected).toContainText("external.effect.committed");
  await openServiceState(page);
  await panel.getByRole("button", { name: "Show fault selection", exact: true }).click();
  await expect(selected).toContainText("fault.effect.selected");

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
  await inServiceState(page, async () => {
    await expect(knowledge).not.toContainText("NETWORK_TIMEOUT");
    await expect(knowledge).toContainText("No payment row is committed yet");
    await expect(panel).toContainText("Status: recorded");
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await inServiceState(page, async () => {
    await expect(knowledge).toContainText("NETWORK_TIMEOUT");
    await expect(knowledge).toContainText("authorization-1 APPROVED");
  });

  await loadLesson(page, "normal");
  await expect(status).toHaveText("READY");
  await inServiceState(page, async () => {
    await expect(panel).toContainText("checkout-normal@1");
    await expect(panel).toContainText("mvp-normal-001");
    await expect(panel).toContainText("Status: not recorded");
    await expect(panel).toContainText("No fault rule is recorded.");
    await expect(panel).not.toContainText("authorization-1");
    await expect(panel).not.toContainText("NETWORK_TIMEOUT");
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await inServiceState(page, async () => {
    await expect(panel).toContainText("AUTHORIZED");
    await expect(panel).toContainText("authorization-1");
    await expect(panel).toContainText("matches a visible processor authorization");
    await expect(panel).not.toContainText("NETWORK_TIMEOUT");
    await expect(panel).not.toContainText("payment failed");
  });

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".graph-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Payments, Internal service", exact: true }).click();
  await expect(inspector).toContainText("AUTHORIZED");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
