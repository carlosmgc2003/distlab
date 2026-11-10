import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import { checkoutAssessment, checkoutAssessmentV11, checkoutDescriptors, checkoutScenario, hostedCatalogs } from "@distlab/catalogs";
import { DeterministicScenarioEngine, compareExports, openHarness, resolveHostedCatalog, validateScenarioDocument } from "@distlab/scenario";
import type { AssessmentProjection, HarnessExport, ScenarioAssessment } from "@distlab/scenario";

/**
 * #148: checkout checks that name their components. `mvp.checkout@1.1.0` hosts the same
 * models with assessment `1.1.0`, whose predicates take optional `processor`, `payments`,
 * and `orders` parameters; `mvp.checkout@1.0.0` stays as it was.
 */

type Doc = Record<string, unknown>;
const ids = ["mvp.order-created-once", "mvp.order-created-published-once", "mvp.processor-authorized-once",
  "mvp.payments-unknown", "mvp.authorization-disagreement-visible", "mvp.payments-authorized"];
const renamed = { processor: "psp", payments: "billing", orders: "sales" };

/** A projection holding one order, one approved authorization, one ambiguous payment, and its timeout. */
function projection(names: { processor: string; payments: string; orders: string }, paymentState = "UNKNOWN"): AssessmentProjection {
  return {
    time: 0, status: "COMPLETED", stores: {}, messageBus: {},
    databases: {
      [names.orders]: { tables: { orders: { "order-1": { orderId: "order-1", state: "CREATED" } } } },
      [names.payments]: { tables: { payments: { "payment-1": { orderId: "order-1", state: paymentState, outcome: paymentState === "UNKNOWN" ? "NETWORK_TIMEOUT" : null,
        authorizationId: paymentState === "UNKNOWN" ? null : "authorization-1" } } } },
    },
    components: { [names.processor]: { visible: { authorizations: [{ authorizationId: "authorization-1", orderId: "order-1", amount: 15000, status: "APPROVED" }] } } },
    history: { observations: [
      { type: "network.request.timedout", source: names.payments, data: {} },
      { type: "message.published", source: names.orders, data: { destination: "OrderCreated", message: { body: { orderId: "order-1" } } } },
    ] },
  } as unknown as AssessmentProjection;
}
const parameters = (extra: Record<string, unknown> = {}) => ({ orderId: "order-1", amount: 15000, destination: "OrderCreated", ...extra }) as unknown as CanonicalValue;
const evaluate = (assessment: ScenarioAssessment, id: string, input: CanonicalValue, state: AssessmentProjection) =>
  canonicalEncode(assessment.find(id)!.evaluate({ parameters: input, projection: state }) as unknown as CanonicalValue);
const packaged = { processor: "payment-processor", payments: "payments", orders: "orders" };

test("#148: every checkout check exists in both versions, at the assessment's version", () => {
  for (const id of ids) {
    assert.equal(checkoutAssessment.find(id)?.version, "1.0.0", id);
    assert.equal(checkoutAssessmentV11.find(id)?.version, "1.1.0", id);
  }
  assert.equal(checkoutAssessmentV11.version, "1.1.0");
});

test("#148: a 1.1.0 check without ID parameters gives the 1.0.0 status and evidence", () => {
  for (const paymentState of ["UNKNOWN", "AUTHORIZED"]) {
    for (const id of ids) {
      const state = projection(packaged, paymentState);
      assert.equal(evaluate(checkoutAssessmentV11, id, parameters(), state), evaluate(checkoutAssessment, id, parameters(), state), `${id} ${paymentState}`);
    }
  }
});

test("#148: a 1.1.0 check that names renamed components judges them as 1.0.0 judges the packaged IDs", () => {
  for (const paymentState of ["UNKNOWN", "AUTHORIZED"]) {
    for (const id of ids) {
      const expected = evaluate(checkoutAssessment, id, parameters(), projection(packaged, paymentState));
      assert.equal(evaluate(checkoutAssessmentV11, id, parameters(renamed), projection(renamed, paymentState)), expected, `${id} ${paymentState}`);
    }
  }
  // 1.0.0 is unchanged: it still reads the packaged IDs and ignores the new parameters.
  const lost = projection(renamed);
  assert.equal(JSON.parse(evaluate(checkoutAssessment, "mvp.processor-authorized-once", parameters(renamed), lost)).pass, false);
  assert.equal(JSON.parse(evaluate(checkoutAssessmentV11, "mvp.processor-authorized-once", parameters(renamed), lost)).pass, true);
});

test("#148: a present ID parameter that is empty or not a string fails the check with evidence naming it", () => {
  for (const id of ids) {
    for (const [bad, names] of [[{ processor: "" }, ["processor"]], [{ payments: 7 }, ["payments"]], [{ orders: null, processor: ["psp"] }, ["processor", "orders"]]] as const) {
      const result = checkoutAssessmentV11.find(id)!.evaluate({ parameters: parameters(bad), projection: projection(packaged) });
      assert.equal(result.pass, false, id);
      assert.deepEqual(result.evidence, { invalidParameters: names }, id);
    }
  }
});

