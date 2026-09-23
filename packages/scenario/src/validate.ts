import type {
  ArchitectureDefinition,
  ComponentInstance,
  ComponentKind,
  DestinationDefinition,
  ExternalBehavior,
  FaultEffect,
  FaultRule,
  KeyValueDefinition,
  NetworkPolicy,
  ScenarioAction,
  ScenarioAssertion,
  ScenarioDefinition,
  ScenarioDiagnostic,
  ScheduledFault,
} from "@distlab/contracts";
import type { CanonicalValue, SimulationTime } from "@distlab/contracts/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "@distlab/kernel";
import { DiagnosticCodes, type DiagnosticCode, type ScenarioAssessment, type ScenarioCatalog, type ScenarioModel } from "./types.js";

const componentKinds = new Set<string>(["client", "service", "external"]);
const serviceStates = new Set<string>(["STARTING", "RUNNING", "PAUSED", "CRASHED", "STOPPED"]);
const availability = new Set<string>(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "RATE_LIMITED"]);
const assertionModes = new Set<string>(["always", "at", "eventually"]);
const faultPoints = new Set<string>(["network.request", "network.response", "message.delivery", "database.commit"]);
const destinationKinds = new Set<string>(["queue", "topic"]);
const visibilityModes = new Set<string>(["visible", "summary", "redacted", "omitted"]);
const actionKinds = new Set<string>(["client", "service", "external", "external-behavior", "fault"]);
const topKeys = ["version", "name", "seed", "architecture", "startTime", "external", "faults", "actions", "assertions", "configuration"];
const architectureKeys = ["components", "links", "databases", "stores", "destinations", "subscriptions"];
const componentKeys = ["id", "kind", "model", "version", "configuration"];
const linkKeys = ["source", "target", "policy"];
const policyKeys = ["requestLatency", "responseLatency", "jitter", "timeout", "failureRate"];
const databaseKeys = ["owner", "tables", "initial"];
const tableKeys = ["name", "unique", "checks"];
const storeKeys = ["owner", "initial"];
const storeItemKeys = ["key", "value", "ttl"];
const destinationKeys = ["id", "kind", "deliveryDelay", "ackTimeout", "retryDelay", "maxAttempts", "capacity"];
const subscriptionKeys = ["destination", "consumer"];
const externalKeys = ["target", "operation", "behavior"];
const behaviorKeys = ["latency", "degradedExtraLatency", "dropResponse", "parameters"];
const faultKeys = ["id", "point", "source", "target", "name", "from", "until", "occurrence", "probability", "maxApplications", "effect"];
const configurationKeys = ["startTime", "historyLimit", "visibility", "models"];
const visibilityKeys = ["defaultMode", "byType", "summaryFields"];
const actionBase = ["id", "at", "kind"];

const DEFAULT_HISTORY_LIMIT = 100_000;

export interface Normalization {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  readonly scenario?: ScenarioDefinition;
}

interface RuleDraft {
  readonly id: string;
  readonly point: FaultRule["point"];
  readonly from: SimulationTime;
  readonly probability: number;
  readonly maxApplications: number;
  readonly effect: FaultEffect;
  readonly source?: string;
  readonly target?: string;
  readonly name?: string;
  readonly until?: SimulationTime;
  readonly occurrence?: number;
  readonly path: string;
}

/** Pure normalization. Does not construct runtimes, allocate run identities, or draw randomness. */
export function normalizeScenario(input: CanonicalValue, catalog: ScenarioCatalog, assessment: ScenarioAssessment): Normalization {
  const found: ScenarioDiagnostic[] = [];
  const push = (path: string, code: DiagnosticCode): void => { found.push({ path, code }); };
  const scenario = walk(input, catalog, assessment, push);
  found.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
  const diagnostics = found.filter((item, index) => index === 0 || item.path !== found[index - 1]!.path || item.code !== found[index - 1]!.code)
    .map(item => Object.freeze({ ...item }));
  return diagnostics.length === 0 && scenario ? { diagnostics: Object.freeze(diagnostics), scenario } : { diagnostics: Object.freeze(diagnostics) };
}

function walk(input: CanonicalValue, catalog: ScenarioCatalog, assessment: ScenarioAssessment, push: (path: string, code: DiagnosticCode) => void): ScenarioDefinition | undefined {
  const root = object(input, "", topKeys, push);
  if (!root) return undefined;
  const version = root.version;
  if (version === undefined) push("/version", DiagnosticCodes.REQUIRED);
  else if (version !== 1) push("/version", DiagnosticCodes.VERSION);
  const name = text(root.name, "/name", push, true);
  const seed = readSeed(root.seed, push);
  const explicitStart = readTime(root.startTime, "/startTime", push);
  const configuration = readConfiguration(root.configuration, push);
  const configStart = configuration?.suppliedStart;
  if (explicitStart !== undefined && configStart !== undefined && explicitStart !== configStart) {
    push("/startTime", DiagnosticCodes.START_TIME_MISMATCH);
    push("/configuration/startTime", DiagnosticCodes.START_TIME_MISMATCH);
  }
  const startTime = explicitStart ?? configStart ?? simulationTime(0);
  const architecture = readArchitecture(root.architecture, catalog, push);
  const external = readExternal(root.external, architecture?.components, catalog, push);
  const faults = readFaults(root.faults, architecture, startTime, push);
  const actions = readActions(root.actions, architecture?.components, catalog, startTime, push);
  const assertions = readAssertions(root.assertions, assessment, startTime, push);
  if (!name || !seed || !architecture || !external || !faults || !actions || !assertions || !configuration) return undefined;
  const faultIds = new Set(faults.rules.map(rule => rule.id));
  for (const action of actions) if (action.kind === "fault") {
    if (faultIds.has(action.fault.id)) push(actionPath(actions, action), DiagnosticCodes.DUPLICATE);
    faultIds.add(action.fault.id);
  }
  const resolvedConfiguration = {
    startTime,
    historyLimit: configuration.historyLimit,
    visibility: configuration.visibility,
    models: configuration.models,
  };
  return {
    version: 1,
    name,
    seed,
    startTime,
    architecture: architecture.definition,
    external,
    faults: faults.rules,
    actions,
    assertions,
    configuration: resolvedConfiguration,
  };
}

