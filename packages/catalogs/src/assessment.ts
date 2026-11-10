import type { CanonicalValue } from "@distlab/contracts";
import type { AssessmentProjection, ScenarioAssessment, ScenarioPredicate } from "@distlab/scenario";

type RecordValue = Record<string, CanonicalValue>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const rows = (projection: AssessmentProjection, owner: string, table: string): RecordValue => record(record(record(projection.databases)[owner]).tables)[table] as RecordValue ?? {};
const values = (value: unknown): readonly CanonicalValue[] => Array.isArray(value) ? value as CanonicalValue[] : [];
const observations = (projection: AssessmentProjection): readonly RecordValue[] => values(record(projection.history).observations).map(record);
const params = (value: CanonicalValue): RecordValue => record(value);

/** The components a checkout predicate reads: the processor, and the services that own `payments` and `orders`. */
interface CheckoutIds { readonly processor: string; readonly payments: string; readonly orders: string }
/** The packaged checkout's component IDs, which every `1.0.0` predicate reads (#148). */
const packagedIds: CheckoutIds = Object.freeze({ processor: "payment-processor", payments: "payments", orders: "orders" });

const payment = (projection: AssessmentProjection, ids: CheckoutIds, orderId: string): RecordValue | undefined =>
  Object.values(rows(projection, ids.payments, "payments")).map(record).find(row => row.orderId === orderId);
const authorization = (projection: AssessmentProjection, ids: CheckoutIds, orderId: string): readonly RecordValue[] => {
  const boundary = record(record(projection.components)[ids.processor]);
  return values(record(boundary.visible).authorizations).map(record).filter(entry => entry.orderId === orderId);
};

type Check = (input: { readonly parameters: CanonicalValue; readonly projection: AssessmentProjection; readonly ids: CheckoutIds }) => ReturnType<ScenarioPredicate["evaluate"]>;

/** The six checkout checks, written once over the component IDs they are given. */
const checks: readonly (readonly [string, Check])[] = [
  ["mvp.order-created-once", ({ parameters, projection, ids }) => {
    const orderId = params(parameters).orderId;
    const matches = Object.values(rows(projection, ids.orders, "orders")).map(record).filter(row => row.orderId === orderId && row.state === "CREATED");
    return { pass: matches.length === 1, evidence: { orderId: orderId ?? null, count: matches.length } };
  }],
  ["mvp.order-created-published-once", ({ parameters, projection }) => {
    const target = params(parameters);
    const published = observations(projection).filter(item => item.type === "message.published" && record(item.data).destination === target.destination && record(record(record(item.data).message).body).orderId === target.orderId);
    return { pass: published.length === 1, evidence: { count: published.length, destination: target.destination ?? null } };
  }],
  ["mvp.processor-authorized-once", ({ parameters, projection, ids }) => {
    const target = params(parameters);
    const entries = authorization(projection, ids, String(target.orderId));
    return { pass: entries.length === 1 && entries[0]?.amount === target.amount && entries[0]?.status === "APPROVED", evidence: { count: entries.length, authorization: entries[0] ?? null } };
  }],
  ["mvp.payments-unknown", ({ parameters, projection, ids }) => {
    const row = payment(projection, ids, String(params(parameters).orderId));
    const timeout = observations(projection).filter(item => item.type === "network.request.timedout" && item.source === ids.payments);
    return { pass: row?.state === "UNKNOWN" && row.outcome === "NETWORK_TIMEOUT" && timeout.length === 1, evidence: { state: row?.state ?? null, outcome: row?.outcome ?? null, timeoutCount: timeout.length } };
  }],
  ["mvp.authorization-disagreement-visible", ({ parameters, projection, ids }) => {
    const orderId = String(params(parameters).orderId);
    const row = payment(projection, ids, orderId);
    const entries = authorization(projection, ids, orderId);
    return { pass: entries.length === 1 && row?.state === "UNKNOWN" && row.authorizationId === null, evidence: { providerAuthorization: entries[0] ?? null, paymentState: row?.state ?? null, localAuthorizationId: row?.authorizationId ?? null } };
  }],
  ["mvp.payments-authorized", ({ parameters, projection, ids }) => {
    const row = payment(projection, ids, String(params(parameters).orderId));
    return { pass: row?.state === "AUTHORIZED" && typeof row.authorizationId === "string", evidence: { state: row?.state ?? null, authorizationId: row?.authorizationId ?? null } };
  }],
];

/** `1.0.0`: every check reads the packaged component IDs; unchanged since the checkout catalog was first hosted. */
const packagedPredicates: readonly ScenarioPredicate[] = checks.map(([id, check]) => ({
  id, version: "1.0.0", evaluate: ({ parameters, projection }) => check({ parameters, projection, ids: packagedIds }),
}));

const idParameters = ["processor", "payments", "orders"] as const;

/**
 * `1.1.0` (#148): an assertion may name the components it judges with optional
 * `processor`, `payments`, and `orders` parameters, each defaulting to the
 * packaged ID. Without them a check behaves as in `1.0.0`. A parameter that is
 * present but not a non-empty string fails the check with evidence naming it.
 */
const namedPredicates: readonly ScenarioPredicate[] = checks.map(([id, check]) => ({
  id, version: "1.1.0", evaluate: ({ parameters, projection }) => {
    const given = params(parameters);
    const invalid = idParameters.filter(key => given[key] !== undefined && (typeof given[key] !== "string" || given[key] === ""));
    if (invalid.length) return { pass: false, evidence: { invalidParameters: [...invalid] } };
    const ids: CheckoutIds = {
      processor: (given.processor as string | undefined) ?? packagedIds.processor,
      payments: (given.payments as string | undefined) ?? packagedIds.payments,
      orders: (given.orders as string | undefined) ?? packagedIds.orders,
    };
    return check({ parameters, projection, ids });
  },
}));

/** The checkout assessment of `mvp.checkout@1.0.0`, which the packaged lessons use. */
export const checkoutAssessment: ScenarioAssessment = {
  version: "1.0.0", find: id => packagedPredicates.find(item => item.id === id),
};

/** The checkout assessment of `mvp.checkout@1.1.0`: the same checks over named components (#148). */
export const checkoutAssessmentV11: ScenarioAssessment = {
  version: "1.1.0", find: id => namedPredicates.find(item => item.id === id),
};
