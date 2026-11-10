import type {
  AssessmentDefinition, AssessmentRow, CanonicalValue, Duration, FaultEffect, FaultPoint, LessonOverlayPolicy, LessonParameter, SimulationTime,
} from "@distlab/contracts";
import type { CommerceCheck } from "./scenarios.js";

/**
 * Reliable Checkout (docs/spec/assessment.md, #97): the fault-free base lesson
 * of the Reliable Checkout assessment, its overlay policy, its check
 * classification, and the packaged assessment definition. Data only, like the
 * lesson modules, so the browser view (#97 step 3) can name them.
 *
 * Catalog only for now: it is not one of the packaged lessons the host accepts
 * or the Lesson chooser lists. The worker and the chooser pick it up with the
 * assessment view.
 */

/** The packaged scenario name, which assessment definitions name as their `base`. */
export const reliableCheckoutName = "reliable-checkout@1";

/** Virtual time of the late relay request, the deadline checks, and the crash row's crash. */
export const reliableCheckoutTimes = Object.freeze({ checkout: 1, relay: 100, deadline: 200, crash: 12, restartAfter: 20, providerBack: 60 });

const component = (id: string, model: string, kind = "service", configuration: Record<string, CanonicalValue> = {}) =>
  ({ id, model: `commerce.${model}`, kind, version: "1.0.0", configuration });
const link = (source: string, target: string, timeout: number) =>
  ({ source, target, policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout, failureRate: 0 } });
const database = (owner: string, names: string[]) =>
  ({ owner, tables: names.map(name => ({ name, unique: [], checks: [] })), initial: Object.fromEntries(names.map(name => [name, {}])) });
const request = (id: string, at: number, endpoint: string, body: Record<string, CanonicalValue>) =>
  ({ id, at, kind: "client", target: "client", action: "request", data: { target: "orders", endpoint, body, retry: false, label: id } });

/**
 * The defaults are the unsafe design (D-2): no retries, no idempotency key, no
 * compensation, no outbox, no consumer inbox. Every link and destination
 * timing is fixed so that a design choice never moves the crash row's crash
 * out of the gap between the confirming commit and publication.
 */
