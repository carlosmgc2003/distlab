import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { graphLaidOut, loadLesson } from "./support/lesson.ts";
import { MIN_NAME_PX, expectLegibleView, graphView } from "./support/graph.ts";
import { viewButton } from "./support/history.ts";

declare global {
  interface Window {
    workerEvidence: { commands: WorkerCommand[]; events: WorkerEvent[]; probeHistory: () => void };
  }
}

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-81");
/** Evidence for direction and component activity. */
const activityEvidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-92");

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
  await loadLesson(page, scenario);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await graphLaidOut(page);
}

async function runCheckout(page: Page, scenario: "normal" | "response-lost" = "response-lost") {
  await loadScenario(page, scenario);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
}

const transport = (page: Page) => page.getByRole("group", { name: "Replay recorded movements" });
const narration = (page: Page) => page.locator(".flight-narration");
const position = (page: Page) => page.getByRole("status", { name: "Architecture playback position" });

/** The narration heading, with the glyph and the stored label on one line. */
async function narrationTitle(page: Page): Promise<string> {
  if (await page.locator(".flight-narration h4").count() === 0) return "";
  return (await narration(page).locator("h4").innerText()).replace(/\s+/g, " ").trim();
}

/** Steps the replay cursor to the first movement with this stored headline. */
async function stepTo(page: Page, headline: string) {
  const next = page.getByRole("button", { name: "Next movement" });
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
  if (headline === "Message acknowledged") return "ACK";
  if (headline.startsWith("Message")) return "MSG";
  if (headline.startsWith("Response")) return "RES";
  return "REQ";
}

/** Centre of an element, in page coordinates. */
async function centre(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
}

const nodeSelector = (id: string) => `.react-flow__node[data-id="${id}"]`;

/** Token centre sampled while it travels, from its first painted frame to where it rests. */
async function tokenPath(page: Page): Promise<{ x: number; y: number }[]> {
  const samples: { x: number; y: number }[] = [];
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  samples.push(await centre(page, "[data-flight-token]"));
  for (const wait of [250, 400, 900]) {
    await page.waitForTimeout(wait);
    samples.push(await centre(page, "[data-flight-token]"));
  }
  return samples;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The way the token travels where it stands: the link path's tangent at the
 * token, in screen space, pointing toward the link's target for a forward
 * movement and toward its source for a reversed one. ELK routes bend, so the
 * net motion over a sample window can point another way than the token does.
 */
async function travelDirection(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const token = document.querySelector("[data-flight-token]")!;
    const path = token.closest(".react-flow__edge")!.querySelector<SVGPathElement>("path.react-flow__edge-path")!;
    const box = token.getBoundingClientRect();
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const screen = (length: number) => path.getPointAtLength(length).matrixTransform(path.getScreenCTM()!);
    const total = path.getTotalLength();
    let nearest = 0;
    for (let length = 0, best = Infinity; length <= total; length += 1) {
      const point = screen(length);
      const gap = Math.hypot(point.x - at.x, point.y - at.y);
      if (gap < best) { best = gap; nearest = length; }
    }
    const before = screen(Math.max(0, nearest - 3)), after = screen(Math.min(total, nearest + 3));
    const sign = token.getAttribute("data-flight-direction") === "reverse" ? -1 : 1;
    return { x: (after.x - before.x) * sign, y: (after.y - before.y) * sign };
  });
}

/**
 * The heading mark sits ahead of the token in its direction of travel. Its offset
 * from the token centre must point the same way the token moves along its path,
 * and that way must lead toward the destination the trail approaches.
 */
async function headingAgreesWith(page: Page, motion: { x: number; y: number }) {
  const token = await centre(page, "[data-flight-token]");
  const heading = await centre(page, "[data-flight-heading] .flight-heading-mark");
  const ahead = { x: heading.x - token.x, y: heading.y - token.y };
  const local = await travelDirection(page);
  const cosine = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  expect(cosine(ahead, local), "the arrowhead points the way the token travels").toBeGreaterThan(0.9);
  // The local direction is not backwards: it never points away from the net motion.
  expect(cosine(local, motion), "the token travels toward its destination").toBeGreaterThan(-0.1);
}

