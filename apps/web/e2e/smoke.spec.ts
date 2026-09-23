import { expect, test } from "@playwright/test";

test("checkout fixture loads in a real browser worker and exposes READY projections", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const workerStarted = page.waitForEvent("worker");
  await page.getByRole("button", { name: "Load scenario" }).click();
  const worker = await workerStarted;
  expect(worker.url()).toMatch(/entry-.*\.js$/);
  await expect(page.getByRole("status")).toHaveText("READY");
  const architecture = page.getByRole("region", { name: "Architecture" });
  await expect(architecture.getByRole("listitem")).toHaveCount(5);
  await expect(architecture).toContainText("payment-processor (external)");
  await expect(architecture).toContainText("3 links");
  const execution = page.getByRole("region", { name: "Execution" });
  await expect(execution).toContainText("Pending events");
  await expect(execution.locator("dd").nth(1)).not.toHaveText("0");
  await expect(execution.locator("dd").nth(2)).toHaveText("0");
  await expect(execution.locator("dd").nth(4)).not.toHaveText("0");
  await page.screenshot({ path: testInfo.outputPath("ready.png"), fullPage: true });
  expect(errors).toEqual([]);
});