export const reliableCheckoutScenario: CanonicalValue = Object.freeze({
  version: 1, name: reliableCheckoutName, seed: "reliable-checkout-1", startTime: 0,
  configuration: { startTime: 0, historyLimit: 100000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
  architecture: {
    components: [
      component("client", "client", "client"),
      component("orders", "reliable-orders", "service", { compensate: false, outbox: false }),
      component("inventory", "reliable-inventory"),
      component("payments", "reliable-payments", "service", { retries: 0, idempotent: false }),
      component("payment-processor", "reliable-processor", "external"),
      component("notifications", "reliable-notifications", "service", { idempotent: false }),
      component("messaging", "messaging-provider", "external"),
    ],
    links: [
      // Orders waits for every payment retry (up to 4 attempts of 10 ms); the client waits for the whole saga.
      link("client", "orders", 120), link("orders", "inventory", 20), link("orders", "payments", 60),
      link("payments", "payment-processor", 10), link("notifications", "messaging", 10),
    ],
    databases: [database("orders", ["orders", "outbox"]), database("inventory", ["reservations"]), database("payments", ["payments"]), database("notifications", ["notifications", "inbox"])],
    stores: [],
    destinations: [{ id: "OrderConfirmed", kind: "topic", deliveryDelay: 1, ackTimeout: 20, retryDelay: 10, maxAttempts: 10, capacity: 100 }],
    subscriptions: [{ destination: "OrderConfirmed", consumer: "notifications" }],
  },
  external: [],
  // The base lesson carries no fault: the assessment rows are the faults (ADR-004 consequence 1).
  faults: [],
  actions: [
    ...["orders", "inventory", "payments", "notifications"].map(target => ({ id: `start-${target}`, at: 0, kind: "service", target, state: "RUNNING" })),
    request("checkout", reliableCheckoutTimes.checkout, "POST /checkout", { orderId: "order-1" }),
    // Publishes unsent outbox events; with no outbox, or nothing unsent, it does nothing.
    request("relay", reliableCheckoutTimes.relay, "POST /relay", {}),
  ],
  assertions: [
    { id: "charged-at-most-once", predicate: "commerce.charges", mode: "always", parameters: { processor: "payment-processor", maximum: 1 } },
    { id: "failed-order-uncharged", predicate: "commerce.unconfirmed-charges", mode: "at", at: reliableCheckoutTimes.deadline,
      parameters: { processor: "payment-processor", owner: "orders", table: "orders" } },
    // The provider's sent list only grows, so a check at the deadline also catches any earlier second send.
    { id: "notified-exactly-once", predicate: "commerce.notifications", mode: "at", at: reliableCheckoutTimes.deadline,
      parameters: { provider: "messaging", owner: "orders", table: "orders" } },
    { id: "order-final", predicate: "commerce.final-orders", mode: "at", at: reliableCheckoutTimes.deadline,
      parameters: { owner: "orders", table: "orders", states: ["CONFIRMED", "CANCELLED"] } },
  ],
}) as CanonicalValue;

/** Each assertion is a business invariant: the suite judges designs, not the lesson's setup. */
export const reliableCheckoutChecks: readonly CommerceCheck[] = Object.freeze([
  { id: "charged-at-most-once", kind: "invariant", label: "The customer is charged at most once" },
  { id: "failed-order-uncharged", kind: "invariant", label: "A failed order keeps no charge" },
  { id: "notified-exactly-once", kind: "invariant", label: "A confirmed order is notified exactly once" },
  { id: "order-final", kind: "invariant", label: "Every order reaches a final state" },
]);

const flag = (key: string, component: string, field: string): LessonParameter =>
  ({ key, domain: { type: "boolean", default: false }, targets: [{ kind: "component", component, field }] });
const network: { point: FaultPoint; effects: FaultEffect["kind"][] }[] = [
  { point: "network.request", effects: ["delay", "drop", "disconnect"] },
  { point: "network.response", effects: ["delay", "drop"] },
  { point: "message.delivery", effects: ["delay", "drop", "duplicate"] },
  { point: "database.commit", effects: ["fail"] },
];

/**
 * The five design choices (D-2) and every fault kind the rows use. A row holds
 * at most two entries, so `maxEntries` leaves room for the student's own
 * faults if a later increment allows them (D-6).
 */
export const reliableCheckoutOverlayPolicy: LessonOverlayPolicy = Object.freeze({
  version: 1, lesson: reliableCheckoutName,
  faults: { rules: network, scheduled: ["crash", "external-availability"], maxEntries: 4 },
  parameters: [
    { key: "retries", domain: { type: "integer", default: 0, minimum: 0, maximum: 3 }, targets: [{ kind: "component", component: "payments", field: "retries" }] },
    flag("idempotency", "payments", "idempotent"),
    flag("compensation", "orders", "compensate"),
    flag("outbox", "orders", "outbox"),
    flag("consumer-idempotency", "notifications", "idempotent"),
  ],
}) as LessonOverlayPolicy;

const at = (value: number) => value as SimulationTime;
const rule = (id: string, point: FaultPoint, source: string, target: string, name: string, effect: FaultEffect): AssessmentRow["faults"][number] =>
  ({ id, point, source, target, name, from: at(0), probability: 1, maxApplications: 1, effect });
const availability = (id: string, time: number, state: "UNAVAILABLE" | "AVAILABLE"): AssessmentRow["scheduledFaults"][number] =>
  ({ id, at: at(time), kind: "fault", fault: { id: `${id}-fault`, kind: "external-availability", target: "messaging", state } });

/** The six rows of vision §21, run in this order. Row fault IDs keep the student prefix (D-3). */
export const reliableCheckoutAssessment: AssessmentDefinition = Object.freeze({
  version: 1,
  id: "reliable-checkout-assessment@1",
  title: "Reliable Checkout",
  requirements: [
    "Services own independent state.",
    "A customer must not be charged twice.",
    "Inventory may temporarily fail.",
    "Payment Processor may return an ambiguous timeout.",
    "Messaging Provider may be unavailable.",
    "Distributed transactions are forbidden.",
    "The system must eventually reach a valid business state.",
  ],
  base: reliableCheckoutName,
  rows: [
    { id: "happy-path", label: "Happy path", faults: [], scheduledFaults: [] },
    { id: "duplicate-order-confirmed", label: "Duplicate OrderConfirmed", scheduledFaults: [], faults: [
      rule("student-row-duplicate-order-confirmed", "message.delivery", "orders", "notifications", "OrderConfirmed",
        { kind: "duplicate", additionalCopies: 1, spacing: 5 as Duration }),
    ] },
    { id: "inventory-unavailable", label: "Inventory unavailable", scheduledFaults: [], faults: [
      rule("student-row-inventory-unavailable", "network.request", "orders", "inventory", "POST /reserve", { kind: "drop" }),
    ] },
    { id: "processor-response-lost", label: "Processor response lost", scheduledFaults: [], faults: [
      rule("student-row-lost-response", "network.response", "payment-processor", "payments", "POST /authorize", { kind: "drop" }),
    ] },
    { id: "notification-provider-down", label: "Notification provider down", faults: [], scheduledFaults: [
      availability("student-row-provider-down", 0, "UNAVAILABLE"),
      availability("student-row-provider-back", reliableCheckoutTimes.providerBack, "AVAILABLE"),
    ] },
    { id: "crash-after-local-commit", label: "Crash after local commit", faults: [], scheduledFaults: [
      { id: "student-row-orders-crash", at: at(reliableCheckoutTimes.crash), kind: "fault",
        fault: { id: "student-row-orders-crash-fault", kind: "crash", target: "orders" },
        restart: { after: reliableCheckoutTimes.restartAfter as Duration } },
    ] },
  ],
  invariants: reliableCheckoutChecks.map(({ id, label }) => ({ id, label })),
}) as AssessmentDefinition;

/** Every packaged assessment definition. */
export const assessmentDefinitions: readonly AssessmentDefinition[] = Object.freeze([reliableCheckoutAssessment]);
