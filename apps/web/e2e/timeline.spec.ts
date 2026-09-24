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
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.locator("#timeline-order")).toContainText("Virtual time is the simulation clock");
  const ready = await latestProjection(page);
  await expect(page.locator(".timeline-count")).toContainText(`${ready.history.observations.length} of ${ready.history.observations.length}`);

  await stepUntil(page, "network.request.sent");
  await page.getByLabel("Type", { exact: true }).fill("network.request.sent");
  const requestRows = page.locator("#timeline-rows button");
  await expect(requestRows).toHaveCount(1);
  const requestText = await requestRows.first().innerText();
  await requestRows.first().click();
  await expect(page.locator("#movement-cue")).toContainText("Request sent from customer-app to orders at virtual time");
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(1);
  await expect(page.locator(".react-flow__node.is-involved")).toHaveCount(2);

  await stepUntil(page, "message.delivered");
  await page.getByLabel("Type", { exact: true }).fill("message.delivered");
  await expect(page.locator("#timeline-rows button").first()).toContainText("message.delivered");
  await page.locator("#timeline-rows button").first().click();
  await expect(page.locator("#movement-cue")).toContainText("Message delivered from OrderCreated to payments at virtual time");
  await expect(page.locator(".react-flow__edge.movement-message")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.movement-request")).toHaveCount(0);

  await page.getByLabel("Type", { exact: true }).fill("database.write.staged");
  await page.locator("#timeline-rows button").first().click();
  const detail = page.getByRole("region", { name: "Observation detail" });
  await expect(detail).toContainText("Before");
  await expect(detail).toContainText("After");
  await expect(detail).toContainText("Trace");
  await expect(detail).toContainText("Span");
  await expect(detail.getByRole("heading", { name: "Causation" })).toBeVisible();
  await page.getByRole("button", { name: "Show this trace" }).click();
  await expect(page.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await expect(page.locator(".timeline-count")).not.toContainText("0 of");

  await page.getByLabel("Type", { exact: true }).fill("scenario.assertion.evaluated");
  await page.getByLabel("Trace", { exact: true }).fill("");
  const visible = await page.locator("#timeline-rows button").allInnerTexts();
  const parsed = visible.map(text => {
    const time = /t=(\d+)/.exec(text);
    const sequence = /#(\d+)/.exec(text);
    return { time: Number(time?.[1]), sequence: Number(sequence?.[1]) };
  });
  assertOrder(parsed);

  const commands = await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type));
  await page.getByRole("button", { name: "Next observation" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
  await page.getByRole("button", { name: "Pause timeline" }).click();
  expect(await page.evaluate(() => window.timelineEvidence.commands.map(command => command.type))).toEqual(commands);
  expect(requestText).toContain("network.request.sent");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(0);
  expect((await latestProjection(page)).history.observations).toEqual(ready.history.observations);
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
  await page.getByLabel("Type", { exact: true }).fill("network.request.sent");
  await page.locator("#timeline-rows button").first().click();
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
  await expect(page.locator(".timeline-count")).toContainText("3 of 3");
  const rows = page.locator("#timeline-rows button");
  const labels = await rows.allInnerTexts();
  assertOrder(labels.map(text => ({ time: Number(/t=(\d+)/.exec(text)?.[1]), sequence: Number(/#(\d+)/.exec(text)?.[1]) })));
  await rows.nth(1).click();
  const detail = page.getByRole("region", { name: "Observation detail" });
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