function readSeed(value: unknown, push: (path: string, code: DiagnosticCode) => void): string | undefined {
  if (value === undefined) { push("/seed", DiagnosticCodes.REQUIRED); return undefined; }
  if (typeof value !== "string") { push("/seed", DiagnosticCodes.TYPE); return undefined; }
  const seed = value.trim().normalize("NFC");
  if (!seed) { push("/seed", DiagnosticCodes.SEED); return undefined; }
  return seed;
}

interface ConfigurationDraft {
  readonly suppliedStart?: SimulationTime;
  readonly historyLimit: number;
  readonly visibility: ScenarioDefinition["configuration"]["visibility"];
  readonly models: CanonicalValue;
}

function readConfiguration(value: unknown, push: (path: string, code: DiagnosticCode) => void): ConfigurationDraft | undefined {
  if (value === undefined) return {
    historyLimit: DEFAULT_HISTORY_LIMIT,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} },
    models: {},
  };
  const record = object(value, "/configuration", configurationKeys, push);
  if (!record) return undefined;
  const suppliedStart = readTime(record.startTime, "/configuration/startTime", push);
  let historyLimit = DEFAULT_HISTORY_LIMIT;
  if (record.historyLimit !== undefined) {
    if (typeof record.historyLimit !== "number" || !Number.isSafeInteger(record.historyLimit) || record.historyLimit <= 0 || Object.is(record.historyLimit, -0)) {
      push("/configuration/historyLimit", DiagnosticCodes.TYPE);
    } else historyLimit = record.historyLimit;
  }
  const visibility = readVisibility(record.visibility, push);
  let models: CanonicalValue = {};
  if (record.models !== undefined) {
    const copied = copyCanonical(record.models, "/configuration/models", push);
    if (copied === undefined || copied === null || typeof copied !== "object" || Array.isArray(copied)) {
      if (copied !== undefined) push("/configuration/models", DiagnosticCodes.TYPE);
    } else models = copied;
  }
  if (!visibility) return undefined;
  return { ...(suppliedStart === undefined ? {} : { suppliedStart }), historyLimit, visibility, models };
}

function readVisibility(value: unknown, push: (path: string, code: DiagnosticCode) => void): ScenarioDefinition["configuration"]["visibility"] | undefined {
  if (value === undefined) return { defaultMode: "visible", byType: {}, summaryFields: {} };
  const record = object(value, "/configuration/visibility", visibilityKeys, push);
  if (!record) return undefined;
  const mode = record.defaultMode ?? "visible";
  if (typeof mode !== "string" || !visibilityModes.has(mode)) { push("/configuration/visibility/defaultMode", DiagnosticCodes.TYPE); return undefined; }
  const byType: Record<string, "visible" | "summary" | "redacted" | "omitted"> = {};
  if (record.byType !== undefined) {
    const map = object(record.byType, "/configuration/visibility/byType", [], push, true);
    if (!map) return undefined;
    for (const [key, item] of Object.entries(map)) {
      if (!/^[a-z]+(?:[a-z0-9-]*)(?:\.[a-z][a-z0-9-]*)+$/.test(key) || typeof item !== "string" || !visibilityModes.has(item)) {
        push(pointer("/configuration/visibility/byType", key), DiagnosticCodes.TYPE);
      } else byType[key] = item as "visible" | "summary" | "redacted" | "omitted";
    }
  }
  const summaryFields: Record<string, readonly string[]> = {};
  if (record.summaryFields !== undefined) {
    const map = object(record.summaryFields, "/configuration/visibility/summaryFields", [], push, true);
    if (!map) return undefined;
    for (const [key, item] of Object.entries(map)) {
      if (!Array.isArray(item) || item.some(field => typeof field !== "string" || field.length === 0)) {
        push(pointer("/configuration/visibility/summaryFields", key), DiagnosticCodes.TYPE);
      } else summaryFields[key] = [...item];
    }
  }
  return { defaultMode: mode as "visible" | "summary" | "redacted" | "omitted", byType, summaryFields };
}

interface ArchitectureDraft {
  readonly definition: ArchitectureDefinition;
  readonly components: readonly ComponentInstance[];
  readonly byId: ReadonlyMap<string, ComponentInstance>;
  readonly serviceIds: ReadonlySet<string>;
  readonly databaseOwners: ReadonlySet<string>;
}

function readArchitecture(value: unknown, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): ArchitectureDraft | undefined {
  if (value === undefined) { push("/architecture", DiagnosticCodes.REQUIRED); return undefined; }
  const record = object(value, "/architecture", architectureKeys, push);
  if (!record) return undefined;
  const components = readComponents(record.components, catalog, push);
  if (!components) return undefined;
  const byId = new Map(components.map(component => [component.id, component]));
  const serviceIds = new Set(components.filter(component => component.kind === "service").map(component => component.id));
  const links = readLinks(record.links, byId, push);
  const databases = readDatabases(record.databases, components, catalog, push);
  const stores = readStores(record.stores, components, push);
  const destinations = readDestinations(record.destinations, push);
  const subscriptions = readSubscriptions(record.subscriptions, destinations, components, catalog, push);
  if (!links || !databases || !stores || !destinations || !subscriptions) return undefined;
  return {
    definition: { components, links, databases: databases.definitions, stores, destinations, subscriptions },
    components, byId, serviceIds, databaseOwners: databases.owners,
  };
}

