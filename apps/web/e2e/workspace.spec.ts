import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-45");

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
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
}

test("desktop baselines keep controls, architecture, and timeline in one viewport", async ({ page }) => {
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
      const rows = page.locator(".toolbar-row");
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const box = await row.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(56);
      }
      for (const target of [
        page.getByLabel("Scenario", { exact: true }),
        page.getByRole("button", { name: "Run", exact: true }),
        page.getByRole("button", { name: "Pause", exact: true }),
        page.getByRole("button", { name: "Step", exact: true }),
        page.getByRole("button", { name: "Reset", exact: true }),
        page.getByRole("status", { name: "Simulation status" }),
        page.locator(".virtual-time"),
        page.getByRole("button", { name: "Architecture", exact: true }),
        page.getByRole("button", { name: "Timeline", exact: true }),
        page.getByRole("button", { name: "Inspection", exact: true }),
      ]) await boxInViewport(page, target, 16);
      const graph = await boxInViewport(page, page.locator(".graph-canvas"), 120);
      const timeline = await boxInViewport(page, page.locator("#timeline-rows"), 80);
      expect(graph.y).toBeLessThan(viewport.height);
      expect(timeline.height).toBeGreaterThanOrEqual(88);
      await expect(page.locator(".lesson-guide details")).not.toHaveAttribute("open", "");
      await expect(page.locator("details.raw-state")).not.toHaveAttribute("open", "");
      await expect(page.getByRole("region", { name: "Distributed state" })).toHaveCount(0);
      await page.locator("#timeline-rows button").first().click();
      const detail = page.getByRole("region", { name: "Observation detail" });
      await expect(detail).not.toContainText("Select an observation to inspect");
      const detailBox = await boxInViewport(page, detail, 80);
      const rawBox = await page.locator("details.raw-state").boundingBox();
      expect(detailBox.y).toBeGreaterThan((rawBox?.y ?? 0) + (rawBox?.height ?? 0) - 1);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
      await pageFits(page);
      await boxInViewport(page, page.locator(".graph-canvas"), 80);
      await boxInViewport(page, page.locator("#timeline-rows"), 80);
      await boxInViewport(page, page.locator(".virtual-time"), 16);
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.width}x${viewport.height}-${scenario}.png`) });
    }
  }
});

test("selection and filters survive panel changes and reset or session replacement clears them", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadScenario(page, "normal");
  const before = await latestProjection(page);
  const commands = () => page.evaluate(() => window.workspaceEvidence.commands.map(command => command.type));
  const beforeCommands = await commands();
  await page.getByLabel("Type", { exact: true }).fill("simulation.created");
  await page.locator("#timeline-rows button").first().click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("simulation.created");
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Inspection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("simulation.created");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("simulation.created");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("simulation.created");
  expect(await latestProjection(page)).toEqual(before);
  expect(await commands()).toEqual(beforeCommands);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".graph-canvas")).toBeVisible();
  await expect(page.locator("#timeline-rows")).toBeHidden();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("simulation.created");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("simulation.created");
  await page.getByRole("button", { name: "Inspection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("simulation.created");
  expect(await commands()).toEqual(beforeCommands);

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toHaveCount(0);
  await page.getByLabel("Type", { exact: true }).fill("simulation.created");
  await page.locator("#timeline-rows button").first().click();
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toHaveCount(0);
  expect(await commands()).toEqual([...beforeCommands, "reset", "load"]);
});

test("390×844 and 200% zoom keep controls keyboard reachable without overflow", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceDir, { recursive: true });
  const viewports = [
    { width: 390, height: 844, name: "390x844" },
    { width: 683, height: 384, name: "zoom-200-of-1366x768" },
    { width: 195, height: 422, name: "zoom-200-of-390x844" },
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
    const controls = page.locator(".command-toolbar button, .command-toolbar select, .command-toolbar summary");
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      const size = page.viewportSize()!;
      expect(box, await control.innerText()).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
    await page.getByLabel("Scenario", { exact: true }).focus();
    const seen = new Set<string>();
    for (let step = 0; step < 20; step += 1) {
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        const box = element?.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const name = (element?.textContent || element?.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const inToolbar = element instanceof Element && element.closest(".command-toolbar") !== null;
        const outside = inToolbar && (!box || box.width === 0 || box.left < -1 || box.right > width + 1 || box.top < -1 || box.bottom > height + 1);
        return { name, outside };
      });
      expect(focused.outside, focused.name).toBe(false);
      seen.add(focused.name);
      await page.keyboard.press("Tab");
    }
    for (const label of ["Load scenario", "Run", "Pause", "Step", "Reset", "Architecture", "Timeline", "Inspection", "Lesson guide"]) {
      expect([...seen].some(item => item.includes(label)), `${label} at ${viewport.name}`).toBe(true);
    }
    await page.getByRole("button", { name: "Timeline", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#timeline-rows")).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await page.getByRole("button", { name: "Inspection", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Observation detail" })).toBeVisible();
    await page.getByRole("button", { name: "Architecture", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".graph-canvas")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-response-lost.png`) });
  }
});
