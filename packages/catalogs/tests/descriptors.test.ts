import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalValue, ModelDescriptor, ModelPeer, Observation } from "@distlab/contracts";
import {
  checkoutAssessment, checkoutCatalog, checkoutDescriptors, checkoutScenario,
  commerceAssessment, commerceCatalog, commerceDescriptors, commerceLessonNames, commerceScenario, reliableCheckoutScenario,
} from "@distlab/catalogs";
import { DeterministicScenarioEngine, openHarness, type ScenarioAssessment, type ScenarioCatalog } from "@distlab/scenario";

type Doc = Record<string, CanonicalValue>;
interface Component { readonly id: string; readonly kind: string; readonly model: string; readonly version: string; readonly configuration: CanonicalValue }
interface Lesson { readonly name: string; readonly document: Doc; readonly catalog: ScenarioCatalog; readonly assessment: ScenarioAssessment; readonly descriptors: readonly ModelDescriptor[] }

const object = (value: CanonicalValue | undefined): Doc => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Doc;
};
const lessons: readonly Lesson[] = [
  ...(["normal", "response-lost"] as const).map(variant => ({ name: `checkout-${variant}`, document: object(checkoutScenario(variant)), catalog: checkoutCatalog, assessment: checkoutAssessment, descriptors: checkoutDescriptors })),
  ...commerceLessonNames.map(name => ({ name, document: object(commerceScenario(name)), catalog: commerceCatalog, assessment: commerceAssessment, descriptors: commerceDescriptors })),
  { name: "reliable-checkout", document: object(reliableCheckoutScenario), catalog: commerceCatalog, assessment: commerceAssessment, descriptors: commerceDescriptors },
];
const components = (document: Doc): readonly Component[] => object(document.architecture).components as unknown as Component[];
const descriptorOf = (lesson: Lesson, component: Component): ModelDescriptor => {
  const descriptor = lesson.descriptors.find(item => item.model === component.model && item.version === component.version);
  assert.ok(descriptor, `${lesson.name}: no descriptor for ${component.model}@${component.version}`);
  return descriptor;
};
/** Independent of the catalog's own resolution: configuration field, else descriptor default. */
const bound = (component: Component, peer: ModelPeer): string => {
  const value = object(component.configuration)[peer.name];
  return value === undefined ? peer.default : value as string;
};
async function history(lesson: Lesson, document: Doc): Promise<{ status: string; observations: readonly Observation[] }> {
  const engine = new DeterministicScenarioEngine({ catalog: lesson.catalog, assessment: lesson.assessment });
  assert.deepEqual(engine.validate(document), [], lesson.name);
  const session = openHarness(engine.create(document));
  await session.run();
  const result = session.inspect();
  return { status: result.status, observations: result.history.observations };
}

/** ARCH-AC-5: every recorded request, publication, and committed table is declared by the source's descriptor. */
function assertDescriptorTruth(lesson: Lesson, document: Doc, observations: readonly Observation[]): { requests: number; publications: number; commits: number } {
  const byId = new Map(components(document).map(component => [component.id, component]));
  const counts = { requests: 0, publications: 0, commits: 0 };
  for (const observation of observations) {
    const source = observation.source === undefined ? undefined : byId.get(observation.source);
    if (observation.type === "network.request.sent") {
      assert.ok(source, `${lesson.name}: request from unknown source ${observation.source}`);
      const descriptor = descriptorOf(lesson, source);
      const endpoint = object(observation.data).endpoint;
      const target = byId.get(observation.target!);
      assert.ok(target, `${lesson.name}: request to unknown target ${observation.target}`);
      const viaPeer = descriptor.peers.some(peer => bound(source, peer) === target.id && peer.calls.includes(endpoint as string) && (peer.kinds as readonly string[]).includes(target.kind));
      // A workload-addressed call (#121): a client action the descriptor declares in `workloadCalls`, whose data names this target and endpoint.
      const viaWorkload = (descriptor.workloadCalls ?? []).some(call => (document.actions as Doc[]).some(action =>
        action.kind === "client" && action.target === source.id && action.action === call.action
        && object(action.data)[call.target] === target.id && object(action.data)[call.endpoint] === endpoint));
      assert.ok(viaPeer || viaWorkload, `${lesson.name}: ${source.id} -> ${target.id} ${String(endpoint)} is not a declared call`);
      counts.requests++;
    } else if (observation.type === "message.published") {
      assert.ok(source, `${lesson.name}: publication from unknown source ${observation.source}`);
      const destination = object(observation.data).destination as string;
      assert.ok(descriptorOf(lesson, source).publishes.includes(destination), `${lesson.name}: ${source.id} publishes undeclared ${destination}`);
      counts.publications++;
    } else if (observation.type === "database.transaction.committed") {
      assert.ok(source, `${lesson.name}: commit by unknown owner ${observation.source}`);
      const declared = (descriptorOf(lesson, source).storage.database?.tables ?? []).map(table => table.name);
      for (const change of object(observation.data).changes as Doc[]) {
        assert.ok(declared.includes(change.table as string), `${lesson.name}: ${source.id} commits undeclared table ${String(change.table)}`);
      }
      counts.commits++;
    }
  }
  return counts;
}

