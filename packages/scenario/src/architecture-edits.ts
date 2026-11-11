import type {
  ArchitectureEdits,
  BindingEdit,
  LessonArchitectureAllowance,
  LessonParameterDomain,
  ModelDescriptor,
  ParameterOverride,
  ResourceEdit,
  ScenarioDiagnostic,
  SlotEdit,
  SubscriptionEdit,
} from "@distlab/contracts";
import { OverlayDiagnosticCodes } from "@distlab/contracts";
import type { CanonicalValue } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "@distlab/kernel";
import { DiagnosticCodes } from "./types.js";

/**
 * Architecture edits in session overlays (ADR-005). Pure functions of the
 * packaged document, the lesson's architecture allowance, the catalog's
 * data-only descriptors, and the submitted edits. Nothing here creates a model,
 * allocates a simulation identity, or draws randomness.
 */

/** The descriptor lookup the edits need; a `ScenarioCatalog` satisfies it. */
export interface DescriptorSource {
  find(model: string, version: string): ModelDescriptor | undefined;
}

/** What stage 3 needs besides the overlay and the policy. */
export interface OverlayContext {
  readonly packaged: CanonicalValue;
  readonly catalog: DescriptorSource;
}

type Doc = Record<string, CanonicalValue>;
type Push = (path: string, code: string) => void;
type ListName = "slots" | "bindings" | "resources" | "subscriptions";

/** Submitted overlay path of each normalized edit, aligned with the normalized lists. */
export type EditSources = { readonly [list in ListName]: readonly string[] };

export interface ArchitectureReading {
  /** Absent when no edit remains after normalization. */
  readonly edits?: ArchitectureEdits;
  readonly sources: EditSources;
}

const listNames: readonly ListName[] = ["slots", "bindings", "resources", "subscriptions"];
const entryKeys: Readonly<Record<ListName, readonly string[]>> = {
  slots: ["component", "model", "version", "options"],
  bindings: ["component", "peer", "target"],
  resources: ["owner", "resource", "change"],
  subscriptions: ["consumer", "destination", "change"],
};

/** A lesson without an allowance accepts no architecture edits. */
const closedAllowance: LessonArchitectureAllowance = {
  slots: [], bindings: [], resources: [], subscriptions: [],
  linkPolicy: { requestLatency: 0, responseLatency: 0, jitter: 0, timeout: 1000, failureRate: 0 } as LessonArchitectureAllowance["linkPolicy"],
  maxEdits: 0,
};

export function valueInDomain(value: CanonicalValue, domain: LessonParameterDomain): boolean {
  if (domain.type === "boolean") return typeof value === "boolean";
  if (domain.type === "integer") return typeof value === "number" && Number.isSafeInteger(value) && value >= domain.minimum && value <= domain.maximum;
  return typeof value === "string" && domain.choices.includes(value);
}

/** One submitted entry while stage 3 reads it. `edit` is set only for a well-formed, allowed entry. */
interface Entry<T> {
  readonly path: string;
  readonly key?: string;
  edit?: T;
  noop?: boolean;
}

/**
 * Stage 3 for `overlay.architecture`: schema, the allowance, option domains,
 * conflicting edits, and the edit limit; then normalization. Returns undefined
 * when a diagnostic was pushed.
 */
