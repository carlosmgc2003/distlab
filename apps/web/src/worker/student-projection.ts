import type { CanonicalValue, ComponentStateProjection } from "@distlab/contracts";

/** Authorized read model. Counters, tasks, and provider handles stay out of this projection. */
interface AssessmentRead {
  readonly components: CanonicalValue;
  readonly databases: CanonicalValue;
  readonly messageBus: CanonicalValue;
}

function isRecord(value: CanonicalValue): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function component(components: CanonicalValue, id: string): Record<string, CanonicalValue> | null {
  if (!isRecord(components)) return null;
  const value = components[id];
  return value !== undefined && isRecord(value) ? value : null;
}

function committed(databases: CanonicalValue, owner: string): CanonicalValue {
  if (!isRecord(databases)) return { revision: 0, tables: {} };
  const database = databases[owner];
  if (database === undefined || !isRecord(database)) return { revision: 0, tables: {} };
  const revision = database.revision;
  const tables = database.tables;
  if (typeof revision !== "number" || tables === undefined || !isRecord(tables)) return { revision: 0, tables: {} };
  return { revision, tables };
}

function service(components: CanonicalValue, databases: CanonicalValue, id: string): CanonicalValue {
  const runtime = component(components, id);
  return {
    role: "service",
    lifecycle: runtime && typeof runtime.state === "string" ? runtime.state : "UNKNOWN",
    processGeneration: runtime && typeof runtime.processGeneration === "number" ? runtime.processGeneration : 0,
    committed: committed(databases, id),
  };
}

function client(components: CanonicalValue, id: string): CanonicalValue {
  const runtime = component(components, id);
  const state = runtime?.state;
  const observed = state !== undefined && isRecord(state) ? state : null;
  return {
    role: "client-observed",
    request: observed && Object.hasOwn(observed, "request") ? observed.request ?? null : null,
    outcome: observed && Object.hasOwn(observed, "outcome") ? observed.outcome ?? null : null,
  };
}

function authorizations(components: CanonicalValue, id: string): CanonicalValue[] {
  const runtime = component(components, id);
  const visibleValue = runtime?.visible;
  const visible = visibleValue !== undefined && isRecord(visibleValue) ? visibleValue : null;
  const list = visible && Array.isArray(visible.authorizations) ? visible.authorizations : [];
  const facts: CanonicalValue[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const { authorizationId, paymentId, orderId, amount, status } = item;
    if (typeof authorizationId !== "string" || typeof paymentId !== "string" || typeof orderId !== "string"
      || typeof amount !== "number" || typeof status !== "string") continue;
    facts.push({ authorizationId, paymentId, orderId, amount, status });
  }
  return facts;
}

function deliveries(messageBus: CanonicalValue): CanonicalValue[] {
  if (!isRecord(messageBus) || !Array.isArray(messageBus.records)) return [];
  const facts: CanonicalValue[] = [];
  for (const item of messageBus.records) {
    if (!isRecord(item) || typeof item.messageId !== "string" || typeof item.destination !== "string"
      || typeof item.state !== "string" || typeof item.attempt !== "number") continue;
    facts.push({
      messageId: item.messageId, destination: item.destination, state: item.state, attempt: item.attempt,
      ...(typeof item.consumer === "string" ? { consumer: item.consumer } : {}),
    });
  }
  return facts;
}

/** Student-visible checkout facts copied from the assessment read model. */
export function studentComponents(read: AssessmentRead): ComponentStateProjection[] {
  return [
    { componentId: "customer-app", visibility: "student", state: client(read.components, "customer-app") },
    { componentId: "orders", visibility: "student", state: service(read.components, read.databases, "orders") },
    { componentId: "payments", visibility: "student", state: service(read.components, read.databases, "payments") },
    { componentId: "payment-processor", visibility: "student", state: { role: "external-visible", authorizations: authorizations(read.components, "payment-processor") } },
    { componentId: "OrderCreated", visibility: "student", state: { role: "bus-delivery", records: deliveries(read.messageBus) } },
  ];
}
