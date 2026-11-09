import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { lessonTrigger, loadLesson } from "./support/lesson.ts";
import { filterByType, viewButton } from "./support/history.ts";

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-70");

declare global {
  interface Window {
    workspaceEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
  }
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.workspaceEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.workspaceEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.workspaceEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function latestProjection(page: Page): Promise<RuntimeProjectionSet> {
  return page.evaluate(() => {
    const latest = window.workspaceEvidence.events.filter(event => "projection" in event).at(-1);
    if (!latest || !("projection" in latest)) throw new Error("Missing worker projection");
    return latest.projection;
  });
}

async function pageFits(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollY: window.scrollY,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  expect(metrics.scrollY).toBe(0);
}

async function boxInViewport(page: Page, locator: ReturnType<Page["locator"]>, minVisible = 24) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "missing box").not.toBeNull();
  expect(viewport).not.toBeNull();
  const visibleBottom = Math.min(box!.y + box!.height, viewport!.height);
  const visibleTop = Math.max(box!.y, 0);
  expect(visibleBottom - visibleTop).toBeGreaterThanOrEqual(Math.min(minVisible, box!.height));
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x).toBeLessThan(viewport!.width);
  return box!;
}

async function loadScenario(page: Page, scenario: string) {
  await page.goto("/");
  await loadLesson(page, scenario);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
}

