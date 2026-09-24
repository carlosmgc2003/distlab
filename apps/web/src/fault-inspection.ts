import type { CanonicalValue, Observation, RuntimeProjectionSet, ScenarioDefinition } from "@distlab/contracts";
import { checkoutLesson } from "./scenarios.ts";

export interface RowFact {
  readonly table: string;
  readonly key: string;
  readonly fields: readonly { readonly name: string; readonly value: string }[];
}

export interface ServiceSnapshot {
  readonly lifecycle: string;
  readonly processGeneration: number;
  readonly revision: number;
  readonly rows: readonly RowFact[];
}

export interface PaymentFact {
  readonly paymentId: string;
  readonly orderId: string;
  readonly state: string;
  readonly outcome: string | null;
  readonly authorizationId: string | null;
}

export interface AuthorizationFact {
  readonly authorizationId: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly amount: number;
  readonly status: string;
}

export interface DeliveryFact {
  readonly messageId: string;
  readonly destination: string;
  readonly state: string;
  readonly attempt: number;
  readonly consumer: string | null;
}

export interface FaultFact {
  readonly id: string;
  readonly point: string;
  readonly effect: string;
  readonly name: string | null;
  readonly source: string | null;
  readonly target: string | null;
  readonly status: "recorded" | "selected";
}

export interface EvidenceLink {
  readonly label: string;
  readonly observationId: string;
  readonly type: string;
  readonly sequence: number;
  readonly time: number;
}

export interface FaultReport {
  readonly scenarioName: string;
  readonly seed: string;
  readonly lesson: string | null;
  readonly faults: readonly FaultFact[];
  readonly faultStatus: "not recorded" | "recorded" | "selected";
  readonly knowledge: string;
  readonly stagedNote: string;
  readonly studentFactsPresent: boolean;
  readonly orders: ServiceSnapshot | null;
  readonly paymentsService: ServiceSnapshot | null;
  readonly paymentRows: readonly PaymentFact[];
  readonly authorizations: readonly AuthorizationFact[];
  readonly deliveries: readonly DeliveryFact[];
  readonly clientRequest: string;
  readonly clientOutcome: string;
  readonly evidence: readonly EvidenceLink[];
}

const STAGED_NOTE = "No staged transaction is included. The rows below are committed.";
const TIMEOUT_BOUNDARY = "A network timeout is a missing response. It is not proof of denial or rollback.";

function isRecord(value: CanonicalValue): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function studentState(projection: RuntimeProjectionSet, componentId: string): Record<string, CanonicalValue> | null {
  const item = projection.components.find(entry => entry.visibility === "student" && entry.componentId === componentId);
  return item && isRecord(item.state) ? item.state : null;
}

function formatValue(value: CanonicalValue): string {
  if (value === null) return "none";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(item => formatValue(item)).join(", ");
  return Object.entries(value).map(([key, item]) => `${key} ${formatValue(item)}`).join(", ");
}

function rowsOf(tables: CanonicalValue): RowFact[] {
  if (!isRecord(tables)) return [];
  const facts: RowFact[] = [];
  for (const [table, rows] of Object.entries(tables)) {
    if (!isRecord(rows)) continue;
    for (const [key, row] of Object.entries(rows)) {
      facts.push({
        table, key, fields: isRecord(row)
          ? Object.entries(row).map(([name, value]) => ({ name, value: formatValue(value) }))
          : [],
      });
    }
  }
  facts.sort((left, right) => left.table < right.table ? -1 : left.table > right.table ? 1 : left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return facts;
}

function serviceSnapshot(state: Record<string, CanonicalValue> | null): ServiceSnapshot | null {
  if (!state || state.role !== "service") return null;
  const committedValue = state.committed;
  const committed = committedValue !== undefined && isRecord(committedValue) ? committedValue : null;
  const revision = committed?.revision;
  const tables = committed?.tables;
  return {
    lifecycle: typeof state.lifecycle === "string" ? state.lifecycle : "UNKNOWN",
    processGeneration: typeof state.processGeneration === "number" ? state.processGeneration : 0,
    revision: typeof revision === "number" ? revision : 0,
    rows: rowsOf(tables === undefined ? null : tables),
  };
}

function paymentRows(snapshot: ServiceSnapshot | null): PaymentFact[] {
  if (!snapshot) return [];
  const rows: PaymentFact[] = [];
  for (const row of snapshot.rows) {
    if (row.table !== "payments") continue;
    const field = (name: string) => row.fields.find(item => item.name === name)?.value ?? null;
    const paymentId = field("paymentId");
    const state = field("state");
    if (!paymentId || !state) continue;
    const outcome = field("outcome");
    const authorizationId = field("authorizationId");
    rows.push({
      paymentId, orderId: field("orderId") ?? "", state,
      outcome: outcome === "none" ? null : outcome,
      authorizationId: authorizationId === "none" ? null : authorizationId,
    });
  }
  return rows;
}

function authorizationsOf(state: Record<string, CanonicalValue> | null): AuthorizationFact[] {
  if (!state || state.role !== "external-visible" || !Array.isArray(state.authorizations)) return [];
  const facts: AuthorizationFact[] = [];
  for (const item of state.authorizations) {
    if (!isRecord(item) || typeof item.authorizationId !== "string" || typeof item.paymentId !== "string"
      || typeof item.orderId !== "string" || typeof item.amount !== "number" || typeof item.status !== "string") continue;
    facts.push({ authorizationId: item.authorizationId, paymentId: item.paymentId, orderId: item.orderId, amount: item.amount, status: item.status });
  }
  return facts;
}

function deliveriesOf(state: Record<string, CanonicalValue> | null): DeliveryFact[] {
  if (!state || state.role !== "bus-delivery" || !Array.isArray(state.records)) return [];
  const facts: DeliveryFact[] = [];
  for (const item of state.records) {
    if (!isRecord(item) || typeof item.messageId !== "string" || typeof item.destination !== "string"
      || typeof item.state !== "string" || typeof item.attempt !== "number") continue;
    facts.push({
      messageId: item.messageId, destination: item.destination, state: item.state, attempt: item.attempt,
      consumer: typeof item.consumer === "string" ? item.consumer : null,
    });
  }
  return facts;
}

function dataOf(observation: Observation): Record<string, CanonicalValue> | null {
  const data = observation.data;
  if (data === undefined || !isRecord(data)) return null;
  return data;
}

function selectedRules(observations: readonly Observation[]): Set<string> {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (observation.type !== "fault.effect.selected") continue;
    const ruleId = dataOf(observation)?.ruleId;
    if (typeof ruleId === "string") ids.add(ruleId);
  }
  return ids;
}