export function readArchitectureEdits(
  value: CanonicalValue | undefined,
  allowance: LessonArchitectureAllowance | undefined,
  context: OverlayContext | undefined,
  push: Push,
): ArchitectureReading | undefined {
  const empty: ArchitectureReading = { sources: { slots: [], bindings: [], resources: [], subscriptions: [] } };
  if (value === undefined) return empty;
  let failed = false;
  const report: Push = (path, code) => { failed = true; push(path, code); };
  if (value === null || typeof value !== "object" || Array.isArray(value)) { report("/architecture", DiagnosticCodes.TYPE); return undefined; }
  const root = value as Doc;
  for (const key of Object.keys(root)) if (!(listNames as readonly string[]).includes(key)) report(`/architecture/${escape(key)}`, DiagnosticCodes.UNSUPPORTED);
  const lists = {} as Record<ListName, Doc[]>;
  for (const name of listNames) {
    const items = root[name];
    if (items === undefined) { lists[name] = []; continue; }
    if (!Array.isArray(items)) { report(`/architecture/${name}`, DiagnosticCodes.TYPE); lists[name] = []; continue; }
    lists[name] = items.map((item, index) => {
      const path = `/architecture/${name}/${index}`;
      if (item === null || typeof item !== "object" || Array.isArray(item)) { report(path, DiagnosticCodes.TYPE); return undefined; }
      for (const key of Object.keys(item)) if (!entryKeys[name].includes(key)) report(`${path}/${escape(key)}`, DiagnosticCodes.UNSUPPORTED);
      return item as Doc;
    }) as Doc[];
  }
  const total = listNames.reduce((sum, name) => sum + lists[name].length, 0);
  if (total === 0) return failed ? undefined : empty;
  const allowed = allowance ?? closedAllowance;
  if (allowance && !context) throw new TypeError("Architecture edits need the packaged document and the catalog descriptors.");
  const design = context ? packagedDesign(context.packaged) : undefined;
  const catalog = context?.catalog;

  const slots = lists.slots.map((item, index) => readSlot(item, `/architecture/slots/${index}`, allowed, design, catalog, report));
  // A binding is checked against the model its component has after the slot edits.
  const slotModels = new Map(slots.flatMap(entry => entry.edit && !entry.noop ? [[entry.edit.component, entry.edit] as const] : []));
  const bindings = lists.bindings.map((item, index) => readBinding(item, `/architecture/bindings/${index}`, allowed, design, slotModels, catalog, report));
  const resources = lists.resources.map((item, index) => readResource(item, `/architecture/resources/${index}`, allowed, design, report));
  const subscriptions = lists.subscriptions.map((item, index) => readSubscription(item, `/architecture/subscriptions/${index}`, allowed, design, report));

  // Two entries for the same element are rejected, not merged.
  for (const entries of [slots, bindings, resources, subscriptions] as readonly Entry<unknown>[][]) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.key === undefined) continue;
      if (seen.has(entry.key)) report(entry.path, DiagnosticCodes.DUPLICATE);
      seen.add(entry.key);
    }
  }
  // The limit counts edits that change the document; a no-op entry is not an edit.
  let counted = 0;
  for (const entry of [...slots, ...bindings, ...resources, ...subscriptions] as Entry<unknown>[]) {
    if (entry.noop) continue;
    counted += 1;
    if (counted > allowed.maxEdits) report(entry.path, OverlayDiagnosticCodes.OVERLAY_LIMIT);
  }
  if (failed) return undefined;

  const keep = <T>(entries: readonly Entry<T>[], compare: (left: T, right: T) => number) => entries
    .filter(entry => !entry.noop)
    .sort((left, right) => compare(left.edit!, right.edit!));
  const normalized = {
    slots: keep(slots, (left, right) => order(left.component, right.component)),
    bindings: keep(bindings, (left, right) => order(left.component, right.component) || order(left.peer, right.peer)),
    resources: keep(resources, (left, right) => order(left.owner, right.owner) || order(left.resource, right.resource)),
    subscriptions: keep(subscriptions, (left, right) => order(left.consumer, right.consumer) || order(left.destination, right.destination)),
  };
  const sources: EditSources = {
    slots: normalized.slots.map(entry => entry.path),
    bindings: normalized.bindings.map(entry => entry.path),
    resources: normalized.resources.map(entry => entry.path),
    subscriptions: normalized.subscriptions.map(entry => entry.path),
  };
  if (listNames.every(name => normalized[name].length === 0)) return { sources };
  const edits: ArchitectureEdits = Object.freeze({
    slots: Object.freeze(normalized.slots.map(entry => entry.edit!)),
    bindings: Object.freeze(normalized.bindings.map(entry => entry.edit!)),
    resources: Object.freeze(normalized.resources.map(entry => entry.edit!)),
    subscriptions: Object.freeze(normalized.subscriptions.map(entry => entry.edit!)),
  });
  return { edits, sources };
}

