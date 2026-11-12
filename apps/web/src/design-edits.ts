import type {
  ArchitectureDefinition,
  ArchitectureEdits,
  BindingEdit,
  CanonicalValue,
  LessonArchitectureAllowance,
  ModelDescriptor,
  ModelOption,
  ParameterOverride,
  ResourceEdit,
  ScenarioDiagnostic,
  SlotEdit,
  SubscriptionEdit,
} from "@distlab/contracts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * The Design editor's draft (ADR-005, #112). Pure and data-only: it reads a lesson's architecture
 * allowance, the packaged `ArchitectureDefinition`, and the catalog's data-only model descriptors,
 * lists the controls to offer, and turns control values into `ArchitectureEdits` in the worker's
 * normalized form (the scenario package's stage-3 reading of an overlay, which the main thread
 * never imports). Offering choices from data is affordance, not validation: the worker's load
 * decides whether a design is valid. Labels are rendered from codes and ids with `m: Messages` (ADR-007);
 * the draft itself holds no text.
 */

/** What the draft functions read. Every field is data. */
export interface DesignContext {
  readonly allowance: LessonArchitectureAllowance;
  readonly architecture: ArchitectureDefinition;
  readonly descriptors: readonly ModelDescriptor[];
}

/** The draft: normalized edits, or undefined when no edit remains. */
export type DesignDraft = ArchitectureEdits | undefined;

export interface ModelChoice {
  /** `‹model›@‹version›`, the select's option value. */
  readonly value: string;
  readonly model: string;
  readonly version: string;
  readonly label: string;
}

export interface SlotControl {
  readonly kind: "slot";
  readonly id: string;
  readonly component: string;
  readonly label: string;
  /** The first choice is the packaged model; the rest are the allowed models. */
  readonly choices: readonly ModelChoice[];
  readonly value: string;
  readonly packaged: boolean;
}

export interface OptionControl {
  readonly kind: "option";
  readonly id: string;
  readonly component: string;
  readonly key: string;
  readonly label: string;
  readonly domain: ModelOption["domain"];
  readonly value: CanonicalValue;
}

export interface BindingControl {
  readonly kind: "binding";
  readonly id: string;
  readonly component: string;
  readonly peer: string;
  readonly label: string;
  readonly candidates: readonly string[];
  readonly value: string;
  readonly packaged: boolean;
}

export interface ResourceControl {
  readonly kind: "resource";
  readonly id: string;
  readonly owner: string;
  readonly resource: "database" | "store";
  readonly label: string;
  readonly value: boolean;
  readonly packaged: boolean;
}

export interface SubscriptionControl {
  readonly kind: "subscription";
  readonly id: string;
  readonly consumer: string;
  readonly destination: string;
  readonly label: string;
  readonly value: boolean;
  readonly packaged: boolean;
}

export type DesignControl = SlotControl | OptionControl | BindingControl | ResourceControl | SubscriptionControl;

export const slotControlId = (component: string) => `slot:${component}`;
export const optionControlId = (component: string, key: string) => `option:${component}:${key}`;
export const bindingControlId = (component: string, peer: string) => `binding:${component}:${peer}`;
export const resourceControlId = (owner: string, resource: string) => `resource:${owner}:${resource}`;
export const subscriptionControlId = (consumer: string, destination: string) => `subscription:${consumer}:${destination}`;

const PACKAGED_CHOICE = "packaged";

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descriptor(context: DesignContext, model: string, version: string): ModelDescriptor | undefined {
  return context.descriptors.find(item => item.model === model && item.version === version);
}

function packagedComponent(context: DesignContext, id: string) {
  return context.architecture.components.find(component => component.id === id);
}

function record(value: CanonicalValue | undefined): Readonly<Record<string, CanonicalValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, CanonicalValue>> : {};
}

function stable(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key]!)}`).join(",")}}`;
}

function hasResource(context: DesignContext, owner: string, resource: "database" | "store"): boolean {
  return (resource === "database" ? context.architecture.databases : context.architecture.stores).some(item => item.owner === owner);
}

function hasSubscription(context: DesignContext, consumer: string, destination: string): boolean {
  return context.architecture.subscriptions.some(item => item.consumer === consumer && item.destination === destination);
}

function hasLink(context: DesignContext, source: string, target: string): boolean {
  return context.architecture.links.some(link => link.source === source && link.target === target);
}

