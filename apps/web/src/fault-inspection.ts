import type { CanonicalValue, Observation, RuntimeProjectionSet, ScenarioDefinition } from "@distlab/contracts";
import { checkoutLesson } from "./scenarios.ts";
import type { Messages } from "./i18n/catalog.ts";

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

export type FaultStatus = "not-recorded" | "recorded" | "selected";

/** The display label of a fault status code. */
export function faultStatusLabel(status: FaultStatus, m: Messages): string {
  return m.faultInspection.status[status];
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

/**
 * Which component plays each checkout role. Read from the architecture projection's
 * versioned models, never from fixed component IDs, so an imported checkout document
 * with other IDs shows the same facts (ADR-006).
 */
export interface CheckoutRoles {
  readonly client: string | null;
  readonly orders: string | null;
  readonly payments: string | null;
  readonly processor: string | null;
  /** Every MessageBus destination with student-visible delivery records. */
  readonly destinations: readonly string[];
}

export interface FaultReport {
  readonly roles: CheckoutRoles;
  readonly scenarioName: string;
  readonly seed: string;
  readonly lesson: string | null;
  readonly faults: readonly FaultFact[];
  /** A code; `faultStatusLabel` words it. */
  readonly faultStatus: FaultStatus;
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

function isRecord(value: CanonicalValue): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function studentState(projection: RuntimeProjectionSet, componentId: string): Record<string, CanonicalValue> | null {
  const item = projection.components.find(entry => entry.visibility === "student" && entry.componentId === componentId);
  return item && isRecord(item.state) ? item.state : null;
}

/** Display text for a value. A null stays null in the data; it is worded here, at display, and never read back. */
function formatValue(value: CanonicalValue, m: Messages): string {
  if (value === null) return m.faultInspection.none;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(item => formatValue(item, m)).join(", ");
  return Object.entries(value).map(([key, item]) => `${key} ${formatValue(item, m)}`).join(", ");
}

function rowsOf(tables: CanonicalValue, m: Messages): RowFact[] {
  if (!isRecord(tables)) return [];
  const facts: RowFact[] = [];
  for (const [table, rows] of Object.entries(tables)) {
    if (!isRecord(rows)) continue;
    for (const [key, row] of Object.entries(rows)) {
      facts.push({
        table, key, fields: isRecord(row)
          ? Object.entries(row).map(([name, value]) => ({ name, value: formatValue(value, m) }))
          : [],
      });
    }
  }
  facts.sort((left, right) => left.table < right.table ? -1 : left.table > right.table ? 1 : left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return facts;
}

function serviceSnapshot(state: Record<string, CanonicalValue> | null, m: Messages): ServiceSnapshot | null {
  if (!state || state.role !== "service") return null;
  const committedValue = state.committed;
  const committed = committedValue !== undefined && isRecord(committedValue) ? committedValue : null;
  const revision = committed?.revision;
  const tables = committed?.tables;
  return {
    lifecycle: typeof state.lifecycle === "string" ? state.lifecycle : "UNKNOWN",
    processGeneration: typeof state.processGeneration === "number" ? state.processGeneration : 0,
    revision: typeof revision === "number" ? revision : 0,
    rows: rowsOf(tables === undefined ? null : tables, m),
  };
}

/** A scalar field as text, or null when the field is missing or null. Null is never worded and read back. */
function scalar(value: CanonicalValue | undefined, m: Messages): string | null {
  return value === undefined || value === null ? null : formatValue(value, m);
}

/** Payment rows read from the committed state itself, so a null field stays null and no display text is compared. */
function paymentRows(state: Record<string, CanonicalValue> | null, m: Messages): PaymentFact[] {
  const committedValue = state?.role === "service" ? state.committed ?? null : null;
  const committed = committedValue !== null && isRecord(committedValue) ? committedValue : null;
  const tablesValue = committed?.tables ?? null;
  const tables = tablesValue !== null && isRecord(tablesValue) ? tablesValue : null;
  const paymentsValue = tables?.payments ?? null;
  const payments = paymentsValue !== null && isRecord(paymentsValue) ? paymentsValue : null;
  if (!payments) return [];
  const rows: PaymentFact[] = [];
  for (const key of Object.keys(payments).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const row = payments[key];
    if (row === undefined || !isRecord(row)) continue;
    const paymentId = scalar(row.paymentId, m);
    const paymentState = scalar(row.state, m);
    if (!paymentId || !paymentState) continue;
    rows.push({
      paymentId, orderId: scalar(row.orderId, m) ?? "", state: paymentState,
      outcome: scalar(row.outcome, m), authorizationId: scalar(row.authorizationId, m),
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

function knowledge(studentFactsPresent: boolean, payments: readonly PaymentFact[], authorizations: readonly AuthorizationFact[], m: Messages): string {
  const copy = m.faultInspection.knowledge;
  if (!studentFactsPresent) return copy.sentences([copy.noFacts, copy.timeoutBoundary]);
  const processor = m.faultInspection.names.processor;
  const ledger = authorizations.length
    ? copy.ledger({ processor, list: m.fmt.list(authorizations.map(item => copy.authorization({ id: item.authorizationId, status: item.status }))) })
    : copy.emptyLedger(processor);
  const local = payments.length
    ? copy.localPayments(m.fmt.list(payments.map(row => copy.payment({
      id: row.paymentId, state: row.state, outcome: row.outcome ?? m.faultInspection.none, authorization: row.authorizationId ?? m.faultInspection.none,
    }))))
    : copy.noPayments;
  const timeout = payments.some(row => row.outcome === "NETWORK_TIMEOUT");
  const agreed = payments.some(row => row.authorizationId !== null && authorizations.some(item => item.authorizationId === row.authorizationId));
  const relation = timeout ? copy.timeoutDiffers : agreed ? copy.agreed : copy.separate;
  return copy.sentences([local, ledger, relation, copy.timeoutBoundary]);
}

function checkoutRoles(projection: RuntimeProjectionSet): CheckoutRoles {
  const byModel = (model: string) => projection.architecture.components.find(item => item.model === model)?.id ?? null;
  return {
    client: byModel("distlab.customer-app"),
    orders: byModel("distlab.orders"),
    payments: byModel("distlab.payments"),
    processor: byModel("distlab.payment-processor"),
    destinations: projection.components.filter(item => item.visibility === "student" && isRecord(item.state) && item.state.role === "bus-delivery").map(item => item.componentId),
  };
}

/** Read-only lesson view. Host-visibility state is ignored. */
export function inspectFaults(projection: RuntimeProjectionSet, scenario: ScenarioDefinition, m: Messages): FaultReport {
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
  const faultStatus: FaultStatus = faults.length === 0 ? "not-recorded" : faults.every(fault => fault.status === "selected") ? "selected" : "recorded";
  const roles = checkoutRoles(projection);
  const state = (id: string | null) => id === null ? null : studentState(projection, id);
  const orders = serviceSnapshot(state(roles.orders), m);
  const paymentsState = state(roles.payments);
  const paymentsService = serviceSnapshot(paymentsState, m);
  const paymentRowsFound = paymentRows(paymentsState, m);
  const authorizations = authorizationsOf(state(roles.processor));
  const client = state(roles.client);
  const evidence = [
    ...faults.map(fault => link(m.faultInspection.evidence.faultSelection, faultSelection(observations, fault.id))),
    link(m.faultInspection.evidence.droppedResponse, lastObservation(observations, "network.response.dropped")),
    roles.processor ? link(m.faultInspection.evidence.processorAuthorization, lastObservation(observations, "external.effect.committed", roles.processor)) : null,
    roles.payments ? link(m.faultInspection.evidence.paymentsTimeout, lastObservation(observations, "network.request.timedout", roles.payments)) : null,
    link(m.faultInspection.evidence.busAcknowledgement, lastObservation(observations, "message.acknowledged")),
    roles.orders ? link(m.faultInspection.evidence.ordersLifecycle, lastObservation(observations, "service.lifecycle.changed", roles.orders)) : null,
    roles.payments ? link(m.faultInspection.evidence.paymentsLifecycle, lastObservation(observations, "service.lifecycle.changed", roles.payments)) : null,
  ].filter((item): item is EvidenceLink => item !== null);
  const lesson = scenario.name === "checkout-normal@1" ? checkoutLesson.normal.explanation
    : scenario.name === "checkout-processor-response-lost@1" ? checkoutLesson["response-lost"].explanation
      : null;
  return {
    roles,
    scenarioName: scenario.name,
    seed: scenario.seed,
    lesson,
    faults,
    faultStatus,
    knowledge: knowledge(studentFactsPresent, paymentRowsFound, authorizations, m),
    stagedNote: m.faultInspection.stagedNote,
    studentFactsPresent,
    orders,
    paymentsService,
    paymentRows: paymentRowsFound,
    authorizations,
    deliveries: roles.destinations.flatMap(id => deliveriesOf(studentState(projection, id))),
    clientRequest: client && client.role === "client-observed" ? formatValue(client.request ?? null, m) : m.faultInspection.notProjected,
    clientOutcome: client && client.role === "client-observed" ? formatValue(client.outcome ?? null, m) : m.faultInspection.notProjected,
    evidence,
  };
}