test("desktop baselines expose exactly two investigation tabs with one committed-state summary", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  const viewports = [
    { width: 1366, height: 768 },
    { width: 1534, height: 897 },
  ];
  for (const scenario of ["normal", "response-lost"]) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await loadScenario(page, scenario);
      await pageFits(page);
      // The top bar is one row of at most 64 px (#144).
      const bar = page.locator("header.top-bar");
      expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(64);
      for (const target of [
        lessonTrigger(page),
        page.getByRole("button", { name: "Run", exact: true }),
        page.getByRole("button", { name: "Pause", exact: true }),
        page.getByRole("button", { name: "Step", exact: true }),
        page.getByRole("button", { name: "Reset", exact: true }),
        page.getByRole("status", { name: "Simulation status" }),
        page.locator(".run-summary"),
      ]) await boxInViewport(page, target, 16);
      // Simulation execution is in the top bar; Replay is a separate group inside the Architecture tab.
      await expect(page.getByRole("group", { name: "Simulation execution" })).toBeVisible();
      // The tab set is the desktop-only investigation workspace: exactly two tabs.
      const tablist = page.getByRole("tablist", { name: "Investigation workspace" });
      await expect(tablist).toBeVisible();
      await expect(tablist.getByRole("tab")).toHaveCount(2);
      await expect(page.getByRole("tab", { name: "Architecture", exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Recorded history", exact: true })).toBeVisible();
      // The former narrow/mobile switcher is removed.
      await expect(page.getByRole("navigation", { name: "Investigation panels" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Timeline", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Inspection", exact: true })).toHaveCount(0);
      // Tab semantics: selected state, controls, and panels.
      await expect(page.getByRole("tab", { name: "Architecture" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Architecture" })).toHaveAttribute("aria-controls", "architecture-panel");
      await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "false");
      await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-controls", "history-panel");
      await expect(page.locator("#architecture-panel")).toHaveAttribute("role", "tabpanel");
      await expect(page.locator("#history-panel")).toHaveAttribute("role", "tabpanel");
      // Architecture tab holds the graph and inspector; history holds rows and detail.
      await expect(page.locator(".graph-canvas")).toBeVisible();
      await expect(page.locator("#history-panel")).toBeHidden();
      await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
      await expect(page.locator("#architecture-panel")).toBeHidden();
      await expect(page.getByRole("heading", { name: "Recorded history", exact: true })).toBeVisible();
      // History is a first-class canvas: the Story view renders without transport controls,
      // and the observation detail appears only after a record is selected.
      await expect(page.locator(".story-view")).toBeVisible();
      await expect(page.getByRole("group", { name: "Replay recorded movements" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Architecture", exact: true }).click();
      await expect(page.locator(".graph-canvas")).toBeVisible();
      // Engine counters stay collapsed in the Lesson panel; the summary and both control groups stay out of it.
      await expect(page.locator(".lesson-panel details.advanced-diagnostics")).not.toHaveAttribute("open", "");
      await expect(page.getByRole("region", { name: "Distributed state" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      await page.locator("#timeline-rows button").first().click();
      const detail = page.locator("#inspection-panel");
      await expect(detail).not.toContainText("Select an observation to inspect");
      // Summary-first: event summary before effect, related evidence, and technical record.
      const detailText = await detail.textContent() ?? "";
      const effectAt = detailText.indexOf("Effect and evidence");
      const relatedAt = detailText.indexOf("Related evidence");
      const technicalAt = detailText.indexOf("Technical record");
      expect(effectAt).toBeGreaterThanOrEqual(0);
      expect(relatedAt).toBeGreaterThan(effectAt);
      expect(technicalAt).toBeGreaterThan(relatedAt);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
      const summary = page.locator(".run-summary");
      await expect(summary).toContainText("COMPLETED");
      await expect(summary).toContainText("Virtual time");
      await expect(summary).toContainText("Processed events");
      await expect(summary).toContainText("Pending events");
      await expect(page.getByText("Latest committed simulation state")).toHaveCount(0);
      await expect(page.getByText("Run complete")).toHaveCount(0);
      await expect(page.getByText("Execution completed. Reset to run this scenario again.")).toHaveCount(0);
      await expect(page.locator(".lesson-panel details.advanced-diagnostics > summary")).toHaveText("Advanced diagnostics");
      await pageFits(page);
      await page.getByRole("tab", { name: "Architecture", exact: true }).click();
      await boxInViewport(page, page.locator(".graph-canvas"), 80);
      await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
      await boxInViewport(page, page.locator("#timeline-rows"), 80);
      await boxInViewport(page, summary, 16);
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.width}x${viewport.height}-${scenario}.png`) });
    }
  }
});

test("switching tabs preserves investigation state, moves focus, and sends no worker commands", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadScenario(page, "normal");
  const before = await latestProjection(page);
  const commands = () => page.evaluate(() => window.workspaceEvidence.commands.map(command => command.type));
  const beforeCommands = await commands();
  // Start on the Recorded history tab; this test reads canonical rows.
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(page.locator("#history-panel")).toBeFocused();
  await viewButton(page, "Raw").click();
  await filterByType(page, "simulation.created");
  const activeFilters = page.getByRole("list", { name: "Active filters", exact: true });
  await page.locator("#timeline-rows button").first().click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("simulation.created");
  const selected = await page.locator("#timeline-rows button[aria-pressed='true']").getAttribute("data-observation-id");
  // Desktop tabs keep both panels mounted; the inactive panel is hidden, not unmounted.
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#architecture-panel")).toBeFocused();
  await expect(page.locator(".graph-canvas")).toBeVisible();
  await expect(page.locator("#history-panel")).toBeHidden();
  const orders = page.getByRole("button", { name: "Orders, Internal service", exact: true });
  await orders.click();
  await expect(orders).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeVisible();
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(page.locator("#history-panel")).toBeFocused();
  await expect(activeFilters).toContainText("simulation.created");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toHaveAttribute("data-observation-id", selected!);
  await expect(page.locator("#inspection-panel")).toContainText("simulation.created");
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(orders).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeVisible();
  expect(await latestProjection(page)).toEqual(before);
  expect(await commands()).toEqual(beforeCommands);

  // Tabs are keyboard operable with a clear active state.
  await page.getByRole("tab", { name: "Architecture", exact: true }).focus();
  await expect(page.getByRole("tab", { name: "Architecture" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Recorded history" })).toBeFocused();
  await expect(page.locator("#timeline-rows")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Architecture" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Architecture" })).toBeFocused();
  expect(await commands()).toEqual(beforeCommands);

  // Evidence links activate the history tab, select the record, and focus the row.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  const afterRunCommands = await commands();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  // The evidence links sit in the Lesson panel's ③ Investigate section, with nothing to open first.
  await page.getByRole("complementary", { name: "Lesson", exact: true }).locator(".execution-overview")
    .getByRole("button", { name: "Show processor authorization", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("external.effect.committed");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toBeFocused();
  await expect(page.locator("#inspection-panel")).toContainText("external.effect.committed");
  expect(await commands()).toEqual(afterRunCommands);

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  // Reset replaces the session, so the view returns to Story with cleared filters.
  await expect(activeFilters).toHaveCount(0);
  await expect(page.locator("#timeline-rows button[data-observation-id][aria-pressed='true']")).toHaveCount(0);
  await filterByType(page, "simulation.created");
  await viewButton(page, "Raw").click();
  await page.locator("#timeline-rows button").first().click();
  await loadLesson(page, "response-lost");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(activeFilters).toHaveCount(0);
  await expect(page.locator("#timeline-rows button[data-observation-id][aria-pressed='true']")).toHaveCount(0);
  expect(await commands()).toEqual([...afterRunCommands, "reset", "load"]);
});

test("observation detail gives each teaching event a plain-language summary-first record", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadScenario(page, "response-lost");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  const beforeCommands = await page.evaluate(() => window.workspaceEvidence.commands.map(command => command.type));
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Raw").click();
  const cases: { type: string; heading: string }[] = [
    { type: "network.request.sent", heading: "Request sent" },
    { type: "database.transaction.committed", heading: "Database transaction committed" },
    { type: "fault.effect.selected", heading: "Fault effect selected" },
    { type: "network.response.dropped", heading: "Response dropped" },
    { type: "network.request.timedout", heading: "Request timed out" },
    { type: "external.effect.committed", heading: "External side effect committed" },
  ];
  for (const item of cases) {
    await filterByType(page, item.type);
    await page.locator("#timeline-rows button").first().click();
    const relatedEvidence = page.locator("#inspection-panel details.detail-disclosure").nth(1);
    if ((await relatedEvidence.getAttribute("open")) === null) await relatedEvidence.locator("> summary").click();
    const detail = page.locator("#inspection-panel");
    await expect(detail.getByRole("heading", { name: item.heading })).toBeVisible();
    await expect(detail).toContainText("Sequence");
    await expect(detail).toContainText("Virtual time");
    await expect(detail).toContainText("Payload");
    // Before/after evidence is prioritized when present and explicitly absent otherwise.
    const hasEvidence = await detail.locator(".change-evidence").count();
    if (hasEvidence > 0) {
      await expect(detail).toContainText("Before");
      await expect(detail).toContainText("After");
    } else {
      await expect(detail).toContainText("No before or after values were stored.");
    }
    await expect(detail.getByRole("heading", { name: "Causation" })).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Trace" })).toBeVisible();
    await expect(detail.getByText("Technical record", { exact: true })).toBeVisible();
    await expect(detail).toContainText("Copy observation id");
  }
  // Canonical IDs and JSON stay in the technical section; redaction is never reconstructed.
  await filterByType(page, "network.response.dropped");
  await page.locator("#timeline-rows button").first().click();
  const dropped = page.locator("#inspection-panel");
  await expect(dropped.getByRole("heading", { name: "Response dropped" })).toBeVisible();
  await expect(dropped).toContainText("Show this trace");
  await expect(dropped).toContainText("Copy trace id");
  expect(await page.evaluate(() => window.workspaceEvidence.commands.map(command => command.type))).toEqual(beforeCommands);
});

test("desktop 200% zoom keeps tabs and controls keyboard reachable without horizontal overflow", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceDir, { recursive: true });
  const viewports = [
    { width: 683, height: 384, name: "zoom-200-of-1366x768" },
    { width: 767, height: 449, name: "zoom-200-of-1534x897" },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadScenario(page, "response-lost");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      shellScrollWidth: document.querySelector(".app-shell")?.scrollWidth ?? 0,
      shellClientWidth: document.querySelector(".app-shell")?.clientWidth ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.shellScrollWidth).toBeLessThanOrEqual(overflow.shellClientWidth + 1);
    // No mobile information architecture is introduced at zoom.
    await expect(page.getByRole("navigation", { name: "Investigation panels" })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Investigation workspace" })).toBeVisible();
    const controls = page.locator(".command-toolbar button, .command-toolbar select, .command-toolbar summary, [role='tab']");
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      const size = page.viewportSize()!;
      expect(box, await control.innerText()).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
    // Focus already returned to the trigger after the lesson was chosen, so focus() alone would not
    // scroll it back into view after the loop above; start the traversal with it on screen.
    await lessonTrigger(page).scrollIntoViewIfNeeded();
    await lessonTrigger(page).focus();
    const seen = new Set<string>();
    for (let step = 0; step < 24; step += 1) {
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        const box = element?.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const name = (element?.textContent || element?.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const inToolbar = element instanceof Element && (element.closest(".command-toolbar") !== null || element.closest(".workspace-tabs") !== null);
        const outside = inToolbar && (!box || box.width === 0 || box.left < -1 || box.right > width + 1 || box.top < -1 || box.bottom > height + 1);
        return { name, outside };
      });
      expect(focused.outside, focused.name).toBe(false);
      seen.add(focused.name);
      await page.keyboard.press("Tab");
    }
    for (const label of ["Lesson: ", "Run", "Pause", "Step", "Reset", "Architecture", "Hide lesson"]) {
      expect([...seen].some(item => item.includes(label)), `${label} at ${viewport.name}`).toBe(true);
    }
    // Roving tabindex: Tab reaches the active tab; arrows reach the other tab.
    await page.getByRole("tab", { name: "Architecture", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Recorded history" })).toBeFocused();
    await page.getByRole("tab", { name: "Recorded history", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#timeline-rows")).toBeVisible();
    await expect(page.locator(".story-view")).toBeVisible();
    await page.getByRole("tab", { name: "Architecture", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".graph-canvas")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-response-lost.png`) });
  }
});
