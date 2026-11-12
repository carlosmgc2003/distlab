import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { graphLaidOut, loadLesson } from "./support/lesson.ts";
import { openExperiment } from "./support/experiment.ts";
import { closeServiceState, openServiceState } from "./support/service-state.ts";
import { openMoreFilters } from "./support/history.ts";

/**
 * The Theme selector: a button at the right end of the workspace navigation row, whose popover offers System, Light, and Dark. `<html data-theme>`
 * holds the resolved theme, the choice survives a reload, and System follows the operating system.
 */

const html = (page: Page) => page.locator("html");
const trigger = (page: Page) => page.getByRole("button", { name: /^Theme: / });
const choices = (page: Page) => page.getByRole("group", { name: "Theme", exact: true });
const pageBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

async function choose(page: Page, name: string) {
  await trigger(page).click();
  await expect(choices(page)).toBeVisible();
  await choices(page).getByRole("radio", { name, exact: true }).click();
  await expect(choices(page)).toBeHidden();
}

test("by default the theme follows the system, live, and System names the theme it resolves to", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(trigger(page)).toHaveAccessibleName("Theme: System (dark)");
  expect(await pageBackground(page)).toBe("rgb(11, 18, 32)");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(trigger(page)).toHaveAccessibleName("Theme: System (light)");
  expect(await pageBackground(page)).toBe("rgb(238, 242, 247)");
});

test("the selector ends the workspace navigation row, both on the welcome screen and beside the tabs, never in the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(trigger(page)).toHaveCount(1);
  await expect(page.locator("header.top-bar").getByRole("button", { name: /^Theme: / })).toHaveCount(0);
  expect((await page.locator("header.top-bar").boundingBox())!.height).toBeLessThanOrEqual(64);
  await choose(page, "Dark");

  await loadLesson(page, "response-lost");
  await expect(trigger(page)).toHaveCount(1);
  const tabs = (await page.getByRole("tablist", { name: "Investigation workspace" }).boundingBox())!;
  const button = (await trigger(page).boundingBox())!;
  expect(button.x).toBeGreaterThan(tabs.x);
  expect(Math.abs((button.y + button.height / 2) - (tabs.y + tabs.height / 2))).toBeLessThanOrEqual(4);
  // The choice is held once for the app, so loading a lesson keeps it.
  await expect(trigger(page)).toHaveAccessibleName("Theme: Dark");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
});

test("the popover offers System, Light, and Dark; a choice applies at once, survives a reload, and System clears it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await trigger(page).click();
  await expect(choices(page).getByRole("radio")).toHaveCount(3);
  await expect(choices(page).getByRole("radio", { name: "System (light)", exact: true })).toBeChecked();
  // Focus starts on the checked choice, and arrow keys change the theme at once.
  await expect(choices(page).getByRole("radio", { name: "System (light)", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("ArrowDown");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(choices(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAccessibleName("Theme: Dark");

  // The pre-paint script applies the stored choice before the app renders.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    (window as unknown as { themeAtParse: string | undefined }).themeAtParse = document.documentElement.dataset.theme;
  }));
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as { themeAtParse: string | undefined }).themeAtParse)).toBe("dark");
  await expect(trigger(page)).toHaveAccessibleName("Theme: Dark");

  await choose(page, "Light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");

  await choose(page, "System (dark)");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("distlab-theme"))).toBeNull();
});

test("the dark theme passes accessibility checks on the lesson surfaces, and the top bar stays one row", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ colorScheme: "dark" });
  const axe = async () => expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/");
  await axe();
  await loadLesson(page, "retry-unsafe");
  await graphLaidOut(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  expect((await page.locator("header.top-bar").boundingBox())!.height).toBeLessThanOrEqual(64);
  await axe();

  await page.locator(".react-flow__node").first().click();
  await page.getByRole("button", { name: "Next movement", exact: true }).click();
  await axe();
  await openServiceState(page);
  await axe();
  await closeServiceState(page);
  await openExperiment(page);
  await axe();

  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  for (const view of ["Story diagram", "Story table", "Learning", "Raw"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await axe();
  }
  await openMoreFilters(page);
  await axe();
  await page.keyboard.press("Escape");
  await trigger(page).click();
  await axe();
});