function readComponents(value: unknown, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): ComponentInstance[] | undefined {
  const items = array(value, "/architecture/components", push);
  if (!items) return undefined;
  const seen = new Set<string>();
  const components: ComponentInstance[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/components/${index}`;
    const record = object(items[index], path, componentKeys, push);
    if (!record) continue;
    const id = text(record.id, `${path}/id`, push, true);
    const kind = text(record.kind, `${path}/kind`, push, false);
    const model = text(record.model, `${path}/model`, push, true);
    const version = text(record.version, `${path}/version`, push, true);
    let configuration: CanonicalValue = {};
    if (record.configuration !== undefined) {
      const copied = copyCanonical(record.configuration, `${path}/configuration`, push);
      if (copied !== undefined) configuration = copied;
    }
    if (!id || !kind || !model || !version) continue;
    if (!componentKinds.has(kind)) push(`${path}/kind`, DiagnosticCodes.KIND);
    if (seen.has(id)) push(`${path}/id`, DiagnosticCodes.DUPLICATE);
    seen.add(id);
    const resolved = catalog.find(model, version);
    if (!resolved) push(catalog.versions(model).length ? `${path}/version` : `${path}/model`, catalog.versions(model).length ? DiagnosticCodes.VERSION : DiagnosticCodes.UNKNOWN_MODEL);
    else if (componentKinds.has(kind) && resolved.kind !== kind) push(`${path}/kind`, DiagnosticCodes.KIND);
    if (!componentKinds.has(kind) || !resolved || resolved.kind !== kind) continue;
    components.push({ id, kind: kind as ComponentKind, model, version, configuration });
  }
  return components;
}

function readLinks(value: unknown, byId: ReadonlyMap<string, ComponentInstance>, push: (path: string, code: DiagnosticCode) => void): ArchitectureDefinition["links"] | undefined {
  const items = array(value, "/architecture/links", push);
  if (!items) return undefined;
  const seen = new Set<string>();
  const links: ArchitectureDefinition["links"][number][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/links/${index}`;
    const record = object(items[index], path, linkKeys, push);
    if (!record) continue;
    const source = text(record.source, `${path}/source`, push, true);
    const target = text(record.target, `${path}/target`, push, true);
    const policy = readPolicy(record.policy, `${path}/policy`, push);
    if (!source || !target || !policy) continue;
    if (!byId.has(source)) push(`${path}/source`, DiagnosticCodes.UNKNOWN_COMPONENT);
    if (!byId.has(target)) push(`${path}/target`, DiagnosticCodes.UNKNOWN_COMPONENT);
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) push(path, DiagnosticCodes.LINK);
    seen.add(key);
    links.push({ source, target, policy });
  }
  return links;
}

function readPolicy(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): NetworkPolicy | undefined {
  const defaults = { requestLatency: 0, responseLatency: 0, jitter: 0, timeout: 1000, failureRate: 0 };
  if (value === undefined) return freezePolicy(defaults);
  const record = object(value, path, policyKeys, push);
  if (!record) return undefined;
  const numbers = { ...defaults };
  for (const key of ["requestLatency", "responseLatency", "jitter", "timeout"] as const) {
    if (record[key] === undefined) continue;
    const parsed = whole(record[key], `${path}/${key}`, push);
    if (parsed === undefined) return undefined;
    numbers[key] = parsed;
  }
  if (numbers.timeout === 0) push(`${path}/timeout`, DiagnosticCodes.TYPE);
  if (record.failureRate !== undefined) {
    if (typeof record.failureRate !== "number" || !Number.isFinite(record.failureRate) || record.failureRate < 0 || record.failureRate > 1) {
      push(`${path}/failureRate`, DiagnosticCodes.TYPE);
    } else numbers.failureRate = record.failureRate;
  }
  if (numbers.timeout === 0) return undefined;
  return freezePolicy(numbers);
}

function freezePolicy(value: { requestLatency: number; responseLatency: number; jitter: number; timeout: number; failureRate: number }): NetworkPolicy {
  return Object.freeze({
    requestLatency: duration(value.requestLatency),
    responseLatency: duration(value.responseLatency),
    jitter: duration(value.jitter),
    timeout: duration(value.timeout),
    failureRate: value.failureRate,
  });
}

