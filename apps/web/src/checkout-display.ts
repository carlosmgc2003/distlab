import type { ComponentNodeProjection } from "@distlab/contracts";
import type { Messages } from "./i18n/catalog.ts";

/** Lesson presentation copy from docs/spec/mvp-catalog-scenario.md, never simulation inputs.
 * Neither a publication declaration nor model-owned resource descriptions exist in the
 * architecture contract. Limit this supplemental copy to the shipped versioned lessons.
 * Titles and resource lines come from the catalog (`m.faultInspection`); `Orders` and `Payments`
 * are component names, the capitalized IDs, and stay as they are.
 */
const display = Object.freeze({
  "customer-app": Object.freeze({ model: "distlab.customer-app", kind: "client" }),
  orders: Object.freeze({ model: "distlab.orders", kind: "service" }),
  payments: Object.freeze({ model: "distlab.payments", kind: "service" }),
  "payment-processor": Object.freeze({ model: "distlab.payment-processor", kind: "external" }),
} as const);

export interface CheckoutDisplay {
  readonly model: string;
  readonly kind: string;
  readonly title: string;
  readonly resource: string | null;
}

function copyOf(id: keyof typeof display, m: Messages): Pick<CheckoutDisplay, "title" | "resource"> {
  switch (id) {
    case "customer-app": return { title: m.faultInspection.names.customerApp, resource: m.faultInspection.resources.request };
    case "orders": return { title: m.faultInspection.names.orders, resource: null };
    case "payments": return { title: m.faultInspection.names.payments, resource: null };
    case "payment-processor": return { title: m.faultInspection.names.processor, resource: m.faultInspection.resources.ledger };
  }
}

export function checkoutDisplay(scenarioName: string | undefined, component: ComponentNodeProjection, m: Messages): CheckoutDisplay | undefined {
  if (scenarioName !== "checkout-normal@1" && scenarioName !== "checkout-processor-response-lost@1") return undefined;
  const base = display[component.id as keyof typeof display];
  return base && component.version === "1.0.0" && component.model === base.model && component.kind === base.kind
    ? { ...base, ...copyOf(component.id as keyof typeof display, m) } : undefined;
}
