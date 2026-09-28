import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { WorkerCommand, WorkerEvent } from "@distlab/contracts";

declare global {
  interface Window {
    workerEvidence: { commands: WorkerCommand[]; events: WorkerEvent[]; probeHistory: () => void };
  }
}

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-81");

/** Test-only transport spy. Playback must never reach the worker. */
async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.workerEvidence = { commands: [], events: [], probeHistory: () => {} };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.workerEvidence.events.push(structuredClone(event.data)));
        window.workerEvidence.probeHistory = () => super.postMessage({ version: 1, type: "pause", requestId: "e2e-history-probe" });
      }
      override postMessage(message: WorkerCommand) {
        window.workerEvidence.commands.push(structuredClone(message));
        super.postMessage(message);
      }
    };
  });
}

async function loadScenario(page: Page, scenario: "normal" | "response-lost" = "response-lost") {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
}

async function runCheckout(page: Page, scenario: "normal" | "response-lost" = "response-lost") {
  await loadScenario(page, scenario);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
}

const transport = (page: Page) => page.getByRole("group", { name: "Recorded history navigation" });
const narration = (page: Page) => page.locator(".flight-narration");
const position = (page: Page) => page.getByRole("status", { name: "Architecture playback position" });

/** The narration heading, with the glyph and the stored label on one line. */
async function narrationTitle(page: Page): Promise<string> {
  if (await page.locator(".flight-narration h4").count() === 0) return "";
  return (await narration(page).locator("h4").innerText()).replace(/\s+/g, " ").trim();
}

/** Steps the replay cursor to the first movement with this stored headline. */
async function stepTo(page: Page, headline: string) {
  const next = page.getByRole("button", { name: "Next observation" });
  const wanted = `${glyphFor(headline)} ${headline}`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await narrationTitle(page) === wanted) return;
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(60);
  }
  expect(await narrationTitle(page)).toBe(wanted);
}

function glyphFor(headline: string): string {
  if (headline === "Response dropped") return "⊘";
  if (headline === "Request timed out") return "◷";
  if (headline.startsWith("Message")) return "⇢";
  if (headline.startsWith("Response")) return "←";
  return "→";
}

test("the replay cursor walks recorded movements and paints a token on the graph", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  // A supported desktop baseline, where both control groups fit one command row.
  await page.setViewportSize({ width: 1534, height: 897 });
  await observeWorker(page);
  await loadScenario(page);

  // The transport is recorded history navigation beside the simulation commands, not one of them.
  await expect(transport(page)).toBeVisible();
  const commandRow = page.locator(".command-row");
  await expect(commandRow.getByRole("group", { name: "Simulation execution" })).toBeVisible();
  // Both groups share one row, kept apart by a rule and their own labels.
  const rowBox = (await commandRow.boundingBox())!;
  const transportBox = (await transport(page).boundingBox())!;
  const executionBox = (await page.getByRole("group", { name: "Simulation execution" }).boundingBox())!;
  const lastCommand = (await page.getByRole("button", { name: "Reset", exact: true }).boundingBox())!;
  expect(Math.abs(transportBox.y - executionBox.y), "the two groups sit on one command row").toBeLessThan(rowBox.height);
  expect(transportBox.x, "recorded history navigation follows the simulation commands").toBeGreaterThan(lastCommand.x + lastCommand.width);
  expect(rowBox.height, "one line of commands at the supported baselines").toBeLessThanOrEqual(56);
  // The groups are centred on one line rather than stacked.
  const overlap = Math.min(lastCommand.y + lastCommand.height, transportBox.y + transportBox.height)
    - Math.max(lastCommand.y, transportBox.y);
  expect(overlap, "the two groups share the command row").toBeGreaterThan(20);
  await expect(page.locator(".flight-nav-group")).toHaveCSS("border-left-style", "solid");
  // Only the simulation group's first command is painted as the primary action.
  await expect(page.getByRole("button", { name: "Run", exact: true })).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(page.getByRole("button", { name: "Play timeline" })).not.toHaveCSS("background-color", "rgb(29, 78, 216)");
  // Before the run there is nothing recorded to replay, and the transport says so.
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeDisabled();
  await expect(position(page)).toHaveText("No recorded movements to replay.");
  await expect(narration(page)).toHaveCount(0);
  await expect(page.locator("[data-flight-token]")).toHaveCount(0);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeEnabled();

  await stepTo(page, "Request sent");
  const first = await position(page).innerText();
  expect(first).toMatch(/^Movement 1 of 13 · virtual time 0 · observation #\d+\.$/);
  // The token is painted on the link the record says the movement used.
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(1);
  await expect(narration(page)).toContainText("customer-app → orders · Request link");
  await expect(narration(page)).toContainText("Endpoint");
  await expect(narration(page)).toContainText("POST /orders");
  await expect(narration(page)).toContainText("Deadline at virtual time");
  await expect(narration(page)).toContainText("What to look for");
  // The sending and receiving components are named on the graph, not only in the narration.
  await expect(page.getByRole("button", { name: "Customer App, Client", exact: true })).toContainText("sends");
  await expect(page.getByRole("button", { name: "Orders, Internal service", exact: true })).toContainText("receives");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-request-sent.png") });

  // A message movement is a different glyph, a different link, and a different narration.
  await stepTo(page, "Message delivered (attempt 1)");
  await expect(narration(page)).toContainText("OrderCreated → payments · MessageBus subscription");
  await expect(narration(page)).toContainText("Delivery attempt");
  await expect(page.locator(".flight-token.flight-message")).toHaveCount(1);
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-message-delivered.png") });
});