function readDatabases(value: unknown, components: readonly ComponentInstance[], catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): { definitions: ArchitectureDefinition["databases"]; owners: Set<string> } | undefined {
  const items = array(value, "/architecture/databases", push);
  if (!items) return undefined;
  const owners = new Set<string>();
  const byId = new Map(components.map(component => [component.id, component]));
  const definitions: ArchitectureDefinition["databases"][number][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/databases/${index}`;
    const record = object(items[index], path, databaseKeys, push);
    if (!record) continue;
    const owner = text(record.owner, `${path}/owner`, push, true);
    const tables = readTables(record.tables, `${path}/tables`, push);
    if (!owner || !tables) continue;
    const component = byId.get(owner);
    if (!component) push(`${path}/owner`, DiagnosticCodes.UNKNOWN_COMPONENT);
    else if (component.kind !== "service") push(`${path}/owner`, DiagnosticCodes.OWNERSHIP);
    if (owners.has(owner)) push(`${path}/owner`, DiagnosticCodes.DUPLICATE);
    owners.add(owner);
    const model = component ? catalog.find(component.model, component.version) : undefined;
    const initial = readInitialRows(record.initial, tables, model, `${path}/initial`, push);
    if (!initial) continue;
    definitions.push({ owner, tables, initial });
  }
  return { definitions, owners };
}

function readTables(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): ArchitectureDefinition["databases"][number]["tables"] | undefined {
  const items = array(value, path, push);
  if (!items) return undefined;
  const names = new Set<string>();
  const tables: ArchitectureDefinition["databases"][number]["tables"][number][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const tablePath = `${path}/${index}`;
    const record = object(items[index], tablePath, tableKeys, push);
    if (!record) continue;
    const name = text(record.name, `${tablePath}/name`, push, true);
    if (!name) continue;
    if (names.has(name)) push(`${tablePath}/name`, DiagnosticCodes.DUPLICATE);
    names.add(name);
    const unique = readUnique(record.unique, `${tablePath}/unique`, push);
    const checks = readNames(record.checks, `${tablePath}/checks`, push);
    if (!unique || !checks) continue;
    tables.push({ name, unique, checks });
  }
  return tables;
}

function readUnique(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): readonly (readonly string[])[] | undefined {
  if (value === undefined) return [];
  const items = array(value, path, push);
  if (!items) return undefined;
  const unique: string[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const fields = array(items[index], `${path}/${index}`, push);
    if (!fields || fields.length === 0 || fields.some(field => typeof field !== "string" || field.trim().length === 0) || new Set(fields).size !== fields.length) {
      push(`${path}/${index}`, DiagnosticCodes.TYPE);
      continue;
    }
    unique.push([...(fields as string[])]);
  }
  return unique;
}

function readNames(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): readonly string[] | undefined {
  if (value === undefined) return [];
  const items = array(value, path, push);
  if (!items) return undefined;
  if (items.some(item => typeof item !== "string" || item.trim().length === 0)) { push(path, DiagnosticCodes.TYPE); return undefined; }
  return [...(items as string[])];
}

function readInitialRows(value: unknown, tables: readonly { name: string; unique: readonly (readonly string[])[]; checks: readonly string[] }[], model: ScenarioModel | undefined, path: string, push: (path: string, code: DiagnosticCode) => void): ArchitectureDefinition["databases"][number]["initial"] | undefined {
  const record = value === undefined ? {} : object(value, path, tables.map(table => table.name), push, true);
  if (!record) return undefined;
  const known = new Set(tables.map(table => table.name));
  for (const key of Object.keys(record)) if (!known.has(key)) push(pointer(path, key), DiagnosticCodes.REFERENCE);
  const initial: Record<string, Record<string, CanonicalValue>> = {};
  let ok = true;
  for (const table of tables) {
    const rows = record[table.name] === undefined ? {} : object(record[table.name], `${path}/${table.name}`, [], push, true);
    if (!rows) { ok = false; continue; }
    const copied: Record<string, CanonicalValue> = {};
    const tuples = new Set<string>();
    for (const [key, row] of Object.entries(rows)) {
      if (!key.trim()) { push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.TYPE); ok = false; continue; }
      const body = copyCanonical(row, pointer(`${path}/${table.name}`, key), push);
      if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
        if (body !== undefined) push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.TYPE);
        ok = false;
        continue;
      }
      copied[key] = body;
      for (const check of table.checks) {
        const fn = model?.checks[check];
        if (!fn) { push(`${path}/${table.name}`, DiagnosticCodes.REFERENCE); ok = false; continue; }
        try {
          if (fn(body as never) !== true) push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.CONSTRAINT);
        } catch { push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.CONSTRAINT); }
      }
      for (const fields of table.unique) {
        if (fields.some(field => !Object.hasOwn(body, field))) { push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.CONSTRAINT); continue; }
        const tuple = `${fields.join("\u0000")}:${canonicalEncode(fields.map(field => (body as Record<string, CanonicalValue>)[field]!) as CanonicalValue)}`;
        if (tuples.has(tuple)) push(pointer(`${path}/${table.name}`, key), DiagnosticCodes.CONSTRAINT);
        tuples.add(tuple);
      }
    }
    initial[table.name] = copied;
  }
  return ok ? initial as ArchitectureDefinition["databases"][number]["initial"] : undefined;
}

function readStores(value: unknown, components: readonly ComponentInstance[], push: (path: string, code: DiagnosticCode) => void): readonly KeyValueDefinition[] | undefined {
  const items = array(value, "/architecture/stores", push);
  if (!items) return undefined;
  const known = new Set(components.map(component => component.id));
  const serviceIds = new Set(components.filter(component => component.kind === "service").map(component => component.id));
  const owners = new Set<string>();
  const stores: KeyValueDefinition[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/stores/${index}`;
    const record = object(items[index], path, storeKeys, push);
    if (!record) continue;
    const owner = text(record.owner, `${path}/owner`, push, true);
    const initialItems = array(record.initial, `${path}/initial`, push);
    if (!owner || !initialItems) continue;
    if (!known.has(owner)) push(`${path}/owner`, DiagnosticCodes.UNKNOWN_COMPONENT);
    else if (!serviceIds.has(owner)) push(`${path}/owner`, DiagnosticCodes.OWNERSHIP);
    if (owners.has(owner)) push(`${path}/owner`, DiagnosticCodes.DUPLICATE);
    owners.add(owner);
    const keys = new Set<string>();
    const initial: KeyValueDefinition["initial"][number][] = [];
    for (let itemIndex = 0; itemIndex < initialItems.length; itemIndex += 1) {
      const itemPath = `${path}/initial/${itemIndex}`;
      const item = object(initialItems[itemIndex], itemPath, storeItemKeys, push);
      if (!item) continue;
      const key = text(item.key, `${itemPath}/key`, push, true);
      const copied = item.value === undefined ? undefined : copyCanonical(item.value, `${itemPath}/value`, push);
      if (item.value === undefined) push(`${itemPath}/value`, DiagnosticCodes.REQUIRED);
      if (!key || copied === undefined) continue;
      if (keys.has(key)) push(`${itemPath}/key`, DiagnosticCodes.DUPLICATE);
      keys.add(key);
      let ttl: ReturnType<typeof duration> | undefined;
      if (item.ttl !== undefined) {
        const parsed = whole(item.ttl, `${itemPath}/ttl`, push);
        if (parsed === undefined || parsed === 0) { if (parsed === 0) push(`${itemPath}/ttl`, DiagnosticCodes.TYPE); continue; }
        ttl = duration(parsed);
      }
      initial.push({ key, value: copied, ...(ttl === undefined ? {} : { ttl }) });
    }
    stores.push({ owner, initial });
  }
  return stores;
}

