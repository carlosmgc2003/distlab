import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const scenario of ["normal", "response-lost"]) for (const width of [1366, 768, 390]) {
  test(`learning workspace discloses tools without losing context for ${scenario} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/");
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await page.getByRole("button", { name: "Load scenario" }).click();
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
    await expect(page.getByLabel("Learning objective")).toBeVisible();
    await expect(page.getByText("Advanced diagnostics", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
    await page.getByRole("tab", { name: "Recorded history" }).click();
    await expect(page.locator(".timeline-transport-row")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play timeline", exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Quick views", exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Story", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".story-table")).toHaveCount(0);
    await expect(page.locator(".story-inspector")).toHaveCount(0);
    if (width === 1366) {
      expect(await page.locator(".story-strip").evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      const diagram = await page.locator(".story-strip").boundingBox();
      expect(diagram!.height).toBeGreaterThan(384);
    }
    await page.locator(".story-milestone").first().click();
    await page.locator(".story-inspector > summary").click();
    await expect(page.locator(".event-path")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy observation id", exact: true })).not.toBeVisible();
    await page.getByText("Technical record", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy observation id", exact: true })).toBeVisible();
    await page.locator(".story-inspector > summary").click();
    await page.locator(".history-filter-drawer > summary").click();
    await page.locator(".timeline-filter-disclosure > summary").click();
    await page.getByLabel("Filter by", { exact: true }).selectOption("component");
    await page.getByRole("combobox", { name: "Component", exact: true }).fill("payments");
    await page.getByLabel("Filter by", { exact: true }).selectOption("type");
    await expect(page.getByRole("combobox", { name: "Component", exact: true })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("payments");
    await page.getByLabel("Filter by", { exact: true }).selectOption("component");
    await expect(page.getByRole("combobox", { name: "Component", exact: true })).toHaveValue("payments");
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await page.getByRole("button", { name: /^Requests & responses/ }).click();
    await page.locator(".history-filter-drawer > summary").click();
    await expect(page.getByRole("group", { name: "Active filters and reset" })).toBeVisible();
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.getByRole("group", { name: "Active filters and reset" })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 1366) {
      const rows = await page.locator("#timeline-rows").boundingBox();
      expect(rows!.height).toBeGreaterThan(384);
      expect(rows!.width).toBeGreaterThan(1200);
      const filters = await page.locator(".story-filter-bar").boundingBox();
      expect(filters!.y + filters!.height).toBeLessThan(rows!.y);
      await page.getByRole("button", { name: "Table", exact: true }).click();
      await expect(page.locator(".story-table")).toBeVisible();
      await expect(page.locator(".story-strip")).toHaveCount(0);
      await page.getByRole("button", { name: "Diagram", exact: true }).click();
      await expect(page.locator(".story-milestone[aria-pressed=true]")).toHaveCount(1);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
    }
    await page.getByRole("button", { name: "Show simulation controls" }).click();
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  });
}
