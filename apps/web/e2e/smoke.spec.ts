import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

declare global {
  interface Window {
    workerEvidence: { commands: WorkerCommand[]; events: WorkerEvent[]; probeHistory: () => void };
  }
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.workerEvidence = { commands: [], events: [], probeHistory: () => {} };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.workerEvidence.events.push(structuredClone(event.data)));
        // Test-only history read: a boundary pause after UI interaction. Not exposed by the app.
        window.workerEvidence.probeHistory = () => super.postMessage({ version: 1, type: "pause", requestId: "e2e-history-probe" });
      }
      override postMessage(message: WorkerCommand) {
        window.workerEvidence.commands.push(structuredClone(message));
        super.postMessage(message);
      }
    };
  });
}

const components = [
  { name: "Customer App", category: "Client", id: "customer-app", resource: "Model-owned checkout request and outcome" },
  { name: "Orders", category: "Internal service", id: "orders", resource: "Database owned by orders: orders, outbox" },
  { name: "MessageBus · OrderCreated", category: "Infrastructure", id: "OrderCreated", resource: "MessageBus topic: OrderCreated" },
  { name: "Payments", category: "Internal service", id: "payments", resource: "Database owned by payments: payments, inbox" },
  { name: "Payment Processor", category: "External service", id: "payment-processor", resource: "Model-owned provider authorization ledger" },
] as const;