test("the replay cursor walks recorded movements and paints a token on the graph", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  // A supported desktop baseline.
  await page.setViewportSize({ width: 1534, height: 897 });
  await observeWorker(page);
  await loadScenario(page);

  // Replay is not a simulation command (#144): it lives in the Architecture tab, above the graph it
  // drives, while Simulation execution stays in the one-row top bar.
  await expect(transport(page)).toBeVisible();
  const topBar = page.locator("header.top-bar");
  await expect(topBar.getByRole("group", { name: "Simulation execution" })).toBeVisible();
  await expect(topBar.getByRole("group", { name: "Replay recorded movements" })).toHaveCount(0);
  await expect(page.locator("#architecture-panel").getByRole("group", { name: "Replay recorded movements" })).toBeVisible();
  const barBox = (await topBar.boundingBox())!;
  const transportBox = (await transport(page).boundingBox())!;
  const canvasBox = (await page.locator(".graph-canvas").boundingBox())!;
  expect(barBox.height, "the top bar is one row").toBeLessThanOrEqual(64);
  expect(transportBox.y, "Replay sits below the top bar").toBeGreaterThan(barBox.y + barBox.height);
  expect(transportBox.y + transportBox.height, "Replay sits above the graph").toBeLessThanOrEqual(canvasBox.y);
  await expect(page.locator(".replay-toolbar .control-group-label")).toHaveText("Replay");
  // Only the simulation group's first command is painted as the primary action.
  await expect(page.getByRole("button", { name: "Run", exact: true })).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(page.getByRole("button", { name: "Play replay" })).not.toHaveCSS("background-color", "rgb(29, 78, 216)");
  // Before the run there is nothing recorded to replay, and the transport says so.
  await expect(page.getByRole("button", { name: "Play replay" })).toBeDisabled();
  await expect(position(page)).toHaveText("No recorded movements to replay.");
  await expect(narration(page)).toHaveCount(0);
  await expect(page.locator("[data-flight-token]")).toHaveCount(0);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await expect(page.getByRole("button", { name: "Play replay" })).toBeEnabled();

  await stepTo(page, "Request sent");
  const first = await position(page).innerText();
  expect(first).toMatch(/^Movement 1 of 13 · virtual time 0 · observation #\d+\.$/);
  // The token is painted on the link the record says the movement used.
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(1);
  await expect(narration(page)).toContainText("Customer App → Orders · Request link");
  await expect(narration(page)).toContainText("Endpoint");
  await expect(narration(page)).toContainText("POST /orders");
  await expect(narration(page)).toContainText("Deadline at virtual time");
  await expect(narration(page)).toContainText("What to look for");
  // The sending and receiving components are named on the graph, not only in the narration.
  await expect(page.getByRole("button", { name: "Customer App, Client", exact: true })).toContainText("REQ sends");
  await expect(page.getByRole("button", { name: "Orders, Internal service", exact: true })).toContainText("REQ receives");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-request-sent.png") });

  // A message movement is a different glyph, a different link, and a different narration.
  await stepTo(page, "Message delivered (attempt 1)");
  await expect(narration(page)).toContainText("OrderCreated → Payments · MessageBus subscription");
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
  await expect(dropped).toContainText("Payment Processor → Payments");
  await expect(dropped).toContainText("Stored reason");
  await expect(dropped).toContainText("fault");
  // The token stops short of the destination: the record says the response never arrived.
  await expect(dropped).toContainText("The token stops on this link");
  await expect(dropped).toContainText("does not state what either component concluded");
  const token = page.locator("[data-flight-token]");
  const stop = async () => token.evaluate(element => getComputedStyle(element).getPropertyValue("--flight-end").trim());
  // The response runs against the payments → payment-processor link, so its stop is measured from the far end:
  // it continues past the middle toward payments and stops short of it.
  await expect.poll(stop, { message: "a dropped response stops short of the destination" }).toBe("36%");
  await expect(token).toHaveAttribute("data-flight-direction", "reverse");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-response-dropped.png") });

  await stepTo(page, "Request timed out");
  await expect(narration(page)).toContainText("Payments → Payment Processor");
  await expect(narration(page)).toContainText("Deadline at virtual time");
  await expect(narration(page)).toContainText("What does the caller now know about the outcome?");
  // A timeout travels nowhere: the token rests at the caller and carries no heading mark.
  await expect.poll(stop, { message: "a timeout rests at the caller's end of the link" }).toBe("8%");
  await expect(page.locator("[data-flight-heading]")).toHaveCount(0);
  await expect(narration(page)).toContainText("The token rests at the caller");
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
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
  // Slow pace: the first advance takes longer than the token animation it paints.
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 1 of"), { timeout: 4_000 }).toBe(true);
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 2 of"), { timeout: 8_000 }).toBe(true);
  const after = await page.evaluate(() => window.workerEvidence.commands.map(command => command.type));
  expect(after, "playback is a browser cursor, not a simulation command").toEqual(before);

  await page.getByRole("button", { name: "Pause replay" }).click();
  const paused = await position(page).innerText();
  await page.waitForTimeout(2_000);
  expect(await position(page).innerText(), "Pause stops the cursor").toBe(paused);
  expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(before);

  // A faster pace reaches the end of the recorded movements; the last one stays painted.
  await page.getByLabel("Speed", { exact: true }).selectOption("fast");
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect.poll(async () => (await position(page).innerText()).includes("Movement 13 of"), { timeout: 30_000 }).toBe(true);
  // At the recorded end the primary control becomes Restart replay, as the transport states.
  await expect(page.getByRole("button", { name: "Restart replay" })).toBeVisible();
  await expect(page.locator(".flight-boundaries")).toContainText("waits for the run to record more");
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  // At the recorded end the transport offers Restart, which plays from the first movement.
  await page.getByRole("button", { name: "Restart replay" }).click();
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
  await page.getByRole("button", { name: "Play replay" }).click();
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
  await expect(page.locator("#movement-cue")).toContainText("Response dropped from Payment Processor to Payments");
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
  await viewButton(page, "Story table").click();
  await page.locator(".story-table button").filter({ hasText: "Request sent" }).first().click();
  await expect(page.locator(".story-table button[aria-pressed='true']")).toHaveCount(1);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  // The reader's choice wins: the replay cursor stands down and the graph shows the selection.
  await expect(narration(page)).toHaveCount(0);
  await expect(page.locator("[data-flight-token]")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.is-movement")).toHaveCount(1);
  await expect(page.locator("#movement-cue")).toContainText("from Customer App to Orders");
  await expect(position(page)).toHaveText("0 of 13 recorded movements. Nothing selected.");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-history-selection-wins.png") });
});

test("the graph keeps a legible view while the narration column opens and closes", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1534, height: 897 });
  await observeWorker(page);
  await runCheckout(page);
  const canvas = () => page.locator(".graph-canvas");
  // The top bar is one row at the supported baselines, so the graph area keeps its height.
  expect((await page.locator("header.top-bar").boundingBox())!.height).toBeLessThanOrEqual(64);
  // The side column narrows the canvas; the names stay legible and the view starts at the graph's start (#166).
  const fits = async (label: string, whole = false) => {
    const box = (await canvas().boundingBox())!;
    expect(box.height, `${label}: the graph canvas keeps a readable height`).toBeGreaterThan(240);
    expect((await expectLegibleView(page, label, { whole })).nodes).toBe(7);
  };
  await fits("no narration open", true);
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