function readDestinations(value: unknown, push: (path: string, code: DiagnosticCode) => void): DestinationDefinition[] | undefined {
  const items = array(value, "/architecture/destinations", push);
  if (!items) return undefined;
  const seen = new Set<string>();
  const destinations: DestinationDefinition[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/destinations/${index}`;
    const record = object(items[index], path, destinationKeys, push);
    if (!record) continue;
    const id = text(record.id, `${path}/id`, push, true);
    const kind = text(record.kind, `${path}/kind`, push, false);
    if (!id || !kind) continue;
    if (!destinationKinds.has(kind)) push(`${path}/kind`, DiagnosticCodes.TYPE);
    if (seen.has(id)) push(`${path}/id`, DiagnosticCodes.DUPLICATE);
    seen.add(id);
    const deliveryDelay = optionalWhole(record.deliveryDelay, `${path}/deliveryDelay`, 0, push);
    const retryDelay = optionalWhole(record.retryDelay, `${path}/retryDelay`, 0, push);
    const ackTimeout = optionalWhole(record.ackTimeout, `${path}/ackTimeout`, 1000, push);
    const maxAttempts = optionalWhole(record.maxAttempts, `${path}/maxAttempts`, 3, push);
    const capacity = optionalWhole(record.capacity, `${path}/capacity`, 10000, push);
    if ([deliveryDelay, retryDelay, ackTimeout, maxAttempts, capacity].some(item => item === undefined)) continue;
    if (ackTimeout === 0 || maxAttempts === 0 || capacity === 0) { push(path, DiagnosticCodes.TYPE); continue; }
    destinations.push({
      id, kind: kind as "queue" | "topic", deliveryDelay: duration(deliveryDelay!), ackTimeout: duration(ackTimeout!),
      retryDelay: duration(retryDelay!), maxAttempts: maxAttempts!, capacity: capacity!,
    });
  }
  return destinations;
}

function readSubscriptions(value: unknown, destinations: readonly DestinationDefinition[] | undefined, components: readonly ComponentInstance[] | undefined, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): ArchitectureDefinition["subscriptions"] | undefined {
  const items = array(value, "/architecture/subscriptions", push);
  if (!items || !destinations || !components) return undefined;
  const destinationIds = new Set(destinations.map(destination => destination.id));
  const byId = new Map(components.map(component => [component.id, component]));
  const seen = new Set<string>();
  const declared = new Map<string, Set<string>>();
  const subscriptions: ArchitectureDefinition["subscriptions"][number][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/architecture/subscriptions/${index}`;
    const record = object(items[index], path, subscriptionKeys, push);
    if (!record) continue;
    const destination = text(record.destination, `${path}/destination`, push, true);
    const consumer = text(record.consumer, `${path}/consumer`, push, true);
    if (!destination || !consumer) continue;
    if (!destinationIds.has(destination)) push(`${path}/destination`, DiagnosticCodes.REFERENCE);
    const component = byId.get(consumer);
    if (!component) push(`${path}/consumer`, DiagnosticCodes.UNKNOWN_COMPONENT);
    else if (component.kind !== "service") push(`${path}/consumer`, DiagnosticCodes.SUBSCRIPTION);
    const key = `${destination}\u0000${consumer}`;
    if (seen.has(key)) push(path, DiagnosticCodes.DUPLICATE);
    seen.add(key);
    const model = component ? catalog.find(component.model, component.version) : undefined;
    if (model && !model.consumers.includes(destination)) push(path, DiagnosticCodes.SUBSCRIPTION);
    const owned = declared.get(consumer) ?? new Set<string>();
    owned.add(destination);
    declared.set(consumer, owned);
    subscriptions.push({ destination, consumer });
  }
  for (const component of components) {
    if (component.kind !== "service") continue;
    const model = catalog.find(component.model, component.version);
    const owned = declared.get(component.id) ?? new Set<string>();
    for (const consumer of model?.consumers ?? []) if (!owned.has(consumer)) push("/architecture/subscriptions", DiagnosticCodes.SUBSCRIPTION);
  }
  return subscriptions;
}

