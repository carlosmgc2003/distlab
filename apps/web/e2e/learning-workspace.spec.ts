import { expect, test } from "./support/test.ts";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { loadLesson } from "./support/lesson.ts";
import { viewButton } from "./support/history.ts";

for (const scenario of ["normal", "response-lost"]) for (const width of [1366, 768, 390]) {
  test(`learning workspace discloses tools without losing context for ${scenario} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/");
    await loadLesson(page, scenario);
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
    await expect(page.getByRole("complementary", { name: "Lesson", exact: true })).toBeVisible();
    // Engine counters stay behind the Lesson panel's one disclosure.
    await expect(page.getByLabel("Engine counters", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
    await page.getByRole("tab", { name: "Recorded history" }).click();
    await expect(page.locator(".timeline-transport-row")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play replay", exact: true })).toHaveCount(0);
    // No disclosure in the history toolbar: one view switch and one filter row (#145).
    await expect(page.locator(".timeline-panel details")).toHaveCount(0);
    await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".story-table")).toHaveCount(0);
    // The detail is docked, never floating, and starts empty (#146).
    await expect(page.locator(".story-inspector")).toHaveCount(0);
    await expect(page.locator("#inspection-panel")).toContainText("Select an observation to see its detail.");
    if (width === 1366) {
      expect(await page.locator(".story-strip").evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      const diagram = await page.locator(".story-strip").boundingBox();
      expect(diagram!.height).toBeGreaterThan(384);
    }
    await page.locator(".story-milestone").first().click();
    await expect(page.locator(".event-path")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy observation id", exact: true })).not.toBeVisible();
    await page.getByText("Technical record", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy observation id", exact: true })).toBeVisible();
    await page.getByLabel("Component", { exact: true }).selectOption("payments");
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("payments");
    await expect(page.getByLabel("Component", { exact: true })).toHaveValue("payments");
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await page.getByLabel("Show", { exact: true }).selectOption("requests-and-responses");
    await expect(page.getByRole("group", { name: "Active filters and reset" })).toBeVisible();
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.getByRole("group", { name: "Active filters and reset" })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 1366) {
      const rows = await page.locator("#timeline-rows").boundingBox();
      expect(rows!.height).toBeGreaterThan(384);
      // The rows fill the workspace column beside the Lesson panel (#140), less the docked detail (#146).
      const column = await page.locator(".workspace-main").boundingBox();
      const detail = await page.locator("#inspection-panel").boundingBox();
      expect(detail!.x).toBeGreaterThanOrEqual(rows!.x + rows!.width);
      expect(rows!.width).toBeGreaterThan(column!.width - detail!.width - 60);
      const filters = await page.locator(".story-filter-bar").boundingBox();
      expect(filters!.y + filters!.height).toBeLessThan(rows!.y);
      await viewButton(page, "Story table").click();
      await expect(page.locator(".story-table")).toBeVisible();
      await expect(page.locator(".story-strip")).toHaveCount(0);
      await viewButton(page, "Story diagram").click();
      await expect(page.locator(".story-milestone[aria-pressed=true]")).toHaveCount(1);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);
    }
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  });
}

// #140: the Lesson panel holds the lesson guidance in four numbered sections.
const lessonPanel = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });

test("after response-lost completes, the guide and every evidence link are readable in the Lesson panel without opening anything", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await loadLesson(page, "response-lost");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  const panel = lessonPanel(page);
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText([/^① Goal/, /^② Run/, /^③ Investigate/, /^④ Experiment/]);

  // The toolbar no longer carries lesson guidance.
  const header = page.locator("header.command-toolbar");
  for (const text of ["Lesson guide", "Run overview", "Advanced diagnostics"]) await expect(header).not.toContainText(text);
  await expect(page.locator("details.lesson-drawer")).toHaveCount(0);
  await expect(page.locator(".learning-prompt")).toHaveCount(0);

  // No disclosure wraps the guide text or the run overview; only Advanced diagnostics stays one.
  const investigate = panel.getByRole("region", { name: "③ Investigate" });
  const guide = investigate.getByText("For the response-lost experiment, find the processor authorization", { exact: false });
  const overview = investigate.locator(".execution-overview");
  for (const target of [guide, overview]) expect(await target.evaluate(element => element.closest("details") === null)).toBe(true);
  expect(await panel.locator("details").evaluateAll(elements => elements.every(element => element.closest("details.advanced-diagnostics") !== null))).toBe(true);

  // The question and the evidence links are readable after scrolling only the Lesson panel.
  await expect(investigate).toContainText("Does the timeout prove that payment failed?");
  // The overview also holds ③ Investigate's one hint (#147); the links are the evidence buttons.
  await expect(overview.locator(".evidence-links").getByRole("button")).toHaveCount(7);
  const link = overview.getByRole("button", { name: "Show dropped processor response", exact: true });
  expect(await link.evaluate(element => element.closest("details") === null)).toBe(true);
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
  expect(await page.locator(".lesson-panel-body").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
});

for (const lesson of ["normal", "retry-unsafe"]) {
  test(`the current-step marker is on Run after loading ${lesson} and on Investigate after the run completes`, async ({ page }) => {
    await page.goto("/");
    await loadLesson(page, lesson);
    await expect(status(page)).toHaveText("READY");
    const current = lessonPanel(page).locator("[aria-current='step']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName("② Run");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status(page)).toHaveText("COMPLETED");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName("③ Investigate");
    // Emphasis only: every section stays readable whichever step is current.
    for (const name of ["① Goal", "② Run", "③ Investigate", "④ Experiment"]) {
      await expect(lessonPanel(page).getByRole("region", { name, exact: true })).toBeVisible();
    }
  });
}

test("the collapsed Lesson panel survives a tab switch and a new lesson load and keeps a focusable Show lesson control", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "normal");
  await expect(status(page)).toHaveText("READY");
  const panel = lessonPanel(page);
  const hide = panel.getByRole("button", { name: "Hide lesson", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  const show = panel.getByRole("button", { name: "Show lesson", exact: true });
  await expect(show).toBeVisible();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("region", { name: "① Goal", exact: true })).toBeHidden();
  expect((await new AxeBuilder({ page }).include(".lesson-panel").analyze()).violations).toEqual([]);

  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(show).toBeVisible();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await loadLesson(page, "saga-uncompensated");
  await expect(status(page)).toHaveText("READY");
  await expect(show).toBeVisible();
  await expect(panel.getByRole("region", { name: "① Goal", exact: true })).toBeHidden();

  await show.focus();
  await expect(show).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "Hide lesson", exact: true })).toBeFocused();
  await expect(panel.getByRole("region", { name: "① Goal", exact: true })).toContainText("Saga: no compensation");
});

test("the Lesson panel stays beside Recorded history", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "response-lost");
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(lessonPanel(page)).toBeVisible();
  await expect(lessonPanel(page).getByRole("status", { name: "Lesson state" })).toHaveText("Lesson ready: Lost processor response.");
});