test("responses and acknowledgements travel toward their destination, with the arrow leading", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(activityEvidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await observeWorker(page);
  await runCheckout(page);
  const before = await page.evaluate(() => window.workerEvidence.commands.map(command => command.type));

  // Request, horizontal link: leaves Customer App and waits mid-link, then arrives at Orders on the next record.
  await stepTo(page, "Request sent");
  let trail = await tokenPath(page);
  const app = await centre(page, nodeSelector("customer-app"));
  const orders = await centre(page, nodeSelector("orders"));
  expect(distance(trail.at(-1)!, orders), "a request moves toward the callee").toBeLessThan(distance(trail[0]!, orders));
  await headingAgreesWith(page, { x: trail.at(-1)!.x - trail[0]!.x, y: trail.at(-1)!.y - trail[0]!.y });
  const midLink = trail.at(-1)!;
  expect(midLink.x, "the departure rests between the two components").toBeGreaterThan(app.x);
  expect(midLink.x).toBeLessThan(orders.x);
  await stepTo(page, "Request delivered");
  trail = await tokenPath(page);
  // The arrival continues from where the departure stopped: one trip across the link, not two.
  expect(Math.abs(trail[0]!.x - midLink.x), "the arrival starts where the departure waited").toBeLessThan(30);
  expect(distance(trail.at(-1)!, orders)).toBeLessThan(distance(trail[0]!, orders));

  // Response, same link drawn the other way: it leaves Orders and moves toward Customer App.
  await stepTo(page, "Response sent");
  trail = await tokenPath(page);
  expect(distance(trail.at(-1)!, app), "a response moves toward the caller").toBeLessThan(distance(trail[0]!, app) - 20);
  expect(distance(trail.at(-1)!, orders), "a response moves away from the responder").toBeGreaterThan(distance(trail[0]!, orders) + 20);
  await headingAgreesWith(page, { x: trail.at(-1)!.x - trail[0]!.x, y: trail.at(-1)!.y - trail[0]!.y });
  await expect(page.locator("[data-flight-token]")).toHaveAttribute("data-flight-direction", "reverse");
  await page.screenshot({ path: path.join(activityEvidenceDir, "1600x1000-response-toward-caller.png") });

  // Acknowledgement, vertical subscription link: it leaves Payments and moves up toward the topic.
  await stepTo(page, "Message acknowledged");
  trail = await tokenPath(page);
  const topic = await centre(page, nodeSelector("OrderCreated"));
  const payments = await centre(page, nodeSelector("payments"));
  expect(distance(trail.at(-1)!, topic), "an acknowledgement moves toward the MessageBus").toBeLessThan(distance(trail[0]!, topic) - 20);
  expect(distance(trail.at(-1)!, payments)).toBeGreaterThan(distance(trail[0]!, payments) + 20);
  await headingAgreesWith(page, { x: trail.at(-1)!.x - trail[0]!.x, y: trail.at(-1)!.y - trail[0]!.y });
  await expect(narration(page)).toContainText("Payments → OrderCreated · MessageBus subscription");
  await page.screenshot({ path: path.join(activityEvidenceDir, "1600x1000-ack-toward-bus.png") });

  expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type)), "playback sends no worker command").toEqual(before);
});

