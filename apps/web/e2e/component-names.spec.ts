import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { commerceComponentNames } from "../src/component-display.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { viewports } from "./layout-budget.ts";
import { graphLaidOut, loadLesson } from "./support/lesson.ts";
import { closeServiceState, openServiceState } from "./support/service-state.ts";

// #103: packaged lessons name components by display name, never by raw ID; an imported document keeps its IDs.

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-103");
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const narration = (page: Page) => page.locator(".flight-narration");

/** What a packaged lesson's graph shows for each node: the display name, or the ID of a destination. */
function expectedTitles(id: string): ReadonlyMap<string, string> {
  const scenario = packagedMetadata(scenarios.find(choice => choice.id === id)!);
  return new Map([
    ...scenario.architecture.components.map(component => [component.id, commerceComponentNames[component.id] ?? component.id] as const),
    ...scenario.architecture.destinations.map(destination => [destination.id, destination.id] as const),
  ]);
}

interface RenderedGraph {
  readonly nodes: readonly { readonly id: string; readonly title: string; readonly label: string }[];
  readonly resources: readonly { readonly id: string; readonly caption: string; readonly label: string }[];
}

async function renderedGraph(page: Page): Promise<RenderedGraph> {
  return page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>(".react-flow__node.component-node")].map(node => ({
      id: node.dataset.id ?? "", title: node.querySelector(".node-content strong")?.textContent ?? "", label: node.getAttribute("aria-label") ?? "",
    })),
    resources: [...document.querySelectorAll<HTMLElement>(".react-flow__node.resource-node")].map(node => ({
      id: node.dataset.id ?? "", caption: node.querySelector(".resource-title")?.textContent ?? "", label: node.getAttribute("aria-label") ?? "",
    })),
  }));
}

test("#103 every packaged lesson titles each node and names each resource owner by display name", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(viewports["1534x897"]);
  for (const lesson of scenarios) {
    await page.goto("/");
    await loadLesson(page, lesson.id);
    await expect(status(page)).toHaveText("READY");
    await graphLaidOut(page);
    const titles = expectedTitles(lesson.id);
    const graph = await renderedGraph(page);
    expect(graph.nodes.map(node => node.id).sort(), lesson.id).toEqual([...titles.keys()].sort());
    for (const node of graph.nodes) {
      const name = titles.get(node.id)!;
      expect(node.title, `${lesson.id}: ${node.id} title`).toBe(name);
      expect(node.label.startsWith(`${name}, `), `${lesson.id}: ${node.id} accessible name "${node.label}"`).toBe(true);
    }
    for (const resource of graph.resources) {
      const owner = resource.id.replace(/^resource:(db|kv):/, "");
      const caption = `${resource.id.startsWith("resource:db:") ? "Database" : "KeyValueStore"} owned by ${titles.get(owner)}`;
      expect(resource.caption, `${lesson.id}: ${resource.id} caption`).toBe(caption);
      expect(resource.label, `${lesson.id}: ${resource.id} accessible name`).toBe(caption);
    }
  }
});

