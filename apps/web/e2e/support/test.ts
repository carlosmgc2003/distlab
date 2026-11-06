import { expect, test as base } from "@playwright/test";

/**
 * Every browser test imports `test` from here. Many specs replace
 * `window.Worker` to observe or fake the simulation worker. The architecture
 * view also starts a presentation worker for ELK layout; this auto fixture
 * makes sure that worker always gets the browser's own constructor, so a
 * simulation fixture never sees, records, or answers layout messages.
 */
export const test = base.extend<{ layoutWorkerPassThrough: void }>({
  layoutWorkerPassThrough: [async ({ page }, use) => {
    await page.addInitScript(() => {
      const Native = window.Worker;
      const isLayoutWorker = (url: unknown) => String(url).includes("elk-worker");
      const route = (Fixture: typeof Worker): typeof Worker => new Proxy(Fixture, {
        construct(target, args: [string | URL, WorkerOptions?], newTarget) {
          return isLayoutWorker(args[0]) ? new Native(...args) : Reflect.construct(target, args, newTarget);
        },
      });
      let current: typeof Worker = Native;
      Object.defineProperty(window, "Worker", {
        configurable: true,
        get: () => current,
        set: (value: typeof Worker) => { current = route(value); },
      });
    });
    await use();
  }, { auto: true }],
});

export { expect };
