import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The one place browser tests choose a lesson (#139), so later layout changes touch only this helper.
 * Each lesson is a button carrying its packaged id, so tests do not depend on display titles.
 */

/** The top bar trigger: "Choose a lesson" before any load, then "Lesson: ‹title›". */
export function lessonTrigger(page: Page): Locator {
  return page.locator("header.command-toolbar").getByRole("button", { name: /^(Choose a lesson$|Lesson: )/ });
}

export function lessonChooser(page: Page): Locator {
  return page.getByRole("dialog", { name: "Choose a lesson", exact: true });
}

/** One lesson's button inside the open chooser. */
export function lessonChoice(page: Page, id: string): Locator {
  return lessonChooser(page).locator(`[data-lesson-id="${id}"]`);
}

/**
 * Opens the Lesson chooser and chooses the packaged lesson `id`, which loads it. It waits for the
 * dialog to close, not for READY, so tests with a fixture worker can answer the load themselves.
 */
export async function loadLesson(page: Page, id: string): Promise<void> {
  await lessonTrigger(page).click();
  await expect(lessonChooser(page)).toBeVisible();
  await lessonChoice(page, id).click();
  await expect(lessonChooser(page)).toBeHidden();
}

/**
 * The architecture graph is laid out by ELK after React Flow measures it, then fitted to the canvas.
 * Until both are done the canvas is aria-busy and its nodes are hidden. Geometry checks wait for this.
 */
export async function graphLaidOut(page: Page): Promise<void> {
  const canvas = page.locator(".graph-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
}