test("a dropped response and a timeout stop on the link and state only what is recorded", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  await observeWorker(page);
  await runCheckout(page);

  await stepTo(page, "Response dropped");
  const dropped = narration(page);
  await expect(dropped).toContainText("payment-processor → payments");
  await expect(dropped).toContainText("Stored reason");
  await expect(dropped).toContainText("fault");
  // The token stops short of the destination: the record says the response never arrived.
  await expect(dropped).toContainText("The token stops on this link");
  await expect(dropped).toContainText("does not state what either component concluded");
  const token = page.locator("[data-flight-token]");
  const stop = async () => token.evaluate(element => getComputedStyle(element).getPropertyValue("--flight-end").trim());
  await expect.poll(stop, { message: "a dropped response stops short of the destination" }).toBe("52%");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-response-dropped.png") });

  await stepTo(page, "Request timed out");
  await expect(narration(page)).toContainText("payments → payment-processor");
  await expect(narration(page)).toContainText("Deadline at virtual time");
  await expect(narration(page)).toContainText("What does the caller now know about the outcome?");
  await expect.poll(stop, { message: "a timeout stops further along the link" }).toBe("78%");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-request-timed-out.png") });
});

test("playback advances the cursor at the chosen pace and sends no worker command", async ({ page }) => {
  test.setTimeout(180_000);
  await observeWorker(page);
  await runCheckout(page);

  await stepTo(page, "Request sent");
  // The narration names the chosen pace, and the help explains that pace is presentation only.
  await expect(page.getByLabel("Speed", { exact: true })).toHaveValue("slow");
  await expect(page.getByRole("button", { name: "Playback speed" })).toBeVisible();
  await expect(page.locator("#flight-pace-help")).toContainText("does not change virtual time");

  const before = await page.evaluate(() => window.workerEvidence.commands.map(command => command.type));
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeVisible();
  // Slow pace: the first advance takes longer than the token animation it paints.
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 1 of"), { timeout: 4_000 }).toBe(true);
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 2 of"), { timeout: 8_000 }).toBe(true);
  const after = await page.evaluate(() => window.workerEvidence.commands.map(command => command.type));
  expect(after, "playback is a browser cursor, not a simulation command").toEqual(before);

  await page.getByRole("button", { name: "Pause timeline" }).click();
  const paused = await position(page).innerText();
  await page.waitForTimeout(2_000);
  expect(await position(page).innerText(), "Pause stops the cursor").toBe(paused);
  expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(before);

  // A faster pace reaches the end of the recorded movements; the last one stays painted.
  await page.getByLabel("Speed", { exact: true }).selectOption("fast");
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 13 of"), { timeout: 30_000 }).toBe(true);
  // At the recorded end the primary control becomes Restart timeline, as the transport states.
  await expect(page.getByRole("button", { name: "Restart timeline" })).toBeVisible();
  await expect(page.locator(".flight-boundaries")).toContainText("waits for the run to record more");
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  // At the recorded end the transport offers Restart, which plays from the first movement.
  await page.getByRole("button", { name: "Restart timeline" }).click();
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 1 of"), { timeout: 5_000 }).toBe(true);
  expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(before);
});

