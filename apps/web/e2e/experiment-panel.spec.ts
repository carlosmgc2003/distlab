import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const load = async (page: Page, name: string) => {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(name);
  await page.getByRole("button", { name: "Load scenario", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Modify experiment", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Modify experiment" });
  await expect(form).toBeVisible();
  return form;
};
const runToEnd = async (page: Page) => {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
};
const paymentRows = (page: Page) => page.getByRole("region", { name: "payments state", exact: true })
  .locator("div:has(> strong)").filter({ has: page.locator("> strong", { hasText: /^payments$/ }) }).locator("li");

test("retry-unsafe with idempotent payments records one payment, and Restore original brings back two", async ({ page }) => {
  const form = await load(page, "retry-unsafe");
  await expect(page.getByRole("status", { name: "Experiment state" })).toHaveCount(0);
  await form.getByLabel("payments: idempotent").check();
  await form.getByRole("button", { name: "Apply and reload" }).click();
  await expect(page.getByRole("status", { name: "Experiment state" })).toHaveText("Modified");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await runToEnd(page);
  await expect(paymentRows(page)).toHaveCount(1);
  await expect(form).toBeHidden();
  await expect(page.getByRole("tab", { name: "Architecture", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Modify experiment", exact: true }).click();
  await expect(form.getByLabel("payments: idempotent")).toBeChecked();

  await page.screenshot({ path: test.info().outputPath("experiment-panel.png") });
  const axe = await new AxeBuilder({ page }).include(".experiment-dialog").analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("experiment-modified.png") });

  await page.getByRole("button", { name: "Restore original" }).click();
  await expect(page.getByRole("status", { name: "Experiment state" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await runToEnd(page);
  await expect(paymentRows(page)).toHaveCount(2);
});

test("the same seed and edits replay the same history; Reset keeps the modified experiment", async ({ page }) => {
  const form = await load(page, "retry-unsafe");
  await form.getByLabel("Seed").fill("classroom-42");
  await form.getByLabel("Failure rate").fill("0.5");
  await form.getByLabel("Jitter").fill("3");
  await form.getByRole("button", { name: "Add fault" }).click();
  const fault = form.getByRole("group", { name: "Added fault 1" });
  await fault.getByLabel("Effect").selectOption("delay");
  await fault.getByLabel("Where").selectOption("network.request");
  await fault.getByLabel("Delay").fill("4");
  await form.getByRole("button", { name: "Apply and reload" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await runToEnd(page);
  const state = page.getByRole("region", { name: "Commerce lesson state", exact: true });
  const first = await state.innerText();
  const time = await page.getByRole("status", { name: "Simulation status" }).locator("xpath=..").innerText();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(page.getByRole("status", { name: "Experiment state" })).toHaveText("Modified");
  await runToEnd(page);
  expect(await state.innerText()).toBe(first);
  expect(await page.getByRole("status", { name: "Simulation status" }).locator("xpath=..").innerText()).toBe(time);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Recorded history" })).toContainText(/fault/i);
});

test("an invalid value is rejected before it reaches the worker and the session keeps running", async ({ page }) => {
  const form = await load(page, "retry-unsafe");
  await form.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("PAUSED");
  await page.getByRole("button", { name: "Modify experiment", exact: true }).click();
  const timeout = form.getByLabel("Timeout");
  await timeout.fill("0");
  await expect(form.getByRole("alert")).toContainText("timeout must be a whole number greater than 0");
  await expect(timeout).toHaveAttribute("aria-invalid", "true");
  const apply = form.getByRole("button", { name: "Apply and reload" });
  await expect(apply).toHaveAttribute("aria-disabled", "true");
  await apply.click({ force: true });
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("PAUSED");
  await expect(page.getByRole("status", { name: "Experiment state" })).toHaveCount(0);
  await timeout.fill("20");
  await expect(form.getByRole("alert")).toHaveCount(0);
  await form.getByRole("button", { name: "Close" }).click();
  await runToEnd(page);
  await expect(paymentRows(page)).toHaveCount(2);
});