test("#103 saga-uncompensated: narration, the Component filter, and Service state use names; the inspector keeps the ID", async ({ page }) => {
  await page.setViewportSize(viewports["1534x897"]);
  await page.goto("/");
  await loadLesson(page, "saga-uncompensated");
  await expect(status(page)).toHaveText("READY");
  await graphLaidOut(page);
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  for (const [id, name] of [["client", "Customer App"], ["orders", "Orders"], ["inventory", "Inventory"], ["payments", "Payments"], ["carrier", "Shipping Carrier"]] as const) {
    await expect(node(id).locator(".node-content strong")).toHaveText(name);
  }
  await expect(page.locator('.react-flow__node[data-id="resource:db:orders"] .resource-title')).toHaveText("Database owned by Orders");
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-saga-graph.png") });

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  await page.getByRole("button", { name: "Next movement", exact: true }).click();
  await expect(narration(page)).toContainText("Request sent from Customer App to Orders at virtual time 0. Customer App is waiting on Orders");
  // The trace id is a stored fact and keeps its ID; no sentence names `client` as a component.
  await expect(narration(page)).not.toContainText(/(^|[\s(])client([\s.,)]|$)/);
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-saga-narration.png") });

  // The Component inspector of Orders is headed by the name and keeps the ID as a fact.
  await node("orders").click();
  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await inspector.getByText("Static architecture metadata").click();
  await expect(inspector.locator("dt", { hasText: "Component ID" }).locator("+ dd")).toHaveText("orders");

  // Recorded history's Component filter lists the same names.
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const options = await page.getByLabel("Component", { exact: true }).locator("option").allTextContents();
  for (const name of ["Customer App", "Orders", "Inventory", "Payments", "Shipping Carrier"]) {
    expect(options.some(option => option.startsWith(name)), `Component filter lists ${name}: ${options.join(" | ")}`).toBe(true);
  }
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-saga-history.png") });

  // The Service state dialog's sections are headed by the names.
  const dialog = await openServiceState(page);
  const headings = await dialog.locator(".commerce-state-grid h4").allTextContents();
  expect(headings.sort()).toEqual(["Customer App", "Inventory", "Orders", "Payments", "Shipping Carrier"]);
  await expect(dialog.getByRole("region", { name: "Orders state", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-saga-service-state.png") });
  await closeServiceState(page);
});

test("#103 a session imported from a commerce lesson's starter file shows its component IDs", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "saga-uncompensated");
  await expect(status(page)).toHaveText("READY");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save as scenario file", exact: true }).click()]);
  const text = readFileSync((await download.path())!, "utf8");
  await page.getByLabel("Scenario file", { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text, "utf8") });
  await expect(page.getByLabel("Imported scenario", { exact: true })).toBeVisible();
  await expect(status(page)).toHaveText("READY");
  await graphLaidOut(page);
  const graph = await renderedGraph(page);
  expect(graph.nodes.length).toBeGreaterThan(0);
  for (const node of graph.nodes) {
    expect(node.title, `imported ${node.id} title`).toBe(node.id);
    expect(node.label.startsWith(`${node.id}, `), `imported ${node.id} accessible name`).toBe(true);
  }
  await expect(page.locator('.react-flow__node[data-id="resource:db:orders"] .resource-title')).toHaveText("Database owned by orders");
});

interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** Node boxes, connection-label boxes, and the titles whose text does not fit, in one rendered frame. */
async function overlapFacts(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => ({ id: node.dataset.id ?? "", ...box(node) }));
    const labels = [...document.querySelectorAll(".react-flow__edge-textwrapper")]
      .filter(label => (label.textContent ?? "").trim().length > 0)
      .map(label => ({ text: (label.textContent ?? "").trim(), ...box(label) }));
    const clipped = [...document.querySelectorAll<HTMLElement>(".react-flow__node .node-content strong, .react-flow__node .resource-title")]
      .filter(title => title.scrollWidth > title.clientWidth || (title.textContent ?? "").includes("…") || getComputedStyle(title).textOverflow === "ellipsis")
      .map(title => title.textContent ?? "");
    return { nodes, labels, clipped };
  });
}

/** True when two boxes share more than a hairline; touching edges do not count. */
function intersects(a: Box, b: Box): boolean {
  const slack = 0.5;
  return a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;
}

for (const [name, size] of Object.entries(viewports)) {
  test(`#103 no node overlaps another node or a connection label, and no title is clipped, in every packaged lesson at ${name}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(size);
    for (const lesson of scenarios) {
      await page.goto("/");
      await loadLesson(page, lesson.id);
      await expect(status(page)).toHaveText("READY");
      await graphLaidOut(page);
      // One settled frame: measure until two reads agree.
      let previous = "";
      let facts = await overlapFacts(page);
      await expect.poll(async () => {
        facts = await overlapFacts(page);
        const current = JSON.stringify(facts);
        const settled = current === previous && facts.nodes.length > 0;
        previous = current;
        return settled;
      }, { message: `${lesson.id} graph settles at ${name}`, intervals: [100, 200, 250] }).toBe(true);
      const context = `${lesson.id} at ${name}`;
      const overlaps: string[] = [];
      facts.nodes.forEach((a, index) => facts.nodes.slice(index + 1).forEach(b => { if (intersects(a, b)) overlaps.push(`${a.id} × ${b.id}`); }));
      for (const node of facts.nodes) for (const label of facts.labels) if (intersects(node, label)) overlaps.push(`${node.id} × label "${label.text}"`);
      expect(overlaps, `${context}: overlaps`).toEqual([]);
      expect(facts.clipped, `${context}: clipped titles`).toEqual([]);
    }
  });
}