test("components show idle, processing, or waiting from the records at the cursor", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(activityEvidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await observeWorker(page);
  await runCheckout(page);
  const status = async () => page.getByRole("status", { name: "Simulation status" }).innerText();
  // Virtual time, processed events, and pending events, as the status line states them.
  const counters = async () => page.locator(".run-summary").innerText();
  const recorded = { status: await status(), counters: await counters() };
  const node = (name: string) => page.getByRole("button", { name, exact: true });
  const badge = (id: string) => page.locator(`${nodeSelector(id)} .activity-badge`);

  // No cursor, no activity claim.
  await expect(page.locator(".activity-badge")).toHaveCount(0);

  await stepTo(page, "Request sent");
  await expect(badge("customer-app")).toContainText("Waiting · deadline t=1000");
  await expect(badge("orders")).toContainText("Idle");
  // The badge is the node's accessible description, and the state has a non-colour outline cue.
  await expect(node("Customer App, Client")).toHaveAttribute("aria-describedby", /activity-customer-app/);
  await expect(page.locator(nodeSelector("customer-app"))).toHaveClass(/activity-waiting/);

  await stepTo(page, "Request delivered");
  await expect(badge("orders")).toContainText("Processing");
  await expect(page.locator(nodeSelector("orders"))).toHaveClass(/activity-processing/);
  // The live region names what changed.
  await expect(page.locator("#movement-cue")).toContainText("Orders is processing a delivered request.");

  await stepTo(page, "Response received");
  await expect(badge("customer-app")).toContainText("Idle");

  // The processor's response is lost. Payments has recorded nothing, so it keeps waiting until its deadline.
  await stepTo(page, "Response dropped");
  await expect(badge("payments")).toContainText("Waiting · deadline t=1025");
  await expect(narration(page)).toContainText("Payments is waiting on Payment Processor with a recorded deadline at virtual time 1025");
  await page.screenshot({ path: path.join(activityEvidenceDir, "1600x1000-payments-waiting.png") });

  // The deadline passes: the position names the virtual-time jump, and Payments leaves waiting with a timeout cue.
  await stepTo(page, "Request timed out");
  await expect(position(page)).toContainText("Virtual time jumped t=55 → t=1025");
  await expect(badge("payments")).not.toContainText("Waiting");
  await expect(badge("payments")).toContainText("timed out t=1025");
  await expect(page.locator("#movement-cue")).toContainText("Its request to Payment Processor timed out at virtual time 1025.");
  await page.screenshot({ path: path.join(activityEvidenceDir, "1600x1000-payments-timed-out.png") });

  // Playback changed nothing in the run.
  expect({ status: await status(), counters: await counters() }).toEqual(recorded);
});

