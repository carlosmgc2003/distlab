/**
 * Lesson screenshots: what a student sees when a packaged lesson is loaded, after Run, and in
 * Recorded history, at one of the supported baselines and in one interface language.
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
 * It writes ‹lesson›-‹lang›-1-ready.png, -2-completed.png, -3-graph.png, and -4-history.png, and prints their paths.
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
  await page.locator(`[data-lesson-id="${lessonId}"]`).click();
  // The graph is laid out by ELK after React Flow measures it; until then the canvas is aria-busy.
  const canvas = page.locator(".graph-canvas");
  await canvas.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".graph-canvas")?.getAttribute("aria-busy") !== "true" && document.querySelectorAll(".react-flow__node").length > 0);
  await page.waitForTimeout(400);
  await shot("1-ready");
  await page.locator(".control-buttons button").first().click();
  await page.locator(".run-status").filter({ hasText: m.simulationControls.status.COMPLETED! }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot("2-completed");
  await shot("3-graph", ".graph-canvas");
  await page.locator("#tab-history").click();
  await page.waitForTimeout(600);
  await shot("4-history");
} finally {
  await browser.close();
  server.stop();
}