/** The model a component has under the draft: its slot edit, or the packaged model. */
function currentModel(context: DesignContext, draft: DesignDraft, component: string): { readonly model: string; readonly version: string; readonly configuration: CanonicalValue } | undefined {
  const slot = draft?.slots.find(item => item.component === component);
  if (slot) return { model: slot.model, version: slot.version, configuration: Object.fromEntries(slot.options.map(option => [option.key, option.value])) as CanonicalValue };
  const packaged = packagedComponent(context, component);
  return packaged?.model !== undefined && packaged.version !== undefined
    ? { model: packaged.model, version: packaged.version, configuration: packaged.configuration ?? {} } : undefined;
}

/** The component a peer resolves to without a binding edit: the configured field, else the model's default. */
function resolvedPeer(context: DesignContext, draft: DesignDraft, component: string, peer: string): string | undefined {
  const model = currentModel(context, draft, component);
  if (!model) return undefined;
  const configured = record(model.configuration)[peer];
  if (typeof configured === "string") return configured;
  return descriptor(context, model.model, model.version)?.peers.find(item => item.name === peer)?.default;
}

/** The controls to offer, in the allowance's order: each slot followed by its model's options, then bindings, resources, subscriptions. */
export function designControls(context: DesignContext, draft: DesignDraft, m: Messages): readonly DesignControl[] {
  const controls: DesignControl[] = [];
  for (const slot of context.allowance.slots) {
    const packaged = packagedComponent(context, slot.component);
    const packagedDescriptor = packaged?.model !== undefined && packaged.version !== undefined ? descriptor(context, packaged.model, packaged.version) : undefined;
    const packagedLabel = packagedDescriptor?.placeholder ? m.designEditor.controls.packagedEmpty : m.designEditor.controls.packagedModel({ model: packaged?.model ?? "?", version: packaged?.version ?? "?" });
    const edit = draft?.slots.find(item => item.component === slot.component);
    controls.push({
      kind: "slot", id: slotControlId(slot.component), component: slot.component, label: m.designEditor.controls.slot({ component: slot.component }),
      choices: [
        { value: PACKAGED_CHOICE, model: packaged?.model ?? "", version: packaged?.version ?? "", label: packagedLabel },
        ...slot.models.map(model => ({ value: `${model.model}@${model.version}`, model: model.model, version: model.version, label: `${model.model} ${model.version}` })),
      ],
      value: edit ? `${edit.model}@${edit.version}` : PACKAGED_CHOICE,
      packaged: edit === undefined,
    });
    // Options belong to the chosen model, so they are offered only while a non-packaged model is chosen.
    if (!edit) continue;
    for (const option of descriptor(context, edit.model, edit.version)?.options ?? []) {
      controls.push({
        kind: "option", id: optionControlId(slot.component, option.key), component: slot.component, key: option.key,
        label: m.designEditor.controls.option({ component: slot.component, key: option.key }), domain: option.domain,
        value: edit.options.find(item => item.key === option.key)?.value ?? option.domain.default,
      });
    }
  }
  for (const binding of context.allowance.bindings) {
    const edit = draft?.bindings.find(item => item.component === binding.component && item.peer === binding.peer);
    const resolved = resolvedPeer(context, draft, binding.component, binding.peer);
    controls.push({
      kind: "binding", id: bindingControlId(binding.component, binding.peer), component: binding.component, peer: binding.peer,
      label: m.designEditor.controls.binding({ component: binding.component, peer: binding.peer }),
      // The resolved peer leads the list when it is not a candidate, so the select can show it.
      candidates: resolved !== undefined && !binding.candidates.includes(resolved) ? [resolved, ...binding.candidates] : binding.candidates,
      value: edit?.target ?? resolved ?? binding.candidates[0] ?? "",
      packaged: edit === undefined,
    });
  }
  for (const resource of context.allowance.resources) {
    const owned = hasResource(context, resource.owner, resource.resource);
    const edit = draft?.resources.find(item => item.owner === resource.owner && item.resource === resource.resource);
    controls.push({
      kind: "resource", id: resourceControlId(resource.owner, resource.resource), owner: resource.owner, resource: resource.resource,
      label: (resource.resource === "database" ? m.designEditor.controls.ownsDatabase : m.designEditor.controls.ownsStore)({ owner: resource.owner }),
      value: edit ? edit.change === "attach" : owned,
      packaged: edit === undefined,
    });
  }
  for (const subscription of context.allowance.subscriptions) {
    const exists = hasSubscription(context, subscription.consumer, subscription.destination);
    const edit = draft?.subscriptions.find(item => item.consumer === subscription.consumer && item.destination === subscription.destination);
    controls.push({
      kind: "subscription", id: subscriptionControlId(subscription.consumer, subscription.destination),
      consumer: subscription.consumer, destination: subscription.destination,
      label: m.designEditor.controls.subscription({ consumer: subscription.consumer, destination: subscription.destination }),
      value: edit ? edit.change === "subscribe" : exists,
      packaged: edit === undefined,
    });
  }
  return controls;
}