function lastObservation(observations: readonly Observation[], type: string, source?: string): Observation | undefined {
  let found: Observation | undefined;
  for (const observation of observations) {
    if (observation.type === type && (source === undefined || observation.source === source)) found = observation;
  }
  return found;
}

function faultSelection(observations: readonly Observation[], ruleId: string): Observation | undefined {
  let found: Observation | undefined;
  for (const observation of observations) {
    if (observation.type === "fault.effect.selected" && dataOf(observation)?.ruleId === ruleId) found = observation;
  }
  return found;
}

function link(label: string, observation: Observation | undefined): EvidenceLink | null {
  if (!observation) return null;
  return { label, observationId: observation.id, type: observation.type, sequence: observation.sequence, time: observation.time };
}

function knowledge(studentFactsPresent: boolean, payments: readonly PaymentFact[], authorizations: readonly AuthorizationFact[]): string {
  if (!studentFactsPresent) {
    return `No student-visible checkout facts were projected. Host-only component state stays hidden. ${TIMEOUT_BOUNDARY}`;
  }
  const remote = authorizations.length
    ? authorizations.map(item => `${item.authorizationId} ${item.status}`).join(", ")
    : "no authorization";
  const local = payments.length
    ? payments.map(row => `payment ${row.paymentId} committed ${row.state} with outcome ${row.outcome ?? "none"} and local authorization ID ${row.authorizationId ?? "none"}`).join("; ")
    : "No payment row is committed yet";
  const timeout = payments.some(row => row.outcome === "NETWORK_TIMEOUT");
  const agreed = payments.some(row => row.authorizationId !== null && authorizations.some(item => item.authorizationId === row.authorizationId));
  const relation = timeout
    ? "Payments' timeout and the processor ledger are different facts."
    : agreed
      ? "The local authorization ID matches a visible processor authorization."
      : "Local payment state and the processor ledger are shown as separate facts.";
  return `${local}. The Payment Processor visible ledger shows ${remote}. ${relation} ${TIMEOUT_BOUNDARY}`;
}

/** Read-only lesson view. Host-visibility state is ignored. */
export function inspectFaults(projection: RuntimeProjectionSet, scenario: ScenarioDefinition): FaultReport {
  const observations = projection.history.observations;
  const studentFactsPresent = projection.components.some(item => item.visibility === "student");
  const selected = selectedRules(observations);
  const faults: FaultFact[] = scenario.faults.map(fault => ({
    id: fault.id,
    point: fault.point,
    effect: fault.effect.kind,
    name: fault.name ?? null,
    source: fault.source ?? null,
    target: fault.target ?? null,
    status: selected.has(fault.id) ? "selected" : "recorded",
  }));
  const faultStatus = faults.length === 0 ? "not recorded" : faults.every(fault => fault.status === "selected") ? "selected" : "recorded";
  const orders = serviceSnapshot(studentState(projection, "orders"));
  const paymentsService = serviceSnapshot(studentState(projection, "payments"));
  const paymentRowsFound = paymentRows(paymentsService);
  const authorizations = authorizationsOf(studentState(projection, "payment-processor"));
  const client = studentState(projection, "customer-app");
  const evidence = [
    ...faults.map(fault => link("Show fault selection", faultSelection(observations, fault.id))),
    link("Show dropped processor response", lastObservation(observations, "network.response.dropped")),
    link("Show processor authorization", lastObservation(observations, "external.effect.committed", "payment-processor")),
    link("Show Payments timeout", lastObservation(observations, "network.request.timedout", "payments")),
    link("Show bus acknowledgement", lastObservation(observations, "message.acknowledged")),
    link("Show Orders lifecycle", lastObservation(observations, "service.lifecycle.changed", "orders")),
    link("Show Payments lifecycle", lastObservation(observations, "service.lifecycle.changed", "payments")),
  ].filter((item): item is EvidenceLink => item !== null);
  const lesson = scenario.name === "checkout-normal@1" ? checkoutLesson.normal.explanation
    : scenario.name === "checkout-processor-response-lost@1" ? checkoutLesson["response-lost"].explanation
      : null;
  return {
    scenarioName: scenario.name,
    seed: scenario.seed,
    lesson,
    faults,
    faultStatus,
    knowledge: knowledge(studentFactsPresent, paymentRowsFound, authorizations),
    stagedNote: STAGED_NOTE,
    studentFactsPresent,
    orders,
    paymentsService,
    paymentRows: paymentRowsFound,
    authorizations,
    deliveries: deliveriesOf(studentState(projection, "OrderCreated")),
    clientRequest: client && client.role === "client-observed" ? formatValue(client.request ?? null) : "not projected",
    clientOutcome: client && client.role === "client-observed" ? formatValue(client.outcome ?? null) : "not projected",
    evidence,
  };
}