/** A packaged checkout, or the vision fixture's scenario, with every component renamed and peers bound through configuration. */
function rename(scenario: Doc, assertionParameters: Record<string, string>): Doc {
  const map: Record<string, string> = { "customer-app": "shopper", orders: renamed.orders, payments: renamed.payments, "payment-processor": renamed.processor };
  const swap = (value: unknown, path: readonly string[]): unknown => {
    if (typeof value === "string") return map[value] ?? value;
    if (Array.isArray(value)) return value.map(item => swap(item, path));
    // Table names and model names are not component IDs.
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, path.at(-1) === "tables" || key === "model" || key === "name" && path.includes("tables") ? item : swap(item, [...path, key])]));
    return value;
  };
  const swapped = swap({ ...scenario, assertions: [] }, []) as Doc;
  const architecture = swapped.architecture as Doc;
  const components = (architecture.components as Doc[]).map(component => {
    const descriptor = checkoutDescriptors.find(item => item.model === component.model)!;
    return { ...component, configuration: Object.fromEntries(descriptor.peers.map(peer => [peer.name, map[peer.default] ?? peer.default])) };
  });
  return { ...swapped, name: `renamed-${String(scenario.name)}`, architecture: { ...architecture, components },
    assertions: (scenario.assertions as Doc[]).map(assertion => ({ ...assertion, parameters: { ...(assertion.parameters as Doc), ...assertionParameters } })) };
}
const document = (scenario: Doc, version: string) => ({ format: "distlab.scenario", formatVersion: 1, catalog: { id: "mvp.checkout", version },
  presentation: { title: String(scenario.name) }, scenario });
async function run(value: unknown): Promise<HarnessExport> {
  const validated = validateScenarioDocument(JSON.stringify(value), hostedCatalogs);
  assert.ok(validated.ok, JSON.stringify(validated));
  const session = openHarness(new DeterministicScenarioEngine(validated.hosted).create(validated.scenario));
  await session.run();
  return session.inspect();
}
const statuses = (result: HarnessExport) => result.results.map(item => `${item.id}:${item.status}`);
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/scenarios/processor-response-lost.json", import.meta.url)), "utf8")) as Doc;

test("#148: renamed checkout documents against mvp.checkout@1.1.0 get the same assertion results as the originals", async () => {
  const cases: [string, Doc][] = [
    ["vision §19 fixture", fixture.scenario as Doc],
    ["checkout-normal", checkoutScenario("normal") as unknown as Doc],
    ["checkout-response-lost", checkoutScenario("response-lost") as unknown as Doc],
  ];
  const predicates = new Set<string>();
  for (const [label, scenario] of cases) {
    const original = await run(document({ ...scenario, name: `original-${String(scenario.name)}` }, "1.0.0"));
    const moved = await run(document(rename(scenario, renamed), "1.1.0"));
    assert.ok(statuses(original).length > 0, label);
    assert.deepEqual(statuses(moved), statuses(original), label);
    for (const assertion of scenario.assertions as Doc[]) predicates.add(String(assertion.predicate));
    // Without the parameters, 1.1.0 judges the packaged IDs, so the renamed run's checks cannot pass.
    const unnamed = await run(document(rename(scenario, {}), "1.1.0"));
    assert.ok(unnamed.results.some(item => item.status !== "PASS"), `${label}: unnamed checks read the packaged IDs`);
  }
  assert.deepEqual([...predicates].sort(), [...ids].sort(), "every checkout check was exercised");
  // The vision fixture's own statement.
  assert.deepEqual(statuses(await run(document(rename(fixture.scenario as Doc, renamed), "1.1.0"))), ["order-not-charged-twice:PASS"]);
});

test("#148: a renamed 1.1.0 document replays with equal exports, fresh and after Reset", async () => {
  const value = document(rename(checkoutScenario("response-lost") as unknown as Doc, renamed), "1.1.0");
  const first = await run(value);
  assert.ok(compareExports(first, await run(value)));
  const validated = validateScenarioDocument(JSON.stringify(value), hostedCatalogs);
  assert.ok(validated.ok);
  const session = openHarness(new DeterministicScenarioEngine(validated.hosted).create(validated.scenario));
  await session.run();
  await session.reset();
  await session.run();
  assert.ok(compareExports(first, session.inspect()));
});

test("#148: each checkout version resolves to its own assessment, and 1.0.0 documents keep their runId", async () => {
  const v10 = resolveHostedCatalog(hostedCatalogs, { id: "mvp.checkout", version: "1.0.0" });
  const v11 = resolveHostedCatalog(hostedCatalogs, { id: "mvp.checkout", version: "1.1.0" });
  assert.ok(typeof v10 === "object" && typeof v11 === "object");
  assert.equal(v10.assessment, checkoutAssessment);
  assert.equal(v11.assessment, checkoutAssessmentV11);
  // The fixture against 1.0.0 is judged by 1.0.0 predicates, and the same inputs against 1.1.0 are a different run.
  const original = await run(fixture);
  // Recorded on main before #148: hosting 1.1.0 changes nothing about a 1.0.0 run.
  assert.equal(original.history.runId, "run:ed746845ba676e0739885786a1a49d2305b7bf43efe39fa0c6ee70c4e501d1c6");
  assert.equal(original.digest, "3ab455d9caeae53a9edc5b225374239bbe971404b141a370926ccde552f21ffc");
  const moved = await run({ ...fixture, catalog: { id: "mvp.checkout", version: "1.1.0" } });
  assert.notEqual(moved.history.runId, original.history.runId);
  assert.deepEqual(statuses(moved), statuses(original));
});
