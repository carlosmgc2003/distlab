import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { applyMoreFilters, fillFilterField, filterByType, openMoreFilters, viewButton } from "./support/history.ts";

declare global {
  interface Window {
    timelineEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
    timelineFixture: { commands: WorkerCommand[]; emit: (event: unknown) => void };
  }
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.timelineEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.timelineEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.timelineEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function latestProjection(page: Page): Promise<RuntimeProjectionSet> {
  return page.evaluate(() => {
    const latest = window.timelineEvidence.events.filter(event => "projection" in event).at(-1);
    if (!latest || !("projection" in latest)) throw new Error("Missing worker projection");
    return latest.projection;
  });
}

async function stepUntil(page: Page, type: string) {
  const status = page.getByRole("status", { name: "Simulation status" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const projection = await latestProjection(page);
    if (projection.history.observations.some(item => item.type === type)) return projection;
    await page.getByRole("button", { name: "Step", exact: true }).click();
    await expect(status).toHaveText(/PAUSED|COMPLETED/);
  }
  throw new Error(`${type} did not appear`);
}

test("stepping checkout shows ordered Story table rows, trace detail, and movement cues without new commands", async ({ page }) => {
  test.setTimeout(60_000);
  await observeWorker(page);
  await page.goto("/");
  await loadLesson(page, "normal");
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await expect(page.getByRole("heading", { name: "Recorded history", exact: true })).toBeVisible();
  await expect(page.locator("#timeline-order")).toContainText("it does not execute an event");
  const ready = await latestProjection(page);
  const activeFilters = page.getByRole("list", { name: "Active filters", exact: true });
  await expect(page.locator(".timeline-count")).toContainText(`from ${ready.history.observations.length} recorded observations`);
  await filterByType(page, "simulation.created");
  await expect(activeFilters).toHaveCount(1);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  // Reset replaces the session, so the view returns to the Story diagram.
  await viewButton(page, "Story table").click();
  await expect(activeFilters).toHaveCount(0);
  await expect(page.locator("#timeline-rows [data-observation-id][aria-pressed='true']")).toHaveCount(0);
  expect((await latestProjection(page)).history.observations).toEqual(ready.history.observations);

  await stepUntil(page, "network.request.sent");
  await filterByType(page, "network.request.sent");
  const tableRows = page.locator(".story-table tbody tr");
  const rowButtons = page.locator(".story-table button[data-observation-id]");
  await expect(tableRows).toHaveCount(1);
  const requestText = await tableRows.first().innerText();
  await rowButtons.first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Request sent from Customer App to Orders at virtual time");
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(1);
  await expect(page.locator(".react-flow__node.is-involved")).toHaveCount(2);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await stepUntil(page, "message.delivered");
  await filterByType(page, "message.delivered");
  await expect(rowButtons.first()).toContainText("Message delivered");
  await rowButtons.first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Message delivered from OrderCreated to Payments at virtual time");
  await expect(page.locator(".react-flow__edge.movement-message")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(0);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await filterByType(page, "database.transaction.committed");
  await rowButtons.first().click();
  const detail = page.locator("#inspection-panel");
  await expect(detail).toContainText("Before");
  await expect(detail).toContainText("After");
  await expect(detail).toContainText("Trace");
  await expect(detail).toContainText("Span");
  await detail.getByText("Related evidence", { exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Causation" })).toBeVisible();
  await page.getByRole("button", { name: "Show this trace" }).click();
  await expect(page.locator(".timeline-count")).not.toContainText(/^0 teaching/);
  const dialog = await openMoreFilters(page);
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("traceId");
  await expect(dialog.getByLabel("Trace", { exact: true })).not.toHaveValue("");

  await fillFilterField(page, "traceId", "");
  await applyMoreFilters(page);
  const visible = await tableRows.allInnerTexts();
  const parsed = visible.map(text => {
    const time = /t=(\d+)/.exec(text);
    const sequence = /#(\d+)/.exec(text);
    return { time: Number(time?.[1]), sequence: Number(sequence?.[1]) };
  });
  assertOrder(parsed);

  const commands = await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type));
  // Playback navigation lives with the architecture graph now.
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Next movement" }).click();
  await page.getByRole("button", { name: "Play replay" }).click();
  await page.getByRole("button", { name: "Pause replay" }).click();
  expect(await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type))).toEqual(commands);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  expect(requestText).toContain("Request sent");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  await expect(viewButton(page, "Story diagram")).toHaveAttribute("aria-pressed", "true");
  await expect(activeFilters).toHaveCount(0);
  await expect(page.locator(".timeline-count")).toContainText(`from ${ready.history.observations.length} recorded observations`);
  await expect(page.locator("#timeline-rows [data-observation-id][aria-pressed='true']")).toHaveCount(0);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(0);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  expect((await latestProjection(page)).history.observations).toEqual(ready.history.observations);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reduced motion keeps the movement text and does not animate the edge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await observeWorker(page);
  await page.goto("/");
  await loadLesson(page, "normal");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await filterByType(page, "network.request.sent");
  await page.locator(".story-table button[data-observation-id]").first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Request sent from Customer App to Orders");
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(1);
  const animation = await page.locator(".react-flow__edge.movement-request .react-flow__edge-path").evaluate(element => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
});

test("redacted and omitted payloads stay unmarked and incomplete history is labeled", async ({ page }) => {
  await page.addInitScript(() => {
    window.timelineFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.timelineFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.timelineFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await loadLesson(page, "normal");
  await page.evaluate(() => {
    const requestId = window.timelineFixture.commands.at(-1)!.requestId;
    window.timelineFixture.emit({
      version: 1, type: "loaded", requestId,
      session: { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: { version: 1, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } },
      projection: {
        architecture: {
          components: [
            { id: "orders", kind: "service", label: "orders" },
            { id: "payments", kind: "service", label: "payments" },
          ],
          links: [{ source: "orders", target: "payments" }],
        },
        simulation: { runId: "fixture", status: "PAUSED", time: 5, pendingEvents: 0, processedEvents: 1, randomDrawCount: 0 },
        history: { observations: [
          { schemaVersion: 1, id: "visible", time: 5, sequence: 1, type: "database.transaction.committed", source: "orders", target: "payments", traceId: "trace-1", spanId: "span-1", data: { before: { status: "EMPTY" }, after: { status: "CREATED" } } },
          { schemaVersion: 1, id: "redacted", time: 5, sequence: 2, type: "database.transaction.committed", source: "orders", traceId: "trace-1", spanId: "span-1", data: { redacted: true } },
          { schemaVersion: 1, id: "omitted", time: 5, sequence: 3, type: "database.transaction.committed", source: "payments", traceId: "trace-1", spanId: "span-1" },
        ] },
        components: [],
      },
    });
  });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await viewButton(page, "Story table").click();
  await expect(page.locator(".timeline-count")).toContainText("3 teaching milestones from 3 recorded observations");
  const rows = page.locator(".story-table button[data-observation-id]");
  const labels = await page.locator(".story-table tbody tr").allInnerTexts();
  assertOrder(labels.map(text => ({ time: Number(/t=(\d+)/.exec(text)?.[1]), sequence: Number(/#(\d+)/.exec(text)?.[1]) })));
  await rows.nth(1).click();
  const detail = page.locator("#inspection-panel");
  await expect(detail).toContainText("Stored payload is redacted. Hidden fields are not available.");
  await expect(detail).toContainText('"redacted": true');
  await expect(detail).not.toContainText("invented-secret");
  await expect(detail).toContainText("No before or after values were stored.");
  await rows.nth(2).click();
  await expect(detail).toContainText("No data field was stored.");
  await expect(detail).not.toContainText("invented-secret");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await page.evaluate(() => {
    const requestId = window.timelineFixture.commands.at(-1)!.requestId;
    window.timelineFixture.emit({
      version: 1, type: "error", requestId,
      error: {
        code: "SIMULATION_FAILED", message: "The simulation failed at an event boundary.",
        context: { code: "HISTORY_LIMIT_EXCEEDED", historyComplete: false, time: 5, lastObservationId: "omitted", context: { rejected: true } },
      },
    });
  });
  await expect(page.getByRole("status", { name: "Terminal history" })).toContainText("Execution history is incomplete.");
  await expect(page.getByRole("status", { name: "Terminal history" })).toContainText("HISTORY_LIMIT_EXCEEDED");
  await expect(page.getByRole("status", { name: "Terminal history" })).toContainText("omitted");
  await expect(page.locator("#timeline-rows")).toHaveCount(0);
});

function assertOrder(rows: { time: number; sequence: number }[]) {
  expect(rows.length).toBeGreaterThan(0);
  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index]!.sequence).toBeGreaterThan(rows[index - 1]!.sequence);
    expect(rows[index]!.time).toBeGreaterThanOrEqual(rows[index - 1]!.time);
  }
}
