import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

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

test("stepping checkout shows ordered timeline rows, trace detail, and movement cues without new commands", async ({ page }) => {
  test.setTimeout(60_000);
  await observeWorker(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load scenario" }).click();
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // Simulation commands are hidden in history focus; keep them reachable for this canonical-row test.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  // This test reads canonical rows; the teaching Story view has its own spec.
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recorded history", exact: true })).toBeVisible();
  await expect(page.locator("#timeline-order")).toContainText("it does not execute an event");
  const ready = await latestProjection(page);
  const filterDrawer = page.locator(".history-filter-drawer");
  if ((await filterDrawer.getAttribute("open")) === null) await filterDrawer.locator("> summary").click();
  await page.locator(".timeline-filter-disclosure summary").click();
  await expect(page.locator(".timeline-count")).toContainText(`${ready.history.observations.length} of ${ready.history.observations.length}`);
  await page.getByLabel("Type", { exact: true }).fill("simulation.created");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  await page.locator("#timeline-rows button").first().click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  // Reset replaces the session, so the view returns to Story and this test re-selects Raw.
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  if ((await filterDrawer.getAttribute("open")) === null) await filterDrawer.locator("> summary").click();
  await page.locator(".timeline-filter-disclosure summary").click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");
  await expect(page.locator("#timeline-rows button[data-observation-id][aria-pressed='true']")).toHaveCount(0);
  expect((await latestProjection(page)).history.observations).toEqual(ready.history.observations);

  await stepUntil(page, "network.request.sent");
  await page.getByLabel("Type", { exact: true }).fill("network.request.sent");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  const requestRows = page.locator("#timeline-rows button");
  await expect(requestRows).toHaveCount(1);
  const requestText = await requestRows.first().innerText();
  await requestRows.first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Request sent from customer-app to orders at virtual time");
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(1);
  await expect(page.locator(".react-flow__node.is-involved")).toHaveCount(2);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await stepUntil(page, "message.delivered");
  await page.getByLabel("Type", { exact: true }).fill("message.delivered");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  await expect(page.locator("#timeline-rows button").first()).toContainText("message.delivered");
  await page.locator("#timeline-rows button").first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Message delivered from OrderCreated to payments at virtual time");
  await expect(page.locator(".react-flow__edge.movement-message")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(0);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await page.getByLabel("Type", { exact: true }).fill("database.write.staged");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  await page.locator("#timeline-rows button").first().click();
  const detail = page.locator("#inspection-panel");
  await expect(detail).toContainText("Before");
  await expect(detail).toContainText("After");
  await expect(detail).toContainText("Trace");
  await expect(detail).toContainText("Span");
  const inspector = page.locator(".story-inspector");
  if ((await inspector.getAttribute("open")) === null) await inspector.locator("> summary").click();
  await detail.getByText("Related evidence", { exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Causation" })).toBeVisible();
  await page.getByRole("button", { name: "Show this trace" }).click();
  await page.getByLabel("Filter by", { exact: true }).selectOption("traceId");
  await expect(page.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await expect(page.locator(".timeline-count")).not.toContainText(/^0 of /);

  await page.getByLabel("Trace", { exact: true }).fill("");
  await page.getByLabel("Filter by", { exact: true }).selectOption("type");
  await page.getByLabel("Type", { exact: true }).fill("scenario.assertion.evaluated");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  const visible = await page.locator("#timeline-rows button").allInnerTexts();
  const parsed = visible.map(text => {
    const time = /t=(\d+)/.exec(text);
    const sequence = /#(\d+)/.exec(text);
    return { time: Number(time?.[1]), sequence: Number(sequence?.[1]) };
  });
  assertOrder(parsed);

  const commands = await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type));
  // Playback navigation lives with the architecture graph now.
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Next observation" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
  await page.getByRole("button", { name: "Pause timeline" }).click();
  expect(await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type))).toEqual(commands);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  expect(requestText).toContain("network.request.sent");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  // Reset replaces the session, so the view returns to Story and this test re-selects Raw.
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");
  await expect(page.locator(".timeline-count")).toContainText(`${ready.history.observations.length} of ${ready.history.observations.length}`);
  await expect(page.locator("#timeline-rows button[data-observation-id][aria-pressed='true']")).toHaveCount(0);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(0);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  expect((await latestProjection(page)).history.observations).toEqual(ready.history.observations);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Learning summarizes repeated engine bookkeeping and opens each exact raw record", async ({ page }) => {
  test.setTimeout(60_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1534, height: 897 });
  await page.goto("/");
  await page.getByRole("button", { name: "Load scenario" }).click();
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const observations = (await latestProjection(page)).history.observations;
  await expect(page.getByRole("button", { name: "Story", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Learning", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".learning-group").first()).toContainText("Initial engine queue setup");
  expect(await page.locator(".learning-group summary").first().evaluate(node => node.getBoundingClientRect().width > 200)).toBe(true);
  expect(await page.locator("#timeline-rows").evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await page.locator(".learning-rows > button").first().evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(3);
  await expect(page.locator(".timeline-count")).toContainText("records summarized");
  await page.screenshot({ path: "e2e/evidence/issue-49-learning-timeline.png", fullPage: true });
  const group = page.locator(".learning-group").first();
  await group.locator("summary").click();
  const rawMembers = group.locator("li");
  await expect(rawMembers).toHaveCount(9);
  const exactId = observations.find(item => item.type === "scheduler.event.scheduled")!.id;
  await rawMembers.filter({ hasText: exactId }).getByRole("button", { name: "Open raw observation" }).click();
  await expect(page.locator("#inspection-panel")).toContainText(exactId);
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Raw", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".timeline-count")).toContainText(`${observations.length} of ${observations.length}`);
  await expect(page.locator("#timeline-rows > div")).toHaveAttribute("style", new RegExp(`height: ${observations.length * 44}px`));
  await page.locator("#timeline-rows").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(page.locator("#timeline-rows button").last()).toContainText(`#${observations.at(-1)!.sequence}`);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reduced motion keeps the movement text and does not animate the edge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await observeWorker(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const reducedDrawer = page.locator(".history-filter-drawer");
  if ((await reducedDrawer.getAttribute("open")) === null) await reducedDrawer.locator("> summary").click();
  await page.locator(".timeline-filter-disclosure summary").click();
  await page.getByLabel("Type", { exact: true }).fill("network.request.sent");
  await page.getByLabel("Type", { exact: true }).press("Escape");
  await page.locator("#timeline-rows button").first().click();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await expect(page.locator("#movement-cue")).toContainText("Request sent from customer-app to orders");
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
  await page.getByRole("button", { name: "Load scenario" }).click();
  await page.evaluate(() => {
    const requestId = window.timelineFixture.commands.at(-1)!.requestId;
    window.timelineFixture.emit({
      version: 1, type: "loaded", requestId,
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
          { schemaVersion: 1, id: "visible", time: 5, sequence: 1, type: "database.write.staged", source: "orders", target: "payments", traceId: "trace-1", spanId: "span-1", data: { before: { status: "EMPTY" }, after: { status: "CREATED" } } },
          { schemaVersion: 1, id: "redacted", time: 5, sequence: 2, type: "database.row.read", source: "orders", traceId: "trace-1", spanId: "span-1", data: { redacted: true } },
          { schemaVersion: 1, id: "omitted", time: 5, sequence: 3, type: "database.row.read", source: "payments", traceId: "trace-1", spanId: "span-1" },
        ] },
        components: [],
      },
    });
  });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // Simulation commands are hidden in history focus.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.locator(".timeline-count")).toContainText("3 of 3");
  const rows = page.locator("#timeline-rows button");
  const labels = await rows.allInnerTexts();
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
