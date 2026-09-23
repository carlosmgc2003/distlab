import type { CanonicalValue } from "@distlab/contracts";
import type { AssessmentProjection, ScenarioAssessment, ScenarioPredicate } from "@distlab/scenario";

type RecordValue = Record<string, CanonicalValue>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const rows = (projection: AssessmentProjection, owner: string, table: string): RecordValue => record(record(record(projection.databases)[owner]).tables)[table] as RecordValue ?? {};
const values = (value: unknown): readonly CanonicalValue[] => Array.isArray(value) ? value as CanonicalValue[] : [];
const observations = (projection: AssessmentProjection): readonly RecordValue[] => values(record(projection.history).observations).map(record);
const params = (value: CanonicalValue): RecordValue => record(value);
const payment = (projection: AssessmentProjection, orderId: string): RecordValue | undefined => Object.values(rows(projection, "payments", "payments")).map(record).find(row => row.orderId === orderId);
const authorization = (projection: AssessmentProjection, orderId: string): readonly RecordValue[] => {
  const boundary = record(record(projection.components)["payment-processor"]);
  return values(record(boundary.visible).authorizations).map(record).filter(entry => entry.orderId === orderId);
};
const predicate = (id: string, evaluate: ScenarioPredicate["evaluate"]): ScenarioPredicate => ({ id, version: "1.0.0", evaluate });

const predicates: readonly ScenarioPredicate[] = [
  predicate("mvp.order-created-once", ({ parameters, projection }) => {
    const orderId = params(parameters).orderId;
    const matches = Object.values(rows(projection, "orders", "orders")).map(record).filter(row => row.orderId === orderId && row.state === "CREATED");
    return { pass: matches.length === 1, evidence: { orderId: orderId ?? null, count: matches.length } };
  }),
  predicate("mvp.order-created-published-once", ({ parameters, projection }) => {
    const target = params(parameters);
    const published = observations(projection).filter(item => item.type === "message.published" && record(item.data).destination === target.destination && record(record(record(item.data).message).body).orderId === target.orderId);
    return { pass: published.length === 1, evidence: { count: published.length, destination: target.destination ?? null } };
  }),
  predicate("mvp.processor-authorized-once", ({ parameters, projection }) => {
    const target = params(parameters);
    const entries = authorization(projection, String(target.orderId));
    return { pass: entries.length === 1 && entries[0]?.amount === target.amount && entries[0]?.status === "APPROVED", evidence: { count: entries.length, authorization: entries[0] ?? null } };
  }),
  predicate("mvp.payments-unknown", ({ parameters, projection }) => {
    const row = payment(projection, String(params(parameters).orderId));
    const timeout = observations(projection).filter(item => item.type === "network.request.timedout" && item.source === "payments");
    return { pass: row?.state === "UNKNOWN" && row.outcome === "NETWORK_TIMEOUT" && timeout.length === 1, evidence: { state: row?.state ?? null, outcome: row?.outcome ?? null, timeoutCount: timeout.length } };
  }),
  predicate("mvp.authorization-disagreement-visible", ({ parameters, projection }) => {
    const orderId = String(params(parameters).orderId);
    const row = payment(projection, orderId);
    const entries = authorization(projection, orderId);
    return { pass: entries.length === 1 && row?.state === "UNKNOWN" && row.authorizationId === null, evidence: { providerAuthorization: entries[0] ?? null, paymentState: row?.state ?? null, localAuthorizationId: row?.authorizationId ?? null } };
  }),
  predicate("mvp.payments-authorized", ({ parameters, projection }) => {
    const row = payment(projection, String(params(parameters).orderId));
    return { pass: row?.state === "AUTHORIZED" && typeof row.authorizationId === "string", evidence: { state: row?.state ?? null, authorizationId: row?.authorizationId ?? null } };
  }),
  predicate("mvp.reproducible-run", ({ parameters, projection }) => {
    const expected = params(parameters).expectedRandomDrawCount;
    const draws = observations(projection).filter(item => item.type === "random.draw");
    return { pass: draws.length === expected, evidence: { randomDrawCount: draws.length, expected: expected ?? null } };
  }),
];

export const checkoutAssessment: ScenarioAssessment = {
  version: "1.0.0", find: id => predicates.find(item => item.id === id),
};
