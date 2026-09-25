import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, responseLostCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine, openHarness } from "@distlab/scenario";
import AxeBuilder from "@axe-core/playwright";

declare global {
  interface Window {
    lessonEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
  }
}

async function captureWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.lessonEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.lessonEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.lessonEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function latestProjection(page: Page): Promise<RuntimeProjectionSet> {
  return page.evaluate(() => {
    const event = window.lessonEvidence.events.filter(item => "projection" in item).at(-1);
    if (!event || !("projection" in event)) throw new Error("No worker projection received");
    return event.projection;
  });
}

test("the response-lost checkout lesson runs from load to a headless-equivalent deterministic rerun", async ({ page }) => {
  test.setTimeout(90_000);
  const headless = openHarness(new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }).create(responseLostCheckout));
  await headless.run();
  const fixture = headless.inspect();
  expect(fixture.results.every(result => result.status === "PASS")).toBe(true);

  await captureWorker(page);
  await page.goto("/");
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.getByRole("status", { name: "Simulation status" });
  const lesson = page.getByRole("region", { name: "Checkout lesson" });
  await expect(lesson).toContainText("No lesson is loaded");
  await page.locator(".lesson-guide summary").click();
  await expect(lesson).toContainText("Does the timeout prove that payment failed?");
  await page.locator(".lesson-guide summary").click();
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await button("Load scenario").click();
  await expect(status).toHaveText("READY");
  await expect(lesson).toContainText("Lesson ready");
  await expect(page.getByRole("application", { name: "Architecture graph" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  for (const category of ["Client", "Internal service", "Infrastructure", "External service"]) {
    await expect(page.locator(".category-label", { hasText: category }).first()).toBeVisible();
  }
  const initial = await latestProjection(page);

  // Submit both controls in one browser task so Pause reaches this small run at its next yield.
  await page.evaluate(async () => {
    const controls = [...document.querySelectorAll("button")];
    controls.find(item => item.textContent === "Run")!.click();
    await Promise.resolve();
    controls.find(item => item.textContent === "Pause")!.click();
  });
  await expect(status).toHaveText("PAUSED");
  const paused = await latestProjection(page);
  expect(paused.simulation.processedEvents).toBeGreaterThan(0);
  await button("Step").focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("PAUSED");
  expect((await latestProjection(page)).simulation.processedEvents).toBe(paused.simulation.processedEvents + 1);
  await button("Run").click();
  await expect(status).toHaveText("COMPLETED");
  await expect(lesson).toContainText("Run complete");
  const first = await latestProjection(page);
  expect(first.simulation.time).toBe(fixture.time);
  expect(first.history.observations).toEqual(fixture.history.observations);
  expect(Object.fromEntries(first.components.filter(item => item.visibility === "host").map(item => [item.componentId, item.state]))).toEqual((fixture.state as { components: unknown }).components);
  expect(first.history.observations.filter(item => item.type === "scenario.assertion.evaluated")).toEqual(
    fixture.history.observations.filter(item => item.type === "scenario.assertion.evaluated"),
  );
  const verdicts = fixture.results.map(result => {
    const observation = first.history.observations.filter(item => item.type === "scenario.assertion.evaluated"
      && (item.data as { assertionId?: string }).assertionId === result.id).at(-1);
    if (!observation) throw new Error(`Missing worker assertion ${result.id}`);
    const data = observation.data as { verdict: boolean; evidence: unknown };
    return { id: result.id, status: data.verdict ? "PASS" : "FAIL", time: observation.time, evidence: data.evidence };
  });
  expect(verdicts).toEqual(fixture.results);

  const raw = page.locator("details.raw-state");
  if ((await raw.getAttribute("open")) === null) await raw.locator("summary").click();
  const panel = page.getByRole("region", { name: "Distributed state" });
  await expect(panel).toContainText("Status: selected");
  await expect(panel).toContainText("NETWORK_TIMEOUT");
  await expect(panel).toContainText("authorization-1 APPROVED");
  await expect(panel).toContainText("not proof of denial or rollback");
  await button("Show fault selection").click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("fault.effect.selected");
  await button("Show processor authorization").click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("external.effect.committed");
  await button("Show Payments timeout").click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("network.request.timedout");
  await expect(page.getByRole("status", { name: "Request and message movement" })).not.toContainText("No request or message movement");
  await button("Fit View").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await button("Payments, Internal service").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("NETWORK_TIMEOUT");
  await button("Payment Processor, External service").click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("APPROVED");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".react-flow__edge.is-movement .react-flow__edge-path")).toHaveCSS("animation-name", "none");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await button("Reset").click();
  await expect(status).toHaveText("READY");
  expect(await latestProjection(page)).toEqual(initial);
  await button("Run").click();
  await expect(status).toHaveText("COMPLETED");
  const second = await latestProjection(page);
  expect(second).toEqual(first);
  expect(second.history.observations).toEqual(fixture.history.observations);
  expect(await page.evaluate(() => window.lessonEvidence.commands.map(item => item.type))).toEqual(["load", "run", "pause", "step", "run", "reset", "run"]);
});