function readExternal(value: unknown, components: readonly ComponentInstance[] | undefined, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): ScenarioDefinition["external"] | undefined {
  const items = array(value, "/external", push);
  if (!items) return undefined;
  const byId = new Map((components ?? []).map(component => [component.id, component]));
  const seen = new Set<string>();
  const external: ScenarioDefinition["external"][number][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/external/${index}`;
    const record = object(items[index], path, externalKeys, push);
    if (!record) continue;
    const target = text(record.target, `${path}/target`, push, true);
    const operation = text(record.operation, `${path}/operation`, push, true);
    const behavior = readBehavior(record.behavior, `${path}/behavior`, push);
    if (!target || !operation || !behavior) continue;
    const component = byId.get(target);
    if (!component) push(`${path}/target`, DiagnosticCodes.UNKNOWN_COMPONENT);
    else if (component.kind !== "external") push(`${path}/target`, DiagnosticCodes.REFERENCE);
    const model = component ? catalog.find(component.model, component.version) : undefined;
    if (model && !model.operations.includes(operation)) push(`${path}/operation`, DiagnosticCodes.UNKNOWN_OPERATION);
    const key = `${target}\u0000${operation}`;
    if (seen.has(key)) push(path, DiagnosticCodes.DUPLICATE);
    seen.add(key);
    external.push({ target, operation, behavior });
  }
  return external;
}

function readBehavior(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): ExternalBehavior | undefined {
  const record = object(value, path, behaviorKeys, push);
  if (!record) return undefined;
  const latency = requiredWhole(record.latency, `${path}/latency`, push);
  const degradedExtraLatency = requiredWhole(record.degradedExtraLatency, `${path}/degradedExtraLatency`, push);
  if (typeof record.dropResponse !== "boolean") push(`${path}/dropResponse`, record.dropResponse === undefined ? DiagnosticCodes.REQUIRED : DiagnosticCodes.TYPE);
  const parameters = record.parameters === undefined ? undefined : copyCanonical(record.parameters, `${path}/parameters`, push);
  if (record.parameters === undefined) push(`${path}/parameters`, DiagnosticCodes.REQUIRED);
  if (latency === undefined || degradedExtraLatency === undefined || typeof record.dropResponse !== "boolean" || parameters === undefined) return undefined;
  return Object.freeze({ latency: duration(latency), degradedExtraLatency: duration(degradedExtraLatency), dropResponse: record.dropResponse, parameters });
}

function readFaults(value: unknown, architecture: ArchitectureDraft | undefined, startTime: SimulationTime, push: (path: string, code: DiagnosticCode) => void): { rules: FaultRule[] } | undefined {
  const items = array(value, "/faults", push);
  if (!items) return undefined;
  const rules: FaultRule[] = [];
  const drafts: RuleDraft[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const path = `/faults/${index}`;
    const draft = readFaultRule(items[index], path, architecture, startTime, push);
    if (!draft) continue;
    if (ids.has(draft.id)) push(`${path}/id`, DiagnosticCodes.DUPLICATE);
    ids.add(draft.id);
    drafts.push(draft);
    rules.push(freezeRule(draft));
  }
  for (let left = 0; left < drafts.length; left += 1) for (let right = left + 1; right < drafts.length; right += 1) {
    const a = drafts[left]!;
    const b = drafts[right]!;
    if (a.effect.kind === "duplicate" && b.effect.kind === "duplicate" && a.point === b.point && selectorsOverlap(a, b) && rangesOverlap(a, b)) {
      push(b.path, DiagnosticCodes.FAULT);
    }
  }
  return rules.length === drafts.length ? { rules } : { rules };
}

function readFaultRule(value: unknown, path: string, architecture: ArchitectureDraft | undefined, startTime: SimulationTime, push: (path: string, code: DiagnosticCode) => void): RuleDraft | undefined {
  const record = object(value, path, faultKeys, push);
  if (!record) return undefined;
  const id = text(record.id, `${path}/id`, push, true);
  const point = text(record.point, `${path}/point`, push, false);
  const from = readTime(record.from, `${path}/from`, push);
  if (record.from === undefined) push(`${path}/from`, DiagnosticCodes.REQUIRED);
  const probability = record.probability === undefined ? 1 : record.probability;
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) push(`${path}/probability`, DiagnosticCodes.FAULT);
  const maxApplications = record.maxApplications === undefined ? 1 : whole(record.maxApplications, `${path}/maxApplications`, push);
  if (record.maxApplications !== undefined && maxApplications === 0) push(`${path}/maxApplications`, DiagnosticCodes.FAULT);
  const effect = readEffect(record.effect, `${path}/effect`, push);
  if (!id || !point || from === undefined || typeof probability !== "number" || !maxApplications || !effect) return undefined;
  if (!faultPoints.has(point)) { push(`${path}/point`, DiagnosticCodes.FAULT); return undefined; }
  if (from < startTime) push(`${path}/from`, DiagnosticCodes.BEFORE_START);
  const source = optionalComponent(record.source, `${path}/source`, architecture, push);
  const target = optionalComponent(record.target, `${path}/target`, architecture, push);
  const name = record.name === undefined ? undefined : text(record.name, `${path}/name`, push, true);
  const until = record.until === undefined ? undefined : readTime(record.until, `${path}/until`, push);
  if (until !== undefined && until <= from) push(`${path}/until`, DiagnosticCodes.FAULT);
  if (until !== undefined && until < startTime) push(`${path}/until`, DiagnosticCodes.BEFORE_START);
  const occurrence = record.occurrence === undefined ? undefined : whole(record.occurrence, `${path}/occurrence`, push);
  if (occurrence === 0) push(`${path}/occurrence`, DiagnosticCodes.FAULT);
  if (!effectApplies(point, effect)) push(`${path}/effect`, DiagnosticCodes.FAULT);
  if (point === "database.commit" && name !== undefined && architecture && !architecture.databaseOwners.has(name)) push(`${path}/name`, DiagnosticCodes.REFERENCE);
  return {
    id, point: point as FaultRule["point"], from, probability, maxApplications, effect, path,
    ...(source ? { source } : {}), ...(target ? { target } : {}), ...(name ? { name } : {}),
    ...(until !== undefined ? { until } : {}), ...(occurrence ? { occurrence } : {}),
  };
}

function readEffect(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): FaultEffect | undefined {
  const record = object(value, path, ["kind", "duration", "additionalCopies", "spacing"], push);
  if (!record) return undefined;
  const kind = text(record.kind, `${path}/kind`, push, false);
  if (!kind) return undefined;
  if (kind === "delay") {
    const amount = requiredWhole(record.duration, `${path}/duration`, push);
    rejectExtra(record, ["kind", "duration"], path, push);
    return amount === undefined ? undefined : { kind: "delay", duration: duration(amount) };
  }
  if (kind === "duplicate") {
    const copies = requiredWhole(record.additionalCopies, `${path}/additionalCopies`, push);
    const spacing = requiredWhole(record.spacing, `${path}/spacing`, push);
    rejectExtra(record, ["kind", "additionalCopies", "spacing"], path, push);
    if (copies === undefined || spacing === undefined) return undefined;
    if (copies === 0 || copies > 16) push(`${path}/additionalCopies`, DiagnosticCodes.FAULT);
    return { kind: "duplicate", additionalCopies: copies, spacing: duration(spacing) };
  }
  if (kind === "drop" || kind === "fail" || kind === "disconnect") {
    rejectExtra(record, ["kind"], path, push);
    return { kind };
  }
  push(`${path}/kind`, DiagnosticCodes.FAULT);
  return undefined;
}

function effectApplies(point: string, effect: FaultEffect): boolean {
  if (point === "database.commit") return effect.kind === "fail";
  if (effect.kind === "fail") return false;
  if (effect.kind === "duplicate") return point === "message.delivery";
  if (effect.kind === "disconnect") return point === "network.request";
  return effect.kind === "delay" || effect.kind === "drop";
}

function selectorsOverlap(left: RuleDraft, right: RuleDraft): boolean {
  return (["source", "target", "name"] as const).every(key => left[key] === undefined || right[key] === undefined || left[key] === right[key]);
}
function rangesOverlap(left: RuleDraft, right: RuleDraft): boolean {
  return (left.until === undefined || right.from < left.until) && (right.until === undefined || left.from < right.until);
}
function freezeRule(draft: RuleDraft): FaultRule {
  return Object.freeze({
    id: draft.id, point: draft.point, from: draft.from, probability: draft.probability, maxApplications: draft.maxApplications,
    effect: Object.freeze({ ...draft.effect }),
    ...(draft.source ? { source: draft.source } : {}), ...(draft.target ? { target: draft.target } : {}),
    ...(draft.name ? { name: draft.name } : {}), ...(draft.until !== undefined ? { until: draft.until } : {}),
    ...(draft.occurrence ? { occurrence: draft.occurrence } : {}),
  });
}

function readActions(value: unknown, components: readonly ComponentInstance[] | undefined, catalog: ScenarioCatalog, startTime: SimulationTime, push: (path: string, code: DiagnosticCode) => void): ScenarioAction[] | undefined {
  const items = array(value, "/actions", push);
  if (!items) return undefined;
  const byId = new Map((components ?? []).map(component => [component.id, component]));
  const ids = new Set<string>();
  const actions: ScenarioAction[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/actions/${index}`;
    const record = object(items[index], path, actionKeys(items[index]), push);
    if (!record) continue;
    const id = text(record.id, `${path}/id`, push, true);
    const at = readTime(record.at, `${path}/at`, push);
    if (record.at === undefined) push(`${path}/at`, DiagnosticCodes.REQUIRED);
    const kind = text(record.kind, `${path}/kind`, push, false);
    if (!id || at === undefined || !kind) continue;
    if (!actionKinds.has(kind)) { push(`${path}/kind`, DiagnosticCodes.TYPE); continue; }
    if (ids.has(id)) push(`${path}/id`, DiagnosticCodes.DUPLICATE);
    ids.add(id);
    if (at < startTime) push(`${path}/at`, DiagnosticCodes.BEFORE_START);
    const action = readAction(kind, id, at, record, path, byId, catalog, push);
    if (action) actions.push(action);
  }
  return actions;
}

