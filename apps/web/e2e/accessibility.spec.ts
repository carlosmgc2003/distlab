import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("architecture and each inspector pass accessibility checks at the desktop baseline and 200% zoom", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Load scenario" }).click();
  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(5);
  for (const size of [{ width: 1366, height: 768 }, { width: 683, height: 384 }]) {
    const width = size.width;
    await page.setViewportSize(size);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    for (const node of await nodes.all()) {
      await node.focus();
      await node.press("Enter");
      await expect(node).toHaveAttribute("aria-pressed", "true");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
});
