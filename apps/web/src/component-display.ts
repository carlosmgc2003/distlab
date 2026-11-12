import type { ComponentNodeProjection } from "@distlab/contracts";

import { checkoutDisplay } from "./checkout-display.ts";

/**
 * Display names of the packaged commerce catalog's components (#103). Presentation copy only:
 * the worker keeps publishing `label: id`, and no simulation input, projection, or command
 * reads these names. Destinations (topics and queues) keep their IDs, which are event names.
 */
export const commerceComponentNames: Readonly<Record<string, string>> = Object.freeze({
  client: "Customer App",
  "customer-app": "Customer App",
  "partner-api": "Partner API",
  backoffice: "Backoffice",
  scheduler: "Scheduler",
  "editor-eu": "Editor (EU)",
  "editor-us": "Editor (US)",
  orders: "Orders",
  payments: "Payments",
  inventory: "Inventory",
  notifications: "Notifications",
  reporting: "Reporting",
  catalog: "Catalog",
  cart: "Cart",
  storage: "Storage",
  api: "API",
  kv: "Key-Value Store",
  "worker-1": "Worker 1",
  "worker-2": "Worker 2",
  eu: "Region EU",
  us: "Region US",
  carrier: "Shipping Carrier",
  messaging: "Messaging Provider",
  risk: "Risk Provider",
  "payment-processor": "Payment Processor",
});

/**
 * Which copy names a session's components. Names apply to packaged sessions only: the two
 * checkout lessons keep `checkout-display.ts`, and the commerce lessons and the Reliable
 * Checkout assessment's base lesson use the table above. An imported scenario document shows
 * the IDs its author wrote, even when it was saved from a packaged lesson.
 */
export type ComponentNaming =
  | { readonly source: "checkout"; readonly scenarioName: string | undefined }
  | { readonly source: "commerce" }
  | { readonly source: "imported" };

/** Display name by component ID. An ID without an entry is shown as the ID. */
export type ComponentNames = ReadonlyMap<string, string>;

export const NO_COMPONENT_NAMES: ComponentNames = new Map();

/** The display names of one session's components. Pure: it reads the naming and the projected components only. */
export function componentNames(naming: ComponentNaming, components: readonly ComponentNodeProjection[]): ComponentNames {
  const names = new Map<string, string>();
  for (const component of components) {
    // A destination's name is its event name, so it is never renamed.
    if (component.kind === "infrastructure") continue;
    const name = naming.source === "checkout" ? checkoutDisplay(naming.scenarioName, component)?.title
      : naming.source === "commerce" && Object.hasOwn(commerceComponentNames, component.id) ? commerceComponentNames[component.id]
      : undefined;
    if (name !== undefined) names.set(component.id, name);
  }
  return names;
}

/** The one resolver every presentation uses: the display name, or the ID when it has none. */
export function displayName(names: ComponentNames | undefined, id: string): string {
  return names?.get(id) ?? id;
}
