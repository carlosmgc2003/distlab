import type {
  ArchitectureDefinition,
  ArchitectureEdits,
  CanonicalValue,
  ComponentId,
  DatabaseDefinition,
  ModelDescriptor,
  ParameterOverride,
  ScenarioDiagnostic,
} from "@distlab/contracts";
import { designDiagnosticText } from "./design-edits.ts";
import type { DesignControl } from "./design-edits.ts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * What a design looks like on the architecture graph (ADR-005 "Draft, preview, and layout", #203).
 * Pure and data-only: it reads the packaged `ArchitectureDefinition`, the catalog's data-only model
 * descriptors, and `ArchitectureEdits` (the applied edits the worker published in
 * `session.overlay.architecture`, or the drawer's draft), and returns presentation marks. The marks
 * are never an `ArchitectureDefinition`, never sent to the worker, and never validated: the
 * worker's load is the only validator, and a mark only says what an edit asks for.
 */

export type ResourceChoice = "database" | "store";

/** A slot and the model that fills it under some edits, with every declared option at its value. */
export interface SlotMark {
  readonly component: ComponentId;
  readonly model: string;
  readonly version: string;
  /** The model is a placeholder: the slot is empty under these edits. */
  readonly placeholder: boolean;
  /** Every option the model declares, at the edit's value or the model default, sorted by key. */
  readonly options: readonly ParameterOverride[];
}

/** A resource an edit attaches or detaches. A database lists the tables it holds. */
export interface ResourceMark {
  readonly owner: ComponentId;
  readonly resource: ResourceChoice;
  readonly change: "attach" | "detach";
  /** An attached database: the tables the owner's model declares. A detached one: the tables it had. A store: none. */
  readonly tables: DatabaseDefinition["tables"];
}

/** A peer bound to a component: the connection from the component to its target. */
export interface ConnectionMark {
  readonly component: ComponentId;
  readonly peer: string;
  readonly target: ComponentId;
}

export interface SubscriptionMark {
  readonly consumer: ComponentId;
  readonly destination: string;
  readonly change: "subscribe" | "unsubscribe";
}

/** Presentation marks for one set of edits, or for the difference between two. */
export interface DesignMarks {
  readonly slots: readonly SlotMark[];
  readonly resources: readonly ResourceMark[];
  readonly connections: readonly ConnectionMark[];
  readonly subscriptions: readonly SubscriptionMark[];
}

export const noDesignMarks: DesignMarks = Object.freeze({ slots: [], resources: [], connections: [], subscriptions: [] });

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: CanonicalValue | undefined): Readonly<Record<string, CanonicalValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, CanonicalValue>> : {};
}