function actionKeys(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [...actionBase, "target", "action", "data", "state", "operation", "behavior", "fault"];
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "client") return [...actionBase, "target", "action", "data"];
  if (kind === "service" || kind === "external") return [...actionBase, "target", "state"];
  if (kind === "external-behavior") return [...actionBase, "target", "operation", "behavior"];
  if (kind === "fault") return [...actionBase, "fault"];
  return [...actionBase, "target", "action", "data", "state", "operation", "behavior", "fault"];
}

function readAction(kind: string, id: string, at: SimulationTime, record: Record<string, unknown>, path: string, byId: ReadonlyMap<string, ComponentInstance>, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): ScenarioAction | undefined {
  if (kind === "fault") return readFaultAction(id, at, record.fault, `${path}/fault`, byId, push);
  const target = text(record.target, `${path}/target`, push, true);
  if (!target) return undefined;
  const component = byId.get(target);
  if (!component) { push(`${path}/target`, DiagnosticCodes.UNKNOWN_COMPONENT); return undefined; }
  const model = catalog.find(component.model, component.version);
  if (kind === "client") {
    if (component.kind !== "client") push(`${path}/target`, DiagnosticCodes.REFERENCE);
    const action = text(record.action, `${path}/action`, push, true);
    const data = record.data === undefined ? undefined : copyCanonical(record.data, `${path}/data`, push);
    if (record.data === undefined) push(`${path}/data`, DiagnosticCodes.REQUIRED);
    if (!action || data === undefined) return undefined;
    if (model && !model.actions.includes(action)) push(`${path}/action`, DiagnosticCodes.UNKNOWN_ACTION);
    return { id, at, kind: "client", target, action, data };
  }
  if (kind === "service") {
    if (component.kind !== "service") push(`${path}/target`, DiagnosticCodes.REFERENCE);
    const state = text(record.state, `${path}/state`, push, false);
    if (!state) return undefined;
    if (!serviceStates.has(state)) { push(`${path}/state`, DiagnosticCodes.STATE); return undefined; }
    return { id, at, kind: "service", target, state: state as "STARTING" | "RUNNING" | "PAUSED" | "CRASHED" | "STOPPED" };
  }
  if (kind === "external") {
    if (component.kind !== "external") push(`${path}/target`, DiagnosticCodes.REFERENCE);
    const state = text(record.state, `${path}/state`, push, false);
    if (!state) return undefined;
    if (!availability.has(state)) { push(`${path}/state`, DiagnosticCodes.STATE); return undefined; }
    return { id, at, kind: "external", target, state: state as "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" };
  }
  if (component.kind !== "external") push(`${path}/target`, DiagnosticCodes.REFERENCE);
  const operation = text(record.operation, `${path}/operation`, push, true);
  const behavior = readBehavior(record.behavior, `${path}/behavior`, push);
  if (!operation || !behavior) return undefined;
  if (model && !model.operations.includes(operation)) push(`${path}/operation`, DiagnosticCodes.UNKNOWN_OPERATION);
  return { id, at, kind: "external-behavior", target, operation, behavior };
}

function readFaultAction(id: string, at: SimulationTime, value: unknown, path: string, byId: ReadonlyMap<string, ComponentInstance>, push: (path: string, code: DiagnosticCode) => void): ScenarioAction | undefined {
  const record = object(value, path, ["id", "kind", "target", "state"], push);
  if (!record) return undefined;
  const faultId = text(record.id, `${path}/id`, push, true);
  const kind = text(record.kind, `${path}/kind`, push, false);
  const target = text(record.target, `${path}/target`, push, true);
  if (!faultId || !kind || !target) return undefined;
  const component = byId.get(target);
  if (!component) push(`${path}/target`, DiagnosticCodes.UNKNOWN_COMPONENT);
  if (kind === "crash") {
    rejectExtra(record, ["id", "kind", "target"], path, push);
    if (component && component.kind !== "service") push(`${path}/target`, DiagnosticCodes.FAULT);
    const fault: ScheduledFault = { id: faultId, kind: "crash", target };
    return { id, at, kind: "fault", fault };
  }
  if (kind === "external-availability") {
    const state = text(record.state, `${path}/state`, push, false);
    if (!state) return undefined;
    if (!availability.has(state)) push(`${path}/state`, DiagnosticCodes.STATE);
    if (component && component.kind !== "external") push(`${path}/target`, DiagnosticCodes.FAULT);
    if (!availability.has(state)) return undefined;
    return { id, at, kind: "fault", fault: { id: faultId, kind: "external-availability", target, state: state as "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" } };
  }
  push(`${path}/kind`, DiagnosticCodes.FAULT);
  return undefined;
}

