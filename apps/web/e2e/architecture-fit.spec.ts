import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-63");

interface GraphFit {
  readonly width: number;
  readonly height: number;
  readonly transform: string;
  readonly nodes: { readonly id: string; readonly label: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }[];
  readonly labels: readonly { readonly text: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }[];
  readonly clipped: readonly string[];
}

/** Measures the rendered graph against its own canvas: no viewport transform or grid assumption is trusted. */
async function graphFit(page: Page): Promise<GraphFit> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".graph-canvas")!.getBoundingClientRect();
    const relative = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: +(rect.left - canvas.left).toFixed(1), top: +(rect.top - canvas.top).toFixed(1),
        right: +(rect.right - canvas.left).toFixed(1), bottom: +(rect.bottom - canvas.top).toFixed(1),
      };
    };
    const nodes = [...document.querySelectorAll(".react-flow__node")].map(node => ({
      id: node.getAttribute("data-id") ?? "",
      label: (node.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim(),
      ...relative(node),
    }));
    const labels = [...document.querySelectorAll(".react-flow__edge-textwrapper, .react-flow__edgelabel-renderer")]
      .map(label => ({ text: (label.textContent ?? "").trim(), ...relative(label) }))
      .filter(label => label.text.length > 0);
    const outside = (part: { left: number; top: number; right: number; bottom: number }, name: string) => {
      if (part.left < 0 || part.top < 0 || part.right > canvas.width + 0.5 || part.bottom > canvas.height + 0.5) {
        clipped.push(`${name} [${part.left},${part.top} → ${part.right},${part.bottom}]`);
      }
    };
    const clipped: string[] = [];
    for (const node of nodes) outside(node, `node ${node.id}`);
    for (const label of labels) outside(label, `label ${label.text}`);
    return {
      width: +canvas.width.toFixed(1), height: +canvas.height.toFixed(1),
      transform: document.querySelector(".react-flow__viewport")?.getAttribute("style") ?? "",
      nodes, labels, clipped,
    };
  });
}

async function expectGraphFits(page: Page, context: string) {
  await expect.poll(async () => (await graphFit(page)).clipped, { message: `graph fits the canvas at ${context}` }).toEqual([]);
  const fit = await graphFit(page);
  const label = `graph fits the canvas at ${context} (canvas ${fit.width}×${fit.height})`;
  expect(fit.nodes, label).toHaveLength(5);
  for (const node of fit.nodes) {
    expect(node.label, `${label}: ${node.id} keeps a readable name`).not.toBe("");
    // Comfortable padding means the graph is not flush against the canvas edge.
    expect(node.left, `${label}: ${node.id} left padding`).toBeGreaterThan(1);
    expect(node.top, `${label}: ${node.id} top padding`).toBeGreaterThan(1);
    expect(fit.width - node.right, `${label}: ${node.id} right padding`).toBeGreaterThan(1);
    expect(fit.height - node.bottom, `${label}: ${node.id} bottom padding`).toBeGreaterThan(1);
  }
  expect(fit.labels.length, `${label}: connection labels`).toBeGreaterThanOrEqual(4);
  return fit;
}

async function expectFittedDefault(page: Page, context: string, transform: string) {
  await expectGraphFits(page, context);
  await expect.poll(async () => (await graphFit(page)).transform, { message: `default fit restored at ${context}` }).toBe(transform);
}

async function loadScenario(page: Page, scenario: string) {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
}

test("the default view shows the whole checkout graph at desktop and narrow viewports", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  const viewports = [
    { name: "1534x897", width: 1534, height: 897 },
    { name: "1366x768", width: 1366, height: 768 },
    { name: "1024x768", width: 1024, height: 768 },
    { name: "390x844", width: 390, height: 844 },
  ];
  for (const scenario of ["normal", "response-lost"]) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loadScenario(page, scenario);
      await expectGraphFits(page, `${viewport.name} ${scenario}`);
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-${scenario}.png`) });
    }
  }
});

test("the inspector, panel switches, and window resizes refit the graph", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1534, height: 897 });
  await loadScenario(page, "normal");
  const defaultView = await expectGraphFits(page, "1534x897 default");

  // The two-column workspace narrows the canvas when a component is inspected.
  const payments = page.getByRole("button", { name: "Payments, Internal service", exact: true });
  await payments.focus();
  await payments.press("Enter");
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeVisible();
  await expectGraphFits(page, "1534x897 with the inspector open");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-inspector-open.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toHaveCount(0);
  await expectFittedDefault(page, "1534x897 after closing the inspector", defaultView.transform);

  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 1534, height: 897 }]) {
    await page.setViewportSize(size);
    await expectGraphFits(page, `${size.width}x${size.height} after resizing`);
  }

  // Keyboard users reach the same fit: the pan buttons move the view, the fit button restores it.
  await page.getByRole("button", { name: "Pan right", exact: true }).click();
  await page.getByRole("button", { name: "Zoom In", exact: true }).click();
  const panned = await graphFit(page);
  expect(panned.clipped.length, "a panned and zoomed view may leave the canvas").toBeGreaterThan(0);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const fitted = await expectGraphFits(page, "1534x897 after the Fit View control");
  expect(fitted.transform).toBe(defaultView.transform);

  // A narrow viewport shows one panel at a time; each panel switch refits the graph.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expectGraphFits(page, "390x844 architecture panel");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".graph-canvas")).toBeHidden();
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expectGraphFits(page, "390x844 after returning to the architecture panel");
  await page.screenshot({ path: path.join(evidenceDir, "390x844-after-panel-switch.png") });
});

test("Reset and a new scenario return to the fitted default view", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1534, height: 897 });
  await loadScenario(page, "normal");
  const defaultView = await expectGraphFits(page, "1534x897 default");

  for (const direction of ["right", "down", "left", "up"]) {
    await page.getByRole("button", { name: `Pan ${direction}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "Zoom In", exact: true }).click();
  expect((await graphFit(page)).transform).not.toBe(defaultView.transform);

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expectFittedDefault(page, "1534x897 after Reset", defaultView.transform);

  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expectFittedDefault(page, "1534x897 after loading the other scenario", defaultView.transform);
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-after-reset.png") });
});