test("reduced motion shows the same direction and activity without animation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await runCheckout(page);
  await stepTo(page, "Response sent");
  const token = page.locator("[data-flight-token]");
  const heading = page.locator("[data-flight-heading]");
  for (const element of [token, heading]) {
    expect(await element.evaluate(item => getComputedStyle(item).animationName)).toBe("none");
  }
  // The token rests mid-link, and the arrowhead still points toward the caller.
  const rest = await centre(page, "[data-flight-token]");
  const app = await centre(page, nodeSelector("customer-app"));
  const orders = await centre(page, nodeSelector("orders"));
  expect(rest.x).toBeGreaterThan(app.x);
  expect(rest.x).toBeLessThan(orders.x);
  await headingAgreesWith(page, { x: app.x - orders.x, y: 0 });
  await expect(page.locator(`${nodeSelector("customer-app")} .activity-badge`)).toContainText("Waiting · deadline t=1000");
});

/** Nothing on the graph states a movement: the default after a fresh load. */
async function expectNoHighlight(page: Page, label: string) {
  await expect(page.locator(".react-flow__node.is-involved"), `${label}: no component is involved`).toHaveCount(0);
  await expect(page.locator(".react-flow__edge.is-movement, .react-flow__edge.is-involved-edge"), `${label}: no link is highlighted`).toHaveCount(0);
  await expect(page.locator("#movement-cue"), `${label}: the movement region is at its default`).toHaveText("No request or message movement is highlighted.");
}

/** A live cue is on the graph: at least one involved component and a movement region that names it. */
async function expectHighlight(page: Page, label: string) {
  await expect(page.locator(".react-flow__node.is-involved").first(), `${label}: a component is involved`).toBeVisible();
  await expect(page.locator("#movement-cue"), `${label}: the movement region names the movement`).not.toHaveText("No request or message movement is highlighted.");
}

test("Reset leaves no movement highlighted after a completed run or a Step (#189)", async ({ page }) => {
  test.setTimeout(180_000);
  const status = page.getByRole("status", { name: "Simulation status" });
  await runCheckout(page);
  await expectHighlight(page, "completed run");

  // Given a completed run whose last movement is highlighted, Reset clears it.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  await expectNoHighlight(page, "after Reset from COMPLETED");

  // Given a run paused after Step recorded a movement, Reset clears it.
  const step = page.getByRole("button", { name: "Step", exact: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await page.locator(".react-flow__node.is-involved").count() > 0) break;
    await step.click();
    await expect(status).toHaveText(/^(READY|PAUSED)$/);
  }
  await expectHighlight(page, "after Step");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  await expectNoHighlight(page, "after Reset from a Step");

  // A reset session highlights movements again, as on a first run.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  await expectHighlight(page, "run after Reset");
});

/** The graph's viewport transform, once two reads in a row agree (a reveal may animate). */
async function settledTransform(page: Page): Promise<string> {
  const read = () => page.locator(".react-flow__viewport").evaluate(element => (element as HTMLElement).style.transform);
  let previous = "";
  await expect.poll(async () => {
    const current = await read();
    const settled = current === previous && current !== "";
    previous = current;
    return settled;
  }, { intervals: [100, 150, 200] }).toBe(true);
  return previous;
}

/** Which nodes lie wholly inside the graph canvas, by node id. */
async function nodesInside(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".graph-canvas")!.getBoundingClientRect();
    return Object.fromEntries([...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => {
      const box = node.getBoundingClientRect();
      return [node.dataset.id!, box.left >= canvas.left - 0.5 && box.top >= canvas.top - 0.5 && box.right <= canvas.right + 0.5 && box.bottom <= canvas.bottom + 0.5];
    }));
  });
}