function readSlot(item: Doc | undefined, path: string, allowance: LessonArchitectureAllowance, design: PackagedDesign | undefined,
  catalog: DescriptorSource | undefined, push: Push): Entry<SlotEdit> {
  if (!item) return { path };
  const component = text(item.component, `${path}/component`, push);
  const model = text(item.model, `${path}/model`, push);
  const version = text(item.version, `${path}/version`, push);
  let options: readonly CanonicalValue[] | undefined = [];
  if (Array.isArray(item.options)) options = item.options;
  else if (item.options !== undefined) { push(`${path}/options`, DiagnosticCodes.TYPE); options = undefined; }
  if (component === undefined) return { path };
  const entry: Entry<SlotEdit> = { path, key: component };
  const slot = allowance.slots.find(candidate => candidate.component === component);
  if (!slot) { push(`${path}/component`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  if (model === undefined || version === undefined || options === undefined) return entry;
  if (!slot.models.some(candidate => candidate.model === model)) { push(`${path}/model`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  if (!slot.models.some(candidate => candidate.model === model && candidate.version === version)) { push(`${path}/version`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  const descriptor = catalog?.find(model, version);
  const seen = new Set<string>();
  const kept: ParameterOverride[] = [];
  let valid = true;
  options.forEach((option, index) => {
    const optionPath = `${path}/options/${index}`;
    if (option === null || typeof option !== "object" || Array.isArray(option)) { push(optionPath, DiagnosticCodes.TYPE); valid = false; return; }
    for (const key of Object.keys(option)) if (key !== "key" && key !== "value") { push(`${optionPath}/${escape(key)}`, DiagnosticCodes.UNSUPPORTED); valid = false; }
    const { key, value } = option as Doc;
    if (typeof key !== "string" || key.length === 0) { push(`${optionPath}/key`, key === undefined ? DiagnosticCodes.REQUIRED : DiagnosticCodes.TYPE); valid = false; return; }
    if (seen.has(key)) { push(`${optionPath}/key`, DiagnosticCodes.DUPLICATE); valid = false; return; }
    seen.add(key);
    // An option the chosen model does not declare is not an allowed edit.
    const declared = descriptor?.options.find(candidate => candidate.key === key);
    if (!declared) { push(`${optionPath}/key`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); valid = false; return; }
    if (value === undefined) { push(`${optionPath}/value`, DiagnosticCodes.REQUIRED); valid = false; return; }
    if (!valueInDomain(value, declared.domain)) { push(`${optionPath}/value`, OverlayDiagnosticCodes.PARAMETER_VALUE); valid = false; return; }
    // A value equal to the model default is removed.
    if (value !== declared.domain.default) kept.push(Object.freeze({ key, value }));
  });
  if (!valid) return entry;
  kept.sort((left, right) => order(left.key, right.key));
  entry.edit = Object.freeze({ component, model, version, options: Object.freeze(kept) });
  // A slot entry that gives the packaged model and the packaged configuration leaves the document unchanged.
  const packaged = design?.components.get(component);
  entry.noop = packaged !== undefined && packaged.model === model && packaged.version === version
    && canonicalEncode(packaged.configuration) === canonicalEncode(optionConfiguration(kept));
  return entry;
}

function readBinding(item: Doc | undefined, path: string, allowance: LessonArchitectureAllowance, design: PackagedDesign | undefined,
  slots: ReadonlyMap<string, SlotEdit>, catalog: DescriptorSource | undefined, push: Push): Entry<BindingEdit> {
  if (!item) return { path };
  const component = text(item.component, `${path}/component`, push);
  const peer = text(item.peer, `${path}/peer`, push);
  const target = text(item.target, `${path}/target`, push);
  if (component === undefined || peer === undefined) return { path };
  const entry: Entry<BindingEdit> = { path, key: `${component}\u0000${peer}` };
  const binding = allowance.bindings.find(candidate => candidate.component === component && candidate.peer === peer);
  if (!binding) {
    push(allowance.bindings.some(candidate => candidate.component === component) ? `${path}/peer` : `${path}/component`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED);
    return entry;
  }
  if (target === undefined) return entry;
  if (!binding.candidates.includes(target)) { push(`${path}/target`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  // The component's model after the slot edits must declare the peer.
  const packaged = design?.components.get(component);
  const slot = slots.get(component);
  const model = slot ?? packaged;
  const descriptor = model ? catalog?.find(model.model, model.version) : undefined;
  const declared = descriptor?.peers.find(candidate => candidate.name === peer);
  if (!declared) { push(`${path}/peer`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  entry.edit = Object.freeze({ component, peer, target });
  // A binding to the component the peer already resolves to, over an existing link, leaves the document unchanged.
  const configuration = slot ? optionConfiguration(slot.options) : packaged?.configuration;
  const configured = field(configuration, peer);
  const resolved = typeof configured === "string" ? configured : declared.default;
  entry.noop = resolved === target && design !== undefined && design.links.has(`${component}\u0000${target}`);
  return entry;
}

function readResource(item: Doc | undefined, path: string, allowance: LessonArchitectureAllowance, design: PackagedDesign | undefined, push: Push): Entry<ResourceEdit> {
  if (!item) return { path };
  const owner = text(item.owner, `${path}/owner`, push);
  const resource = choice(item.resource, `${path}/resource`, ["database", "store"], push) as ResourceEdit["resource"] | undefined;
  const change = choice(item.change, `${path}/change`, ["attach", "detach"], push) as ResourceEdit["change"] | undefined;
  if (owner === undefined || resource === undefined) return { path };
  const entry: Entry<ResourceEdit> = { path, key: `${owner}\u0000${resource}` };
  if (!allowance.resources.some(candidate => candidate.owner === owner && candidate.resource === resource)) { push(path, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  if (change === undefined) return entry;
  entry.edit = Object.freeze({ owner, resource, change });
  // Detaching a resource the owner does not have leaves the document unchanged.
  const owners = resource === "database" ? design?.databases : design?.stores;
  entry.noop = change === "detach" && owners !== undefined && !owners.has(owner);
  return entry;
}

function readSubscription(item: Doc | undefined, path: string, allowance: LessonArchitectureAllowance, design: PackagedDesign | undefined, push: Push): Entry<SubscriptionEdit> {
  if (!item) return { path };
  const consumer = text(item.consumer, `${path}/consumer`, push);
  const destination = text(item.destination, `${path}/destination`, push);
  const change = choice(item.change, `${path}/change`, ["subscribe", "unsubscribe"], push) as SubscriptionEdit["change"] | undefined;
  if (consumer === undefined || destination === undefined) return { path };
  const entry: Entry<SubscriptionEdit> = { path, key: `${consumer}\u0000${destination}` };
  if (!allowance.subscriptions.some(candidate => candidate.consumer === consumer && candidate.destination === destination)) { push(path, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED); return entry; }
  if (change === undefined) return entry;
  entry.edit = Object.freeze({ consumer, destination, change });
  // Removing a subscription that does not exist leaves the document unchanged.
  entry.noop = change === "unsubscribe" && design !== undefined && !design.subscriptions.has(`${consumer}\u0000${destination}`);
  return entry;
}

/** The configuration a slot edit gives its component: the non-default options. */
function optionConfiguration(options: readonly ParameterOverride[]): CanonicalValue {
  return Object.fromEntries(options.map(option => [option.key, option.value])) as CanonicalValue;
}

interface PackagedDesign {
  readonly components: ReadonlyMap<string, { readonly model: string; readonly version: string; readonly configuration: CanonicalValue }>;
  readonly links: ReadonlySet<string>;
  readonly databases: ReadonlySet<string>;
  readonly stores: ReadonlySet<string>;
  readonly subscriptions: ReadonlySet<string>;
}

function packagedDesign(packaged: CanonicalValue): PackagedDesign {
  const architecture = (((packaged as Doc).architecture ?? {}) as Doc);
  const items = (name: string) => (Array.isArray(architecture[name]) ? architecture[name] as Doc[] : []);
  return {
    components: new Map(items("components").map(item => [item.id as string, {
      model: item.model as string, version: item.version as string, configuration: (item.configuration ?? {}) as CanonicalValue,
    }])),
    links: new Set(items("links").map(item => `${item.source as string}\u0000${item.target as string}`)),
    databases: new Set(items("databases").map(item => item.owner as string)),
    stores: new Set(items("stores").map(item => item.owner as string)),
    subscriptions: new Set(items("subscriptions").map(item => `${item.consumer as string}\u0000${item.destination as string}`)),
  };
}

/** Where an applied entry came from: the packaged index, or the normalized edit that produced it. */
type Origin = { readonly packaged: number } | { readonly edit: EditRef };
interface EditRef { readonly list: ListName; readonly index: number }

/** Provenance of the applied architecture, for stage-4 attribution. */
export interface ArchitectureProvenance {
  readonly links: readonly Origin[];
  readonly databases: readonly Origin[];
  readonly stores: readonly Origin[];
  readonly subscriptions: readonly Origin[];
  /** Component index → the slot edit that replaced its model. */
  readonly slots: ReadonlyMap<number, EditRef>;
  /** `${component index}\0${configuration field}` → the binding that wrote it. */
  readonly fields: ReadonlyMap<string, EditRef>;
}

/**
 * Applies normalized architecture edits to a mutable copy of the packaged
 * document in ADR-005 order: slots, resources, subscriptions, bindings.
 */
export function applyArchitectureEdits(document: Doc, edits: ArchitectureEdits, allowance: LessonArchitectureAllowance | undefined, catalog: DescriptorSource | undefined): ArchitectureProvenance {
  if (!allowance) throw new TypeError("Architecture edits need the lesson's architecture allowance.");
  const architecture = document.architecture as Doc;
  const list = (name: string): Doc[] => {
    if (!Array.isArray(architecture[name])) architecture[name] = [];
    return architecture[name] as unknown as Doc[];
  };
  const components = list("components");
  const indexOf = (id: string) => components.findIndex(component => component.id === id);
  const tracked = (name: string) => ({ items: list(name), origins: list(name).map((_, index): Origin => ({ packaged: index })) });
  const databases = tracked("databases");
  const stores = tracked("stores");
  const subscriptions = tracked("subscriptions");
  const links = tracked("links");
  const slots = new Map<number, EditRef>();
  const fields = new Map<string, EditRef>();

  // 1. Slots: replace the model in place; the configuration becomes the non-default options.
  edits.slots.forEach((slot, index) => {
    const at = indexOf(slot.component);
    if (at < 0) throw new TypeError(`Unknown slot component ${slot.component}`);
    components[at] = { ...components[at]!, model: slot.model, version: slot.version, configuration: optionConfiguration(slot.options) };
    slots.set(at, { list: "slots", index });
  });
  // 2. Resources: remove detached ones in place, then append attached ones in normalized order.
  for (const resource of edits.resources) {
    if (resource.change !== "detach") continue;
    const target = resource.resource === "database" ? databases : stores;
    const at = target.items.findIndex(item => item.owner === resource.owner);
    if (at >= 0) { target.items.splice(at, 1); target.origins.splice(at, 1); }
  }
  edits.resources.forEach((resource, index) => {
    if (resource.change !== "attach") return;
    if (resource.resource === "store") {
      stores.items.push({ owner: resource.owner, initial: [] });
      stores.origins.push({ edit: { list: "resources", index } });
      return;
    }
    // An attached database has the owner's declared tables and no initial rows.
    const owner = components[indexOf(resource.owner)];
    const descriptor = owner ? catalog?.find(owner.model as string, owner.version as string) : undefined;
    const tables = canonicalCopy((descriptor?.storage.database?.tables ?? []) as unknown as CanonicalValue);
    databases.items.push({ owner: resource.owner, tables, initial: {} });
    databases.origins.push({ edit: { list: "resources", index } });
  });
  // 3. Subscriptions: remove in place, then append additions in normalized order.
  for (const subscription of edits.subscriptions) {
    if (subscription.change !== "unsubscribe") continue;
    const at = subscriptions.items.findIndex(item => item.consumer === subscription.consumer && item.destination === subscription.destination);
    if (at >= 0) { subscriptions.items.splice(at, 1); subscriptions.origins.splice(at, 1); }
  }
  edits.subscriptions.forEach((subscription, index) => {
    if (subscription.change !== "subscribe") return;
    subscriptions.items.push({ destination: subscription.destination, consumer: subscription.consumer });
    subscriptions.origins.push({ edit: { list: "subscriptions", index } });
  });
  // 4. Bindings: write the peer field; a link with the allowance's policy follows when none exists. Links are never removed.
  edits.bindings.forEach((binding, index) => {
    const at = indexOf(binding.component);
    if (at < 0) throw new TypeError(`Unknown bound component ${binding.component}`);
    const component = components[at]!;
    const configuration = component.configuration;
    const base = configuration && typeof configuration === "object" && !Array.isArray(configuration) ? configuration as Doc : {};
    components[at] = { ...component, configuration: { ...base, [binding.peer]: binding.target } };
    fields.set(`${at}\u0000${binding.peer}`, { list: "bindings", index });
    if (!links.items.some(link => link.source === binding.component && link.target === binding.target)) {
      links.items.push({ source: binding.component, target: binding.target, policy: canonicalCopy(allowance.linkPolicy as unknown as CanonicalValue) });
      links.origins.push({ edit: { list: "bindings", index } });
    }
  });
  return { links: links.origins, databases: databases.origins, stores: stores.origins, subscriptions: subscriptions.origins, slots, fields };
}

/** Path of an edit inside the submitted overlay, as ADR-005's examples give it. */
function editPath(ref: EditRef, sources: EditSources): string {
  const path = sources[ref.list][ref.index]!;
  return ref.list === "slots" ? `${path}/model` : ref.list === "bindings" ? `${path}/target` : path;
}

/**
 * ADR-005's refined stage-4 rule for a diagnostic that ADR-004 translation did
 * not place. Returns the overlay path, or undefined for a catalog defect (the
 * diagnostic also occurs when the packaged document is validated alone).
 */
export function attributeDiagnostic(
  diagnostic: ScenarioDiagnostic,
  applied: CanonicalValue,
  edits: ArchitectureEdits,
  sources: EditSources,
  provenance: ArchitectureProvenance,
  packagedDiagnostics: () => ReadonlySet<string>,
  catalog: DescriptorSource | undefined,
): string | undefined {
  const match = /^\/architecture\/(components|links|databases|stores|subscriptions)\/(\d+)(\/.*)?$/.exec(diagnostic.path);
  const document = applied as Doc;
  const architecture = (document.architecture ?? {}) as Doc;
  let packagedPath = diagnostic.path;
  let entry: Doc | undefined;
  let peerTarget: string | undefined;
  if (match) {
    const [, list, digits, rest = ""] = match;
    const index = Number(digits);
    entry = (architecture[list!] as Doc[] | undefined)?.[index];
    if (list === "components") {
      // Produced: a field a binding wrote, or a component whose model a slot replaced.
      const field = /^\/configuration\/([^/]+)/.exec(rest)?.[1];
      const bound = field === undefined ? undefined : provenance.fields.get(`${index}\u0000${unescape(field)}`);
      if (bound) return editPath(bound, sources);
      const slot = provenance.slots.get(index);
      if (slot) return editPath(slot, sources);
      if (field !== undefined && entry) peerTarget = resolvedPeer(entry, unescape(field), catalog);
    } else {
      const origin = (provenance[list as "links" | "databases" | "stores" | "subscriptions"])[index];
      if (origin && "edit" in origin) return editPath(origin.edit, sources);
      if (origin) packagedPath = `/architecture/${list}/${origin.packaged}${rest}`;
    }
  } else {
    const top = /^\/(actions|faults|external|assertions)\/(\d+)/.exec(diagnostic.path);
    if (top) entry = (document[top[1]!] as Doc[] | undefined)?.[Number(top[2])];
    // A workload-addressed call (#121) names its target in a data field, as a peer location names its bound component.
    const data = /^\/actions\/\d+\/data\/([^/]+)$/.exec(diagnostic.path)?.[1];
    if (data !== undefined && entry) peerTarget = workloadTarget(entry, architecture, unescape(data), catalog);
  }
  if (packagedDiagnostics().has(`${packagedPath}\u0000${diagnostic.code}`)) return undefined;
  // Otherwise the first edit, in normalized order, that changed a component the location names.
  const known = new Set(((architecture.components ?? []) as Doc[]).map(component => component.id as string));
  const named = new Set<string>();
  if (entry) for (const value of Object.values(entry)) if (typeof value === "string" && known.has(value)) named.add(value);
  if (peerTarget && known.has(peerTarget)) named.add(peerTarget);
  const changed: readonly [ListName, number][] = [
    ["slots", edits.slots.findIndex(edit => named.has(edit.component))],
    ["bindings", edits.bindings.findIndex(edit => named.has(edit.component) || named.has(edit.target))],
    ["resources", edits.resources.findIndex(edit => named.has(edit.owner))],
    ["subscriptions", edits.subscriptions.findIndex(edit => named.has(edit.consumer))],
  ];
  const first = changed.find(([, index]) => index >= 0);
  return first ? editPath({ list: first[0], index: first[1] }, sources) : "/architecture";
}

/** The component a peer field resolves to: the configured ID, else the descriptor default. */
function resolvedPeer(component: Doc, name: string, catalog: DescriptorSource | undefined): string | undefined {
  const configured = field(component.configuration, name);
  if (typeof configured === "string") return configured;
  return catalog?.find(component.model as string, component.version as string)?.peers.find(peer => peer.name === name)?.default;
}

/**
 * The component a workload-addressed call names: for a client action whose model
 * declares a `workloadCalls` entry for that action with `name` as its target or
 * endpoint field, the action data's target field, when it is a string.
 */
function workloadTarget(action: Doc, architecture: Doc, name: string, catalog: DescriptorSource | undefined): string | undefined {
  if (action.kind !== "client") return undefined;
  const client = ((architecture.components ?? []) as Doc[]).find(component => component.id === action.target);
  if (!client) return undefined;
  const call = catalog?.find(client.model as string, client.version as string)?.workloadCalls
    ?.find(item => item.action === action.action && (item.target === name || item.endpoint === name));
  const target = call === undefined ? undefined : field(action.data, call.target);
  return typeof target === "string" ? target : undefined;
}

function field(configuration: CanonicalValue | undefined, name: string): CanonicalValue | undefined {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return undefined;
  return (configuration as Doc)[name];
}

function text(value: CanonicalValue | undefined, path: string, push: Push): string | undefined {
  if (value === undefined) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  if (typeof value !== "string" || value.length === 0) { push(path, DiagnosticCodes.TYPE); return undefined; }
  return value;
}

function choice(value: CanonicalValue | undefined, path: string, choices: readonly string[], push: Push): string | undefined {
  const read = text(value, path, push);
  if (read !== undefined && !choices.includes(read)) { push(path, DiagnosticCodes.TYPE); return undefined; }
  return read;
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescape(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
