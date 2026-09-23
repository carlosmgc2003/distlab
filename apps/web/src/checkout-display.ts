import type { ComponentNodeProjection } from "@distlab/contracts";

/** Lesson presentation copy from docs/spec/mvp-catalog-scenario.md, never simulation inputs.
 * Neither a publication declaration nor model-owned resource descriptions exist in the
 * architecture contract. Limit this supplemental copy to the shipped versioned lessons.
 */
const display = Object.freeze({
  "customer-app": Object.freeze({ model: "distlab.customer-app", kind: "client", title: "Customer App", resource: "Model-owned checkout request and outcome" }),
  orders: Object.freeze({ model: "distlab.orders", kind: "service", title: "Orders", resource: null }),
  payments: Object.freeze({ model: "distlab.payments", kind: "service", title: "Payments", resource: null }),
  "payment-processor": Object.freeze({ model: "distlab.payment-processor", kind: "external", title: "Payment Processor", resource: "Model-owned provider authorization ledger" }),
} as const);

export function checkoutDisplay(scenarioName: string | undefined, component: ComponentNodeProjection) {
  if (scenarioName !== "checkout-normal@1" && scenarioName !== "checkout-processor-response-lost@1") return undefined;
  const copy = display[component.id as keyof typeof display];
  return copy && component.version === "1.0.0" && component.model === copy.model && component.kind === copy.kind ? copy : undefined;
}