function readAssertions(value: unknown, assessment: ScenarioAssessment, startTime: SimulationTime, push: (path: string, code: DiagnosticCode) => void): ScenarioAssertion[] | undefined {
  const items = array(value, "/assertions", push);
  if (!items) return undefined;
  const ids = new Set<string>();
  const assertions: ScenarioAssertion[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const path = `/assertions/${index}`;
    const record = object(items[index], path, ["id", "predicate", "parameters", "mode", "at", "deadline"], push);
    if (!record) continue;
    const id = text(record.id, `${path}/id`, push, true);
    const predicate = text(record.predicate, `${path}/predicate`, push, true);
    const mode = text(record.mode, `${path}/mode`, push, false);
    const parameters = record.parameters === undefined ? undefined : copyCanonical(record.parameters, `${path}/parameters`, push);
    if (record.parameters === undefined) push(`${path}/parameters`, DiagnosticCodes.REQUIRED);
    if (!id || !predicate || !mode || parameters === undefined) continue;
    if (!assertionModes.has(mode)) { push(`${path}/mode`, DiagnosticCodes.TYPE); continue; }
    if (ids.has(id)) push(`${path}/id`, DiagnosticCodes.DUPLICATE);
    ids.add(id);
    if (!assessment.find(predicate)) push(`${path}/predicate`, DiagnosticCodes.UNKNOWN_PREDICATE);
    const at = record.at === undefined ? undefined : readTime(record.at, `${path}/at`, push);
    const deadline = record.deadline === undefined ? undefined : readTime(record.deadline, `${path}/deadline`, push);
    if (mode === "at" && (at === undefined || record.deadline !== undefined)) push(path, DiagnosticCodes.ASSERTION_TIMING);
    if (mode === "eventually" && (deadline === undefined || record.at !== undefined)) push(path, DiagnosticCodes.ASSERTION_TIMING);
    if (mode === "always" && (record.at !== undefined || record.deadline !== undefined)) push(path, DiagnosticCodes.ASSERTION_TIMING);
    if (at !== undefined && at < startTime) push(`${path}/at`, DiagnosticCodes.BEFORE_START);
    if (deadline !== undefined && deadline < startTime) push(`${path}/deadline`, DiagnosticCodes.BEFORE_START);
    if (mode === "at" && at === undefined) continue;
    if (mode === "eventually" && deadline === undefined) continue;
    assertions.push({
      id, predicate, parameters, mode: mode as ScenarioAssertion["mode"],
      ...(mode === "at" && at !== undefined ? { at } : {}),
      ...(mode === "eventually" && deadline !== undefined ? { deadline } : {}),
    });
  }
  return assertions;
}

function actionPath(actions: readonly ScenarioAction[], action: ScenarioAction): string {
  const index = actions.indexOf(action);
  return `/actions/${index}/fault/id`;
}

function optionalComponent(value: unknown, path: string, architecture: ArchitectureDraft | undefined, push: (path: string, code: DiagnosticCode) => void): string | undefined {
  if (value === undefined) return undefined;
  const id = text(value, path, push, true);
  if (id && architecture && !architecture.byId.has(id)) push(path, DiagnosticCodes.UNKNOWN_COMPONENT);
  return id;
}

function rejectExtra(record: Record<string, unknown>, allowed: readonly string[], path: string, push: (path: string, code: DiagnosticCode) => void): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) push(pointer(path, key), DiagnosticCodes.UNSUPPORTED);
}

function object(value: unknown, path: string, allowed: readonly string[], push: (path: string, code: DiagnosticCode) => void, open = false): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    push(path || "/", DiagnosticCodes.TYPE);
    return undefined;
  }
  if (!open) for (const key of Object.keys(value)) if (!allowed.includes(key)) push(pointer(path, key), DiagnosticCodes.UNSUPPORTED);
  try { canonicalCopy(value); } catch { push(path || "/", DiagnosticCodes.CANONICAL); return undefined; }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): unknown[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { push(path, DiagnosticCodes.TYPE); return undefined; }
  try { canonicalCopy(value); } catch { push(path, DiagnosticCodes.CANONICAL); return undefined; }
  return value;
}

function text(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void, trim: boolean): string | undefined {
  if (value === undefined) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  if (typeof value !== "string") { push(path, DiagnosticCodes.TYPE); return undefined; }
  if (trim ? value.trim().length === 0 : value.length === 0) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  return value;
}

function readTime(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): SimulationTime | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") { push(path, DiagnosticCodes.TYPE); return undefined; }
  try { return simulationTime(value); } catch { push(path, DiagnosticCodes.TIME); return undefined; }
}

function whole(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) { push(path, DiagnosticCodes.TYPE); return undefined; }
  return value;
}

function requiredWhole(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): number | undefined {
  if (value === undefined) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  return whole(value, path, push);
}

function optionalWhole(value: unknown, path: string, fallback: number, push: (path: string, code: DiagnosticCode) => void): number | undefined {
  if (value === undefined) return fallback;
  return whole(value, path, push);
}

function copyCanonical(value: unknown, path: string, push: (path: string, code: DiagnosticCode) => void): CanonicalValue | undefined {
  try { return canonicalCopy(value); } catch { push(path, DiagnosticCodes.CANONICAL); return undefined; }
}

function pointer(base: string, token: string): string {
  return `${base}/${token.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}