function stable(value: CanonicalValue | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

function descriptorOf(descriptors: readonly ModelDescriptor[], model: string, version: string): ModelDescriptor | undefined {
  return descriptors.find(item => item.model === model && item.version === version);
}

/** The model of a component under some edits: its slot edit, or the packaged model and configuration. */
function slotState(architecture: ArchitectureDefinition, descriptors: readonly ModelDescriptor[], edits: ArchitectureEdits | undefined, component: ComponentId): SlotMark | undefined {
  const edit = edits?.slots.find(item => item.component === component);
  const packaged = architecture.components.find(item => item.id === component);
  const model = edit?.model ?? packaged?.model;
  const version = edit?.version ?? packaged?.version;
  if (model === undefined || version === undefined) return undefined;
  const descriptor = descriptorOf(descriptors, model, version);
  const configured = edit ? Object.fromEntries(edit.options.map(option => [option.key, option.value])) : record(packaged?.configuration);
  const options = (descriptor?.options ?? [])
    .map(option => ({ key: option.key, value: configured[option.key] ?? option.domain.default }))
    .sort((left, right) => order(left.key, right.key));
  return { component, model, version, placeholder: descriptor?.placeholder === true, options };
}

/** The tables a database of this owner holds under some edits: its model's declared tables, else the packaged ones. */
function tablesOf(architecture: ArchitectureDefinition, descriptors: readonly ModelDescriptor[], edits: ArchitectureEdits | undefined, owner: ComponentId): DatabaseDefinition["tables"] {
  const state = slotState(architecture, descriptors, edits, owner);
  const declared = state ? descriptorOf(descriptors, state.model, state.version)?.storage.database?.tables : undefined;
  return declared ?? architecture.databases.find(database => database.owner === owner)?.tables ?? [];
}

function packagedResource(architecture: ArchitectureDefinition, owner: ComponentId, resource: ResourceChoice): boolean {
  return (resource === "database" ? architecture.databases : architecture.stores).some(item => item.owner === owner);
}

function packagedSubscription(architecture: ArchitectureDefinition, consumer: ComponentId, destination: string): boolean {
  return architecture.subscriptions.some(item => item.consumer === consumer && item.destination === destination);
}

/** The component a peer resolves to under some edits: a binding edit, the configured field, or the model's default. */
function peerTarget(architecture: ArchitectureDefinition, descriptors: readonly ModelDescriptor[], edits: ArchitectureEdits | undefined, component: ComponentId, peer: string): ComponentId | undefined {
  const bound = edits?.bindings.find(item => item.component === component && item.peer === peer);
  if (bound) return bound.target;
  const edit = edits?.slots.find(item => item.component === component);
  const packaged = architecture.components.find(item => item.id === component);
  const configured = edit ? undefined : record(packaged?.configuration)[peer];
  if (typeof configured === "string") return configured;
  const state = slotState(architecture, descriptors, edits, component);
  return state ? descriptorOf(descriptors, state.model, state.version)?.peers.find(item => item.name === peer)?.default : undefined;
}

function sorted(marks: { slots: SlotMark[]; resources: ResourceMark[]; connections: ConnectionMark[]; subscriptions: SubscriptionMark[] }): DesignMarks {
  return {
    slots: marks.slots.sort((left, right) => order(left.component, right.component)),
    resources: marks.resources.sort((left, right) => order(left.owner, right.owner) || order(left.resource, right.resource)),
    connections: marks.connections.sort((left, right) => order(left.component, right.component) || order(left.peer, right.peer)),
    subscriptions: marks.subscriptions.sort((left, right) => order(left.consumer, right.consumer) || order(left.destination, right.destination)),
  };
}

/**
 * The marks of one set of edits against the packaged architecture: each edited slot with its model,
 * version, and option values; each attached or detached resource with its owner, kind, and, for a
 * database, its tables; each bound peer as a connection; each added or removed subscription.
 * Absent or empty edits give no mark. The order of the edits does not matter.
 */
export function designMarks(architecture: ArchitectureDefinition, descriptors: readonly ModelDescriptor[], edits: ArchitectureEdits | undefined): DesignMarks {
  if (!edits) return noDesignMarks;
  return sorted({
    slots: edits.slots.flatMap(slot => { const state = slotState(architecture, descriptors, edits, slot.component); return state ? [state] : []; }),
    resources: edits.resources.map(item => ({
      owner: item.owner, resource: item.resource, change: item.change,
      tables: item.resource === "database"
        ? item.change === "attach" ? tablesOf(architecture, descriptors, edits, item.owner) : architecture.databases.find(database => database.owner === item.owner)?.tables ?? []
        : [],
    })),
    connections: edits.bindings.map(binding => ({ component: binding.component, peer: binding.peer, target: binding.target })),
    subscriptions: edits.subscriptions.map(item => ({ consumer: item.consumer, destination: item.destination, change: item.change })),
  });
}

/**
 * The draft preview: only where the draft differs from the applied design. A slot whose drafted
 * model or options differ is relabeled; a drafted attach or subscribe is a new element, and a
 * drafted detach or unsubscribe marks an element of the applied design as removed; a peer bound
 * to another target is a drafted connection. Equal edits give no mark.
 */
export function designPreview(architecture: ArchitectureDefinition, descriptors: readonly ModelDescriptor[], applied: ArchitectureEdits | undefined, draft: ArchitectureEdits | undefined): DesignMarks {
  if (!applied && !draft) return noDesignMarks;
  const slots: SlotMark[] = [];
  for (const component of new Set([...(applied?.slots ?? []), ...(draft?.slots ?? [])].map(slot => slot.component))) {
    const before = slotState(architecture, descriptors, applied, component);
    const after = slotState(architecture, descriptors, draft, component);
    if (after && stable(before as unknown as CanonicalValue) !== stable(after as unknown as CanonicalValue)) slots.push(after);
  }
  const resources: ResourceMark[] = [];
  const owned = (edits: ArchitectureEdits | undefined, owner: ComponentId, resource: ResourceChoice) => {
    const edit = edits?.resources.find(item => item.owner === owner && item.resource === resource);
    return edit ? edit.change === "attach" : packagedResource(architecture, owner, resource);
  };
  const resourceKeys = new Map([...(applied?.resources ?? []), ...(draft?.resources ?? [])].map(item => [`${item.owner}\u0000${item.resource}`, item]));
  for (const { owner, resource } of resourceKeys.values()) {
    const before = owned(applied, owner, resource);
    const after = owned(draft, owner, resource);
    if (before === after) continue;
    const tables = resource !== "database" ? [] : tablesOf(architecture, descriptors, after ? draft : applied, owner);
    resources.push({ owner, resource, change: after ? "attach" : "detach", tables });
  }
  const connections: ConnectionMark[] = [];
  const bindingKeys = new Map([...(applied?.bindings ?? []), ...(draft?.bindings ?? [])].map(item => [`${item.component}\u0000${item.peer}`, item]));
  for (const { component, peer } of bindingKeys.values()) {
    const before = peerTarget(architecture, descriptors, applied, component, peer);
    const after = peerTarget(architecture, descriptors, draft, component, peer);
    if (after !== undefined && after !== before) connections.push({ component, peer, target: after });
  }
  const subscriptions: SubscriptionMark[] = [];
  const subscribed = (edits: ArchitectureEdits | undefined, consumer: ComponentId, destination: string) => {
    const edit = edits?.subscriptions.find(item => item.consumer === consumer && item.destination === destination);
    return edit ? edit.change === "subscribe" : packagedSubscription(architecture, consumer, destination);
  };
  const subscriptionKeys = new Map([...(applied?.subscriptions ?? []), ...(draft?.subscriptions ?? [])].map(item => [`${item.consumer}\u0000${item.destination}`, item]));
  for (const { consumer, destination } of subscriptionKeys.values()) {
    const before = subscribed(applied, consumer, destination);
    const after = subscribed(draft, consumer, destination);
    if (before !== after) subscriptions.push({ consumer, destination, change: after ? "subscribe" : "unsubscribe" });
  }
  return sorted({ slots, resources, connections, subscriptions });
}

/** True when the marks hold nothing to draw. */
export function isEmptyDesign(marks: DesignMarks): boolean {
  return !marks.slots.length && !marks.resources.length && !marks.connections.length && !marks.subscriptions.length;
}

/** A graph element a design diagnostic concerns (ADR-005 "Error presentation"). */
export type DesignElement =
  | { readonly kind: "component"; readonly component: ComponentId }
  | { readonly kind: "resource"; readonly owner: ComponentId; readonly resource: ResourceChoice }
  | { readonly kind: "connection"; readonly component: ComponentId; readonly peer: string; readonly target: ComponentId }
  | { readonly kind: "subscription"; readonly consumer: ComponentId; readonly destination: string };

/** A stable key for an element, independent of the graph's node and edge ids. */
export function elementKey(element: DesignElement): string {
  switch (element.kind) {
    case "component": return `component:${element.component}`;
    case "resource": return `resource:${element.owner}:${element.resource}`;
    case "connection": return `connection:${element.component}:${element.peer}`;
    case "subscription": return `subscription:${element.consumer}:${element.destination}`;
  }
}

/** The graph element a control of the Architecture section edits: an option belongs to its slot's node. */
export function controlElement(control: DesignControl): DesignElement {
  switch (control.kind) {
    case "slot": case "option": return { kind: "component", component: control.component };
    case "binding": return { kind: "connection", component: control.component, peer: control.peer, target: control.value };
    case "resource": return { kind: "resource", owner: control.owner, resource: control.resource };
    case "subscription": return { kind: "subscription", consumer: control.consumer, destination: control.destination };
  }
}

/**
 * The graph element one diagnostic path points to, in the edits that were submitted, or undefined
 * when it points to none and is shown in the Architecture section only:
 *
 * | Path | Element |
 * | --- | --- |
 * | `/architecture/slots/i…` | the slot's component node |
 * | `/architecture/bindings/i…` | the drafted connection |
 * | `/architecture/resources/i` | the resource satellite |
 * | `/architecture/subscriptions/i` | the subscription edge |
 * | anything else | the section only |
 */
export function diagnosticElement(path: string, edits: ArchitectureEdits | undefined): DesignElement | undefined {
  const match = /^\/architecture\/(slots|bindings|resources|subscriptions)\/(\d+)(\/.*)?$/.exec(path);
  if (!match) return undefined;
  const index = Number(match[2]);
  const rest = match[3];
  switch (match[1]) {
    case "slots": {
      const slot = edits?.slots[index];
      return slot ? { kind: "component", component: slot.component } : undefined;
    }
    case "bindings": {
      const binding = edits?.bindings[index];
      return binding ? { kind: "connection", component: binding.component, peer: binding.peer, target: binding.target } : undefined;
    }
    case "resources": {
      const resource = rest === undefined ? edits?.resources[index] : undefined;
      return resource ? { kind: "resource", owner: resource.owner, resource: resource.resource } : undefined;
    }
    default: {
      const subscription = rest === undefined ? edits?.subscriptions[index] : undefined;
      return subscription ? { kind: "subscription", consumer: subscription.consumer, destination: subscription.destination } : undefined;
    }
  }
}

export interface DesignProblem {
  readonly key: string;
  readonly element: DesignElement;
  /** The messages the Architecture section shows for these diagnostics, in diagnostic order. */
  readonly messages: readonly string[];
}

/**
 * Groups a rejected load's `/architecture` diagnostics by the graph element each concerns. Each
 * message is the text the Architecture section shows for that diagnostic. A diagnostic that points
 * to no element goes to `section` only.
 */
export function designProblems(diagnostics: readonly ScenarioDiagnostic[], edits: ArchitectureEdits | undefined, maxEdits: number, m: Messages): {
  readonly elements: readonly DesignProblem[];
  readonly section: readonly string[];
} {
  const elements = new Map<string, { element: DesignElement; messages: string[] }>();
  const section: string[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.path !== "/architecture" && !diagnostic.path.startsWith("/architecture/")) continue;
    const message = designDiagnosticText(diagnostic.code, maxEdits, m);
    const element = diagnosticElement(diagnostic.path, edits);
    if (!element) { section.push(message); continue; }
    const key = elementKey(element);
    const entry = elements.get(key) ?? { element, messages: [] };
    entry.messages.push(message);
    elements.set(key, entry);
  }
  return { elements: [...elements.entries()].map(([key, entry]) => ({ key, element: entry.element, messages: entry.messages })), section };
}