const involvedIds = (page: Page) => page.locator(".react-flow__node.is-involved").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id!));

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test(`every painted movement keeps both its components inside the canvas at ${viewport.width}x${viewport.height} (#190)`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await observeWorker(page);
    await runCheckout(page);
    const before = await page.evaluate(() => ({ commands: window.workerEvidence.commands.length, events: window.workerEvidence.events.length }));
    const next = page.getByRole("button", { name: "Next movement" });
    let kept = 0;
    for (let movement = 1; movement <= 13; movement += 1) {
      const transform = await settledTransform(page);
      const inside = await nodesInside(page);
      await next.click();
      await expect(position(page)).toContainText(`Movement ${movement} of 13 `);
      const after = await settledTransform(page);
      const ids = await involvedIds(page);
      expect(ids.length, `movement ${movement} paints its components`).toBeGreaterThan(0);
      const now = await nodesInside(page);
      for (const id of ids) expect(now[id], `movement ${movement}: ${id} is wholly inside the canvas`).toBe(true);
      const { smallestName } = await graphView(page);
      expect(smallestName, `movement ${movement}: component names stay legible`).toBeGreaterThanOrEqual(MIN_NAME_PX);
      // Components that were already on screen keep the reader's view (the first step opens the narration column).
      if (movement > 1 && ids.every(id => inside[id])) {
        expect(after, `movement ${movement}: the view is unchanged`).toBe(transform);
        kept += 1;
      }
    }
    expect(kept, "some movements stay within the current view").toBeGreaterThan(0);
    // The viewport is presentation: no command was sent and the worker published nothing new.
    expect(await page.evaluate(() => ({ commands: window.workerEvidence.commands.length, events: window.workerEvidence.events.length }))).toEqual(before);
    expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(["load", "run"]);
  });
}

test("Replay starts at the start: Previous movement is unavailable until a movement is selected (#191)", async ({ page }) => {
  test.setTimeout(180_000);
  await observeWorker(page);
  await runCheckout(page);
  const previous = page.getByRole("button", { name: "Previous movement" });
  const next = page.getByRole("button", { name: "Next movement" });
  await expect(position(page)).toHaveText("0 of 13 recorded movements. Nothing selected.");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  // Next selects the first movement, where Previous is still unavailable.
  await next.click();
  await expect(position(page)).toContainText("Movement 1 of 13 ");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(position(page)).toContainText("Movement 2 of 13 ");
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(position(page)).toContainText("Movement 1 of 13 ");
  await expect(page.getByRole("button", { name: "Play replay" })).toBeEnabled();
  expect(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type))).toEqual(["load", "run"]);
});

test("one recorded movement can be played and restarted (#192)", async ({ page }) => {
  test.setTimeout(180_000);
  await observeWorker(page);
  await loadScenario(page);
  const status = page.getByRole("status", { name: "Simulation status" });
  const step = page.getByRole("button", { name: "Step", exact: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await position(page).innerText()).startsWith("0 of 1 recorded movement.")) break;
    await step.click();
    await expect(status).toHaveText(/^(READY|PAUSED)$/);
  }
  await expect(position(page)).toHaveText("0 of 1 recorded movement. Nothing selected.");
  const play = page.getByRole("button", { name: "Play replay" });
  await expect(play).toBeEnabled();
  await expect(page.getByRole("button", { name: "Previous movement" })).toBeDisabled();
  await play.click();
  // The movement is painted with its narration, and playback ends there: the run is not recording.
  await expect(position(page)).toContainText("Movement 1 of 1 ");
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  await expect(narration(page)).toBeVisible();
  const restart = page.getByRole("button", { name: "Restart replay" });
  await expect(restart).toBeEnabled();
  // Restart paints the same movement again: its token is a new one.
  await page.locator("[data-flight-token]").evaluate(token => token.setAttribute("data-e2e-old", "true"));
  await restart.click();
  await expect(page.locator("[data-flight-token]")).toHaveCount(1);
  await expect(page.locator("[data-flight-token][data-e2e-old]")).toHaveCount(0);
  await expect(position(page)).toContainText("Movement 1 of 1 ");
  await expect(page.getByRole("button", { name: "Restart replay" })).toBeEnabled();
  expect(new Set(await page.evaluate(() => window.workerEvidence.commands.map(command => command.type)))).toEqual(new Set(["load", "step"]));
});