test("speed changes the painted interval, not the recorded run", async ({ page }) => {
  test.setTimeout(180_000);
  await observeWorker(page);
  await runCheckout(page, "normal");
  await stepTo(page, "Request sent");
  const duration = () => page.locator("[data-flight-token]")
    .evaluate(token => getComputedStyle(token).getPropertyValue("--flight-duration").trim());
  await expect.poll(duration, { message: "the slow pace paints a movement over a longer interval" }).toBe("1116ms");
  const stateBefore = await page.evaluate(() => window.workerEvidence.events.filter(event => event.type === "projection.updated").length);

  await page.getByLabel("Speed", { exact: true }).selectOption("fast");
  await expect.poll(async () => page.locator("[data-flight-token]").evaluate(token => getComputedStyle(token).getPropertyValue("--flight-duration").trim()))
    .toBe("217ms");
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 2 of"), { timeout: 8_000 }).toBe(true);
  // Neither the pace nor playback touches the recorded projection the worker published.
  const stateAfter = await page.evaluate(() => window.workerEvidence.events.filter(event => event.type === "projection.updated").length);
  expect(stateAfter).toBe(stateBefore);
});

test("reduced motion rests the token where the record stopped and keeps the narration", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await runCheckout(page);
  await stepTo(page, "Response dropped");
  const token = page.locator("[data-flight-token]");
  await expect(token).toHaveCount(1);
  const painted = await token.evaluate(element => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, distance: style.offsetDistance };
  });
  expect(painted.animation, "no movement animation under reduced motion").toBe("none");
  // The token still shows the outcome of the record: it rests where the movement stopped.
  expect(parseFloat(painted.distance)).toBeGreaterThan(0);
  expect(parseFloat(painted.distance)).toBeLessThan(100);
  await expect(narration(page)).toContainText("Response dropped");
  await expect(narration(page)).toContainText("The token stops on this link");
  await expect(page.locator("#movement-cue")).toContainText("Response dropped from payment-processor to payments");
});

test("selecting a record in Recorded history takes the graph highlight back", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  await observeWorker(page);
  await runCheckout(page);
  await stepTo(page, "Message delivered (attempt 1)");
  await expect(narration(page)).toBeVisible();

  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // Selecting a movement milestone in the Story table is a reader choice, not a live cue.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.locator(".story-table button").first().click();
  await expect(page.locator(".story-table button[aria-pressed='true']")).toHaveCount(1);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  // The reader's choice wins: the replay cursor stands down and the graph shows the selection.
  await expect(narration(page)).toHaveCount(0);
  await expect(page.locator("[data-flight-token]")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(1);
  await expect(page.locator("#movement-cue")).toContainText("from customer-app to orders");
  await expect(position(page)).toHaveText("0 of 13 recorded movements. Nothing selected.");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-history-selection-wins.png") });
});

test("the graph keeps its fit while the narration column opens and closes", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1534, height: 897 });
  await observeWorker(page);
  await runCheckout(page);
  const canvas = () => page.locator(".graph-canvas");
  // The command row carries both control groups on one line at the supported baselines,
  // so the graph area keeps its height.
  for (const row of await page.locator(".toolbar-row").all()) {
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(56);
  }
  const fits = async (label: string) => {
    const box = (await canvas().boundingBox())!;
    expect(box.height, `${label}: the graph canvas keeps a readable height`).toBeGreaterThan(240);
    const nodes = await page.locator(".react-flow__node").evaluateAll((elements, area) => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.getAttribute("data-id"), left: rect.left - area.x, top: rect.top - area.y, right: rect.right - area.x, bottom: rect.bottom - area.y };
    }), { x: box.x, y: box.y });
    expect(nodes.length).toBe(5);
    for (const node of nodes) {
      expect(node.left, `${label}: ${node.id} left padding`).toBeGreaterThan(1);
      expect(node.top, `${label}: ${node.id} top padding`).toBeGreaterThan(1);
      expect(box.width - node.right, `${label}: ${node.id} right padding`).toBeGreaterThan(1);
      expect(box.height - node.bottom, `${label}: ${node.id} bottom padding`).toBeGreaterThan(1);
    }
  };
  await fits("no narration open");
  await stepTo(page, "Request sent");
  await fits("narration open");
  // The inspector and the narration share the side column rather than squeezing the graph away.
  await page.getByRole("button", { name: "Payments, Internal service", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeVisible();
  await fits("narration and inspector open");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-narration-and-inspector.png") });
  await page.keyboard.press("Escape");
  await fits("inspector closed");
});