test("ARCH-AC-5 each catalog ScenarioModel equals its data-only descriptor", () => {
  for (const [catalog, descriptors] of [[checkoutCatalog, checkoutDescriptors], [commerceCatalog, commerceDescriptors]] as const) {
    const keys = descriptors.map(item => `${item.model}@${item.version}`);
    assert.equal(new Set(keys).size, keys.length, `${catalog.id}: duplicate descriptors`);
    for (const descriptor of descriptors) {
      const model = catalog.find(descriptor.model, descriptor.version);
      assert.ok(model, `${catalog.id}: ${descriptor.model} has no catalog model`);
      const { checks: _checks, instantiate: _instantiate, ...declared } = model;
      assert.deepEqual(declared, descriptor);
      assert.deepEqual(catalog.versions(descriptor.model), descriptors.filter(item => item.model === descriptor.model).map(item => item.version));
    }
  }
  // Every model a packaged lesson uses has a descriptor in its own catalog.
  for (const lesson of lessons) for (const component of components(lesson.document)) {
    assert.equal(descriptorOf(lesson, component).kind, component.kind);
  }
});

test("ARCH-AC-6 peer names, option keys, and lesson-data fields of each model are distinct and disjoint", () => {
  for (const descriptor of [...checkoutDescriptors, ...commerceDescriptors]) {
    const fields = [...descriptor.peers.map(peer => peer.name), ...descriptor.options.map(option => option.key), ...(descriptor.lessonData ?? [])];
    assert.equal(new Set(fields).size, fields.length, `${descriptor.model}: ${fields.join(", ")}`);
  }
});

/** Configuration keys of packaged components that their model's descriptor does not declare (#122). */
function undeclaredConfiguration(lesson: Lesson, descriptors: readonly ModelDescriptor[]): readonly string[] {
  return components(lesson.document).flatMap(component => {
    const descriptor = descriptors.find(item => item.model === component.model && item.version === component.version);
    assert.ok(descriptor, `${lesson.name}: no descriptor for ${component.model}@${component.version}`);
    const declared = new Set([
      ...descriptor.peers.map(peer => peer.name), ...descriptor.options.map(option => option.key), ...(descriptor.lessonData ?? []),
      // A placeholder's interface is read by composition (ADR-005), not lesson data.
      ...(descriptor.placeholder ? ["interface"] : []),
    ]);
    return Object.keys(object(component.configuration)).filter(key => !declared.has(key)).map(key => `${lesson.name}: ${component.id}.${key}`);
  });
}

test("ARCH-AC-5 every packaged configuration key is a declared peer, option, or lesson-data field (#122)", () => {
  assert.deepEqual(lessons.flatMap(lesson => undeclaredConfiguration(lesson, lesson.descriptors)), []);
  assert.deepEqual(commerceDescriptors.filter(item => item.lessonData).map(item => [item.model, item.lessonData]), [
    ["commerce.saga-resource", ["compensated", "forward"]],
    ["commerce.cache-catalog", ["ttl"]],
    ["commerce.cache-cart", ["ttl"]],
  ]);
  assert.ok(checkoutDescriptors.every(item => item.lessonData === undefined));
  // The check reads the declaration: without "ttl", the cart lesson's configuration is undeclared.
  const withoutTtl = commerceDescriptors.map(item => item.model === "commerce.cache-cart" ? { ...item, lessonData: [] } : item);
  const undeclared = lessons.filter(lesson => lesson.descriptors === commerceDescriptors).flatMap(lesson => undeclaredConfiguration(lesson, withoutTtl));
  assert.ok(undeclared.length > 0 && undeclared.every(item => item.endsWith(".ttl")), undeclared.join("; "));
});

test("ARCH-AC-5 every packaged lesson records only declared calls, publications, and tables", async () => {
  const totals = { requests: 0, publications: 0, commits: 0 };
  for (const lesson of lessons) {
    const { observations } = await history(lesson, lesson.document);
    const counts = assertDescriptorTruth(lesson, lesson.document, observations);
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += counts[key];
  }
  for (const [kind, count] of Object.entries(totals)) assert.ok(count > 0, `no ${kind} observed`);
});

