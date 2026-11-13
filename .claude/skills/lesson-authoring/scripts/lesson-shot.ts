/**
 * Lesson screenshots: what a student sees of a packaged lesson, from its card in the Lesson chooser
 * to the evidence of a check, at one of the supported baselines and in one interface language.
 *
 * Read-only. It drives the production build the way the browser tests do, with selectors that do
 * not depend on the language. It serves `apps/web/dist` itself unless `--url` names a running app.
 *
 * Usage, from the repository root:
 *
 *   npm run build
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts lease-unfenced
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts lease-unfenced --lang es --size 1534x897
 *
 * Options:
 *   --lang es        interface language (default en)
 *   --size WxH       viewport (default 1366x768, the smaller supported baseline)
 *   --scale 2        device scale factor; use 2 for an image a person will look at (default 1)
 *   --out <dir>      output directory (default: lesson-shots/ under the system temp directory)
 *   --url <base>     use an app that is already running, such as `npm run dev` on http://127.0.0.1:5173
 *
 * It writes nine images named ‹lesson›-‹lang›-‹n›-‹what›.png and prints their paths:
 *   1-chooser        the lesson's card in the Lesson chooser
 *   2-ready          the lesson loaded: ① Goal and the graph
 *   3-completed      after Run: the verdicts in ③ Investigate
 *   4-graph          the canvas alone
 *   5-service-state  the Service state dialog
 *   6-history        Recorded history, Story diagram (its first columns)
 *   7-story-table    Recorded history, Story table (its first rows; lesson-sheet.ts prints all of them)
 *   8-evidence       Show evidence on the first violated check, or on the first check
 *   9-experiment     the Experiment drawer: the lesson's design choices and the faults it allows
 * If Chromium is not installed for the project's Playwright, set PLAYWRIGHT_CHROMIUM_EXECUTABLE or
 * run `npm run browser:install`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { messages } from "../../../../apps/web/src/i18n/catalog.ts";
import { isLocale } from "../../../../apps/web/src/i18n/locales.ts";
import { scenarios } from "../../../../apps/web/src/scenarios.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const valued = ["--lang", "--size", "--scale", "--out", "--url"];
const lessonId = args.find((arg, index) => !arg.startsWith("--") && !valued.includes(args[index - 1] ?? ""));
const lang = option("--lang") ?? "en";
const [width, height] = (option("--size") ?? "1366x768").split("x").map(Number) as [number, number];
const scale = Number(option("--scale") ?? 1);
const out = resolve(option("--out") ?? join(tmpdir(), "lesson-shots"));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PORT = 4179;

if (!scenarios.some(lesson => lesson.id === lessonId) || !isLocale(lang) || !width || !height) {
  console.error("Usage: node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts <lesson> [--lang es] [--size 1366x768] [--scale 2] [--out <dir>] [--url <base>]");
  process.exit(1);
}
const m = messages(lang);

async function reachable(url: string): Promise<boolean> {
  try { return (await fetch(url)).ok; } catch { return false; }
}

/** Serves the production build, as the Playwright suite does, and resolves once it answers. */
async function preview(): Promise<{ url: string; stop: () => void }> {
  if (!existsSync(join(root, "apps/web/dist/index.html"))) throw new Error("apps/web/dist is missing. Run `npm run build` first, or pass --url for a running app.");
  const url = `http://127.0.0.1:${PORT}`;
  const server = spawn(join(root, "node_modules/.bin/vite"), ["preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: join(root, "apps/web"), stdio: "ignore" });
  for (let attempt = 0; attempt < 100 && !(await reachable(url)); attempt++) await new Promise(done => setTimeout(done, 100));
  if (!(await reachable(url))) { server.kill(); throw new Error(`The preview server did not start on port ${PORT}.`); }
  return { url, stop: () => server.kill() };
}

const given = option("--url");
const server = given ? { url: given.replace(/\/$/, ""), stop: () => {} } : await preview();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  const shot = async (name: string, element?: string) => {
    const path = join(out, `${lessonId}-${lang}-${name}.png`);
    if (element) await page.locator(element).screenshot({ path });
    else await page.screenshot({ path });
    console.log(path);
  };
  await page.goto(`${server.url}/?lang=${lang}`);
  await page.locator(".lesson-trigger").click();
  const card = page.locator(`[data-lesson-id="${lessonId}"]`);
  await card.scrollIntoViewIfNeeded();
  await shot("1-chooser");
  await card.click();
  // The graph is laid out by ELK after React Flow measures it; until then the canvas is aria-busy.
  const canvas = page.locator(".graph-canvas");
  await canvas.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".graph-canvas")?.getAttribute("aria-busy") !== "true" && document.querySelectorAll(".react-flow__node").length > 0);
  await page.waitForTimeout(400);
  await shot("2-ready");
  await page.locator(".control-buttons button").first().click();
  await page.locator(".run-status").filter({ hasText: m.simulationControls.status.COMPLETED! }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot("3-completed");
  await shot("4-graph", ".graph-canvas");
  const serviceState = page.locator(".show-service-state");
  if (await serviceState.count()) {
    await serviceState.click();
    await page.locator(".service-state-dialog").waitFor({ state: "visible" });
    await shot("5-service-state");
    await page.locator(".service-state-close").click();
  }
  await page.locator("#tab-history").click();
  await page.waitForTimeout(600);
  await shot("6-history");
  await page.locator(".timeline-view-switch button").nth(1).click();
  await page.waitForTimeout(400);
  await shot("7-story-table");
  // Show evidence: a commerce check's button, or a checkout lesson's evidence link.
  const violated = page.locator(".lesson-check.is-violated button");
  const evidence = (await violated.count()) ? violated.first() : page.locator(".lesson-check button, .evidence-links button").first();
  if (await evidence.count()) {
    await evidence.click();
    await page.waitForTimeout(600);
    await shot("8-evidence");
  }
  const experiment = page.locator(".experiment-trigger");
  if (await experiment.count()) {
    await page.locator("#tab-architecture").click();
    await experiment.scrollIntoViewIfNeeded();
    if (await experiment.getAttribute("aria-expanded") !== "true") await experiment.click();
    await page.locator("#experiment-drawer").waitFor({ state: "visible" });
    await page.waitForTimeout(400);
    await shot("9-experiment");
  }
} finally {
  await browser.close();
  server.stop();
}