/** The number of design edits in a draft. */
export function editCount(draft: DesignDraft): number {
  return draft ? draft.slots.length + draft.bindings.length + draft.resources.length + draft.subscriptions.length : 0;
}

/**
 * Whether a control can change: false when the draft is at the allowance's limit and changing this
 * control would add an edit (a control still at its packaged value). An option changes its slot's
 * edit and never adds one.
 */
export function controlAvailable(context: DesignContext, draft: DesignDraft, control: DesignControl): boolean {
  if (control.kind === "option") return true;
  return !(control.packaged && editCount(draft) >= context.allowance.maxEdits);
}

/** The edits in the worker's normalized order, or undefined when none remains. */
function normalize(slots: readonly SlotEdit[], bindings: readonly BindingEdit[], resources: readonly ResourceEdit[], subscriptions: readonly SubscriptionEdit[]): DesignDraft {
  if (!slots.length && !bindings.length && !resources.length && !subscriptions.length) return undefined;
  return {
    slots: [...slots].sort((left, right) => order(left.component, right.component)),
    bindings: [...bindings].sort((left, right) => order(left.component, right.component) || order(left.peer, right.peer)),
    resources: [...resources].sort((left, right) => order(left.owner, right.owner) || order(left.resource, right.resource)),
    subscriptions: [...subscriptions].sort((left, right) => order(left.consumer, right.consumer) || order(left.destination, right.destination)),
  };
}

function lists(draft: DesignDraft) {
  return { slots: draft?.slots ?? [], bindings: draft?.bindings ?? [], resources: draft?.resources ?? [], subscriptions: draft?.subscriptions ?? [] };
}

/**
 * Drops binding edits that a slot change turned into no-ops: a binding to the component the peer
 * already resolves to, over a packaged link, leaves the document unchanged.
 */
function withoutNoopBindings(context: DesignContext, draft: DesignDraft): DesignDraft {
  if (!draft) return draft;
  const bindings = draft.bindings.filter(binding => !(resolvedPeer(context, draft, binding.component, binding.peer) === binding.target && hasLink(context, binding.component, binding.target)));
  return normalize(draft.slots, bindings, draft.resources, draft.subscriptions);
}

/** Chooses the model of a slot: `packaged`, or `‹model›@‹version›`. A new model starts with its default options. */
export function setSlotModel(context: DesignContext, draft: DesignDraft, component: string, value: string): DesignDraft {
  const { slots, bindings, resources, subscriptions } = lists(draft);
  const others = slots.filter(item => item.component !== component);
  const packaged = packagedComponent(context, component);
  const choice = context.allowance.slots.find(slot => slot.component === component)?.models.find(model => `${model.model}@${model.version}` === value);
  const current = slots.find(item => item.component === component);
  // Choosing the packaged model, or the model already chosen, leaves no new edit.
  if (value === PACKAGED_CHOICE || !choice || (packaged?.model === choice.model && packaged.version === choice.version && stable(packaged.configuration ?? {}) === stable({}))) {
    return withoutNoopBindings(context, normalize(others, bindings, resources, subscriptions));
  }
  if (current && current.model === choice.model && current.version === choice.version) return draft;
  return withoutNoopBindings(context, normalize([...others, { component, model: choice.model, version: choice.version, options: [] }], bindings, resources, subscriptions));
}

/** Sets an option of a slot's chosen model. A value equal to the model default is not kept. */
export function setSlotOption(context: DesignContext, draft: DesignDraft, component: string, key: string, value: CanonicalValue): DesignDraft {
  const { slots, bindings, resources, subscriptions } = lists(draft);
  const slot = slots.find(item => item.component === component);
  if (!slot) return draft;
  const declared = descriptor(context, slot.model, slot.version)?.options.find(option => option.key === key);
  if (!declared) return draft;
  const options: ParameterOverride[] = slot.options.filter(option => option.key !== key);
  if (value !== declared.domain.default) options.push({ key, value });
  options.sort((left, right) => order(left.key, right.key));
  const next: SlotEdit = { ...slot, options };
  // A slot edit that gives the packaged model and configuration is not an edit.
  const packaged = packagedComponent(context, component);
  const noop = packaged?.model === slot.model && packaged.version === slot.version
    && stable(packaged.configuration ?? {}) === stable(Object.fromEntries(options.map(option => [option.key, option.value])) as CanonicalValue);
  const others = slots.filter(item => item.component !== component);
  return withoutNoopBindings(context, normalize(noop ? others : [...others, next], bindings, resources, subscriptions));
}