test("#121 commerce.client declares its request action as a workload-addressed call", () => {
  const client = commerceDescriptors.find(item => item.model === "commerce.client");
  assert.deepEqual(client?.workloadCalls, [{ action: "request", target: "target", endpoint: "endpoint" }]);
  assert.deepEqual(client?.peers, []);
  // Each declared call names an action the model offers.
  for (const descriptor of [...checkoutDescriptors, ...commerceDescriptors]) for (const call of descriptor.workloadCalls ?? []) {
    assert.equal(descriptor.kind, "client", descriptor.model);
    assert.ok(descriptor.actions.includes(call.action), `${descriptor.model}: ${call.action}`);
  }
});

test("#121 every packaged workload call is required to reach an endpoint its target offers", () => {
  let checked = 0;
  for (const lesson of lessons) {
    const engine = new DeterministicScenarioEngine({ catalog: lesson.catalog, assessment: lesson.assessment });
    const actions = lesson.document.actions as Doc[];
    actions.forEach((action, index) => {
      if (action.kind !== "client") return;
      const client = components(lesson.document).find(component => component.id === action.target)!;
      for (const call of descriptorOf(lesson, client).workloadCalls ?? []) {
        if (call.action !== action.action) continue;
        const misspelled = actions.map((item, at) => at !== index ? item : { ...item, data: { ...object(item.data), [call.endpoint]: `${String(object(item.data)[call.endpoint])}-typo` } });
        assert.deepEqual(engine.validate({ ...lesson.document, actions: misspelled as unknown as CanonicalValue }).map(item => `${item.path} ${item.code}`),
          [`/actions/${index}/data/${call.endpoint} INTERFACE`], `${lesson.name}: ${String(action.id)}`);
        checked += 1;
      }
    });
  }
  assert.ok(checked > 0);
});

/**
 * Renames one bound peer component everywhere it is referenced (table names
 * excepted) and binds the peer to the new ID through configuration. A model
 * that still used a literal peer ID would call a component that no longer exists.
 */
function rebind(document: Doc, componentId: string, peer: ModelPeer, from: string, to: string): Doc {
  const rename = (value: CanonicalValue, path: readonly string[]): CanonicalValue => {
    if (value === from) return to;
    if (Array.isArray(value)) return value.map(item => rename(item, path));
    if (value && typeof value === "object") {
      if (path.at(-1) === "tables") return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rename(item!, [...path, key])]));
    }
    return value;
  };
  const renamed = object(rename({ ...document, assertions: [] }, []));
  const architecture = object(renamed.architecture);
  const rebound = components(renamed).map(component => component.id !== componentId ? component
    : { ...component, configuration: { ...object(component.configuration), [peer.name]: to } });
  return { ...renamed, architecture: { ...architecture, components: rebound as unknown as CanonicalValue } };
}

test("ARCH-AC-5 models read every peer from configuration, never from a literal component ID", async () => {
  let rebindings = 0;
  for (const lesson of lessons) {
    for (const component of components(lesson.document)) {
      for (const peer of descriptorOf(lesson, component).peers) {
        const from = bound(component, peer), to = `${from}-rebound`;
        const document = rebind(lesson.document, component.id, peer, from, to);
        const { status, observations } = await history(lesson, document);
        assert.equal(status, "COMPLETED", `${lesson.name}: ${component.id}.${peer.name}`);
        assertDescriptorTruth(lesson, document, observations);
        const sent = observations.filter(item => item.type === "network.request.sent" && item.source === component.id);
        assert.ok(sent.some(item => item.target === to), `${lesson.name}: ${component.id}.${peer.name} never called ${to}`);
        assert.ok(!observations.some(item => item.source === from || item.target === from), `${lesson.name}: ${from} still referenced`);
        rebindings++;
      }
    }
  }
  // 30 in the packaged lessons (eight are the lease workers' lock and storage), plus Reliable Checkout's four:
  // orders.inventory, orders.payments, payments.processor, notifications.provider.
  assert.equal(rebindings, 34);
});

test("ARCH-AC-1 every packaged document passes the composition rules, and each peer link is required", () => {
  let removed = 0;
  for (const lesson of lessons) {
    const engine = new DeterministicScenarioEngine({ catalog: lesson.catalog, assessment: lesson.assessment });
    assert.deepEqual(engine.validate(lesson.document), [], lesson.name);
    const architecture = object(lesson.document.architecture);
    const links = architecture.links as unknown as { source: string; target: string }[];
    components(lesson.document).forEach((component, index) => {
      for (const peer of descriptorOf(lesson, component).peers) {
        const target = bound(component, peer);
        const without = { ...lesson.document, architecture: { ...architecture, links: links.filter(link => link.source !== component.id || link.target !== target) as unknown as CanonicalValue } };
        assert.deepEqual(engine.validate(without).map(item => `${item.path} ${item.code}`), [`/architecture/components/${index}/configuration/${peer.name} LINK`], `${lesson.name}: ${component.id}.${peer.name}`);
        removed += 1;
      }
    });
  }
  assert.ok(removed > 0);
});