for (const scenario of ["normal", "response-lost"]) {
  test(`${scenario} checkout supports read-only graph inspection and leaves worker history unchanged`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await observeWorker(page);
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Choose a scenario to begin.");
    await page.getByLabel("Scenario").selectOption(scenario);
    const started = page.waitForEvent("worker");
    await page.getByRole("button", { name: "Load scenario" }).click();
    expect((await started).url()).toMatch(/entry-.*\.js$/);
    await expect(page.getByRole("status").filter({ hasText: "READY" })).toBeVisible();
    const architecture = page.getByRole("region", { name: "Architecture", exact: true });
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toContainText("Select a component");
    await expect(architecture.locator(".react-flow__node")).toHaveCount(5);
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(4);
    await expect(architecture).toContainText("Solid arrow: request link");
    await expect(architecture).toContainText("Dotted arrow: MessageBus publication");
    await expect(architecture).toContainText("Dashed arrow: MessageBus subscription");
    const before = await page.evaluate(() => window.workerEvidence.events.find(event => event.type === "loaded"));
    expect(before?.type).toBe("loaded");
    const execution = await page.getByRole("region", { name: "Execution" }).innerText();
    for (const component of components) {
      const node = page.getByRole("button", { name: `${component.name}, ${component.category}`, exact: true });
      await expect(node).toContainText(component.category);
      await node.click();
      await expect(node).toHaveAttribute("aria-pressed", "true");
      await expect(node).toHaveCSS("outline-style", "solid");
      await expect(inspector.getByRole("heading", { name: component.name, exact: true })).toBeVisible();
      await expect(inspector).toContainText(component.resource);
      await expect(inspector).toContainText(component.id === "OrderCreated" ? "Not declared" : `distlab.${component.id}`);
      if (component.id !== "OrderCreated") await expect(inspector).toContainText("1.0.0");
      await node.focus();
      await node.press("Escape");
      await expect(inspector).toContainText("Select a component");
      await expect(node).toBeFocused();
      await node.press("Enter");
      await expect(node).toBeFocused();
      await expect(node).toHaveAttribute("aria-pressed", "true");
      await expect(node).toHaveCSS("outline-style", "solid");
      await expect(inspector).toContainText(component.resource);
      const position = await node.getAttribute("style");
      await node.press("ArrowRight");
      await node.press("Delete");
      await expect(node).toHaveAttribute("style", position!);
    }
    const orders = page.getByRole("button", { name: "Orders, Internal service", exact: true });
    await orders.focus();
    await orders.press("Space");
    await expect(orders).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Payment Processor, External service", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Zoom In", exact: true }).click();
    await page.getByRole("button", { name: "Zoom Out", exact: true }).click();
    const pane = architecture.locator(".react-flow__pane");
    const viewport = architecture.locator(".react-flow__viewport");
    const transform = await viewport.getAttribute("style");
    await pane.scrollIntoViewIfNeeded();
    const bounds = (await pane.boundingBox())!;
    await page.mouse.move(bounds.x + 25, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + 75, bounds.y + bounds.height / 2 + 30, { steps: 8 }); await page.mouse.up();
    await expect(viewport).not.toHaveAttribute("style", transform!);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    // A picker change must not replace the metadata belonging to the loaded graph.
    await page.getByLabel("Scenario").selectOption(scenario === "normal" ? "response-lost" : "normal");
    await orders.click();
    await expect(inspector).toContainText("Database owned by orders: orders, outbox");
    expect(await page.getByRole("region", { name: "Execution" }).innerText()).toBe(execution);
    expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(["load"]);
    await page.evaluate(() => window.workerEvidence.probeHistory());
    await expect.poll(() => page.evaluate(() => window.workerEvidence.events.some(event => event.type === "projection.updated" && event.requestId === "e2e-history-probe"))).toBe(true);
    const after = await page.evaluate(() => window.workerEvidence.events.find(event => event.type === "projection.updated" && event.requestId === "e2e-history-probe"));
    if (before?.type !== "loaded" || after?.type !== "projection.updated") throw new Error("Missing worker evidence");
    expect(after.projection.history).toEqual(before.projection.history);
    expect(after.projection.components).toEqual(before.projection.components);
    expect(after.projection.simulation.processedEvents).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("architecture.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await orders.focus(); await orders.press("Enter");
    await expect(inspector).toContainText("Database owned by orders: orders, outbox");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

async function stubWorker(page: Page, mode: "empty" | "invalid" | "error" | "private") {
  await page.addInitScript(({ mode }) => {
    window.Worker = class extends EventTarget {
      postMessage(command: WorkerCommand) {
        const projection = {
          architecture: { components: mode === "private" ? [{ id: "orders", kind: "service", label: "orders", model: "distlab.orders", version: "1.0.0" }] : [],
            links: mode === "invalid" ? [{ source: "missing", target: "unknown" }] : [] },
          simulation: { runId: "test", status: "READY", time: 0, pendingEvents: 0, processedEvents: 0, randomDrawCount: 0 },
          history: { observations: [] },
          components: [{ componentId: "orders", visibility: "host", state: { secret: "PRIVATE_STATE_SENTINEL" } }],
        } as unknown as RuntimeProjectionSet;
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: mode === "error"
          ? { version: 1, type: "error", requestId: command.requestId, error: { code: "INVALID_SCENARIO", message: "The scenario could not be loaded.", context: null } }
          : { version: 1, type: "loaded", requestId: command.requestId, projection } })));
      }
      terminate() {}
    } as unknown as typeof Worker;
  }, { mode });
}

for (const mode of ["empty", "invalid", "error", "private"] as const) {
  test(`architecture component handles ${mode} inputs`, async ({ page }) => {
    await stubWorker(page, mode);
    await page.goto("/");
    await page.getByRole("button", { name: "Load scenario" }).click();
    if (mode === "empty") await expect(page.getByText("No architecture components to display.")).toBeVisible();
    if (mode === "invalid") await expect(page.getByRole("alert")).toContainText("connections to missing components");
    if (mode === "error") {
      await expect(page.getByRole("alert")).toContainText("INVALID_SCENARIO");
      await expect(page.locator(".react-flow")).toHaveCount(0);
    }
    if (mode === "private") {
      await page.getByRole("button", { name: "Orders, Internal service" }).click();
      await expect(page.getByRole("complementary")).toContainText("Database owned by orders");
      await expect(page.locator("body")).not.toContainText("PRIVATE_STATE_SENTINEL");
    }
  });
}