/** Binds a peer. Binding it to the component it already resolves to, over a packaged link, is no edit. */
export function setBinding(context: DesignContext, draft: DesignDraft, component: string, peer: string, target: string): DesignDraft {
  const { slots, bindings, resources, subscriptions } = lists(draft);
  const others = bindings.filter(item => !(item.component === component && item.peer === peer));
  const noop = resolvedPeer(context, draft, component, peer) === target && hasLink(context, component, target);
  return normalize(slots, noop ? others : [...others, { component, peer, target }], resources, subscriptions);
}

/** Attaches (`true`) or detaches a resource. The packaged state is no edit. */
export function setResource(context: DesignContext, draft: DesignDraft, owner: string, resource: "database" | "store", attached: boolean): DesignDraft {
  const { slots, bindings, resources, subscriptions } = lists(draft);
  const others = resources.filter(item => !(item.owner === owner && item.resource === resource));
  const noop = attached === hasResource(context, owner, resource);
  return normalize(slots, bindings, noop ? others : [...others, { owner, resource, change: attached ? "attach" : "detach" }], subscriptions);
}

/** Subscribes (`true`) or unsubscribes a consumer. The packaged state is no edit. */
export function setSubscription(context: DesignContext, draft: DesignDraft, consumer: string, destination: string, subscribed: boolean): DesignDraft {
  const { slots, bindings, resources, subscriptions } = lists(draft);
  const others = subscriptions.filter(item => !(item.consumer === consumer && item.destination === destination));
  const noop = subscribed === hasSubscription(context, consumer, destination);
  return normalize(slots, bindings, resources, noop ? others : [...others, { consumer, destination, change: subscribed ? "subscribe" : "unsubscribe" }]);
}

/** The Run identity form of the applied edits: the count, then each filled slot. */
export function describeDesign(edits: DesignDraft, m: Messages): string {
  const count = editCount(edits);
  if (!count) return "";
  return [m.designEditor.summary.edits(count), ...(edits?.slots ?? []).map(slot => m.designEditor.summary.slot({ component: slot.component, model: slot.model, version: slot.version }))].join(m.designChoices.separator);
}

/** Plain-language text for one diagnostic code, followed by the code. An unknown code gets the generic text. */
export function designDiagnosticText(code: string, maxEdits: number, m: Messages): string {
  const text = code === "OVERLAY_LIMIT" ? m.designEditor.limit(maxEdits) : byCode(m.designEditor.diagnostics, code) ?? m.designEditor.diagnosticUnknown;
  return m.designChoices.withCode({ text, code });
}

/** True for a diagnostic that points into the architecture edits. */
export function isDesignDiagnostic(diagnostic: ScenarioDiagnostic): boolean {
  return diagnostic.path === "/architecture" || diagnostic.path.startsWith("/architecture/");
}

/**
 * Places each `/architecture` diagnostic on the control its path points to, in the submitted
 * edits, or in the section's general list when it points to none.
 */
export function placeDesignDiagnostics(diagnostics: readonly ScenarioDiagnostic[], edits: DesignDraft, maxEdits: number, m: Messages): {
  readonly controls: ReadonlyMap<string, readonly string[]>;
  readonly general: readonly string[];
} {
  const controls = new Map<string, string[]>();
  const general: string[] = [];
  for (const item of diagnostics.filter(isDesignDiagnostic)) {
    const message = designDiagnosticText(item.code, maxEdits, m);
    const match = /^\/architecture\/(slots|bindings|resources|subscriptions)\/(\d+)(?:\/(.*))?$/.exec(item.path);
    const index = match ? Number(match[2]) : -1;
    let id: string | undefined;
    if (match?.[1] === "slots") {
      const slot = edits?.slots[index];
      const option = /^options\/(\d+)(?:\/|$)/.exec(match[3] ?? "");
      const key = option ? slot?.options[Number(option[1])]?.key : undefined;
      id = slot ? (key ? optionControlId(slot.component, key) : slotControlId(slot.component)) : undefined;
    } else if (match?.[1] === "bindings") {
      const binding = edits?.bindings[index];
      id = binding ? bindingControlId(binding.component, binding.peer) : undefined;
    } else if (match?.[1] === "resources") {
      const resource = edits?.resources[index];
      id = resource ? resourceControlId(resource.owner, resource.resource) : undefined;
    } else if (match?.[1] === "subscriptions") {
      const subscription = edits?.subscriptions[index];
      id = subscription ? subscriptionControlId(subscription.consumer, subscription.destination) : undefined;
    }
    if (id === undefined) { general.push(message); continue; }
    controls.set(id, [...(controls.get(id) ?? []), message]);
  }
  return { controls, general };
}
