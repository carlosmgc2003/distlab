import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";

export const MvpCatalogModels = {
  CustomerApp: "distlab.customer-app",
  Orders: "distlab.orders",
  Payments: "distlab.payments",
  PaymentProcessor: "distlab.payment-processor",
} as const;

export const MvpCatalogVersions = {
  CustomerApp: "1.0.0",
  Orders: "1.0.0",
  Payments: "1.0.0",
  PaymentProcessor: "1.0.0",
} as const;

export const OrderCreatedDestination = "OrderCreated" as const;
export const CheckoutResponseLostScenarioId = "checkout-processor-response-lost@1" as const;

export interface CheckoutRequest {
  readonly cartId: string;
  readonly customerId: string;
  readonly amount: number;
}

export interface OrderCreatedMessage {
  readonly orderId: string;
  readonly customerId: string;
  readonly amount: number;
}

export type OrderState = "CREATED";
export type PaymentState = "AUTHORIZING" | "AUTHORIZED" | "UNKNOWN";

export interface MvpComponentVersion {
  readonly componentId: ComponentId;
  readonly model: (typeof MvpCatalogModels)[keyof typeof MvpCatalogModels];
  readonly version: "1.0.0";
}

export interface ReferenceAssertionDefinition {
  readonly id: string;
  readonly description: string;
  readonly parameters: CanonicalValue;
}

export const CheckoutResponseLostAssertions: readonly ReferenceAssertionDefinition[] = [
  {
    id: "order-created-once",
    description: "An order is created exactly once.",
    parameters: null,
  },
  {
    id: "order-created-published-once",
    description: "OrderCreated is published exactly once.",
    parameters: { destination: OrderCreatedDestination },
  },
  {
    id: "processor-authorized-once",
    description: "The processor ledger contains one approved authorization.",
    parameters: null,
  },
  {
    id: "payments-unknown-after-timeout",
    description: "Payments records UNKNOWN after the lost processor response.",
    parameters: null,
  },
  {
    id: "disagreement-inspectable",
    description: "Provider and Payments projections expose the disagreement.",
    parameters: null,
  },
  {
    id: "reproducible-run",
    description: "Equal inputs and seed reproduce history and results.",
    parameters: null,
  },
] as const;
