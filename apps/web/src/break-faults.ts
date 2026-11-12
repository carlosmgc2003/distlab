import type {
  ArchitectureDefinition,
  ArchitectureEdits,
  CanonicalValue,
  FaultEffect,
  FaultPoint,
  FaultRule,
  LessonOverlayPolicy,
  OverlayScheduledFault,
  ScenarioDiagnostic,
  ScheduledFault,
  SessionOverlay,
} from "@distlab/contracts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";

/**
 * Faults section model (ADR-004; the Experiment drawer, #143). Pure: it maps section input to contract shapes and
 * reads lesson policies as data. It never validates the applied document, never
 * applies an overlay, and never sends a command. The worker validates the draft
 * against its own copy of the policy when the student applies it.
 */

/** Mirrors `STUDENT_ID_PREFIX` in `@distlab/contracts`; the main thread imports contract types only. */
export const STUDENT_PREFIX = "student-";

export type FaultKindId =
  | `${FaultPoint}/${FaultEffect["kind"]}`
  | `scheduled/${ScheduledFault["kind"]}`;

export interface FaultKindOption {
  readonly id: FaultKindId;
  readonly label: string;
  readonly kind: "rule" | "scheduled";
  readonly point?: FaultPoint;
  readonly effect?: FaultEffect["kind"];
  readonly scheduled?: ScheduledFault["kind"];
  /** What the student picks: a link, a destination, a database, or a component. */
  readonly target: "link" | "destination" | "database" | "service" | "external";
}

/** The label of a rule kind, from the catalog; an unknown kind falls back to its effect and point. */
function ruleLabel(point: FaultPoint, effect: FaultEffect["kind"], m: Messages): string {
  return byCode(m.faults.ruleLabels, `${point}/${effect}`) ?? m.faults.unknownRule({ effect, point });
}

/** Only the kinds the lesson allows are offered, in policy order. */
export function faultKindOptions(policy: LessonOverlayPolicy | undefined, m: Messages): readonly FaultKindOption[] {
  if (!policy) return [];
  const rules = policy.faults.rules.flatMap(rule => rule.effects.map((effect): FaultKindOption => ({
    id: `${rule.point}/${effect}`, label: ruleLabel(rule.point, effect, m), kind: "rule", point: rule.point, effect,
    target: rule.point === "message.delivery" ? "destination" : rule.point === "database.commit" ? "database" : "link",
  })));
  const scheduled = policy.faults.scheduled.map((kind): FaultKindOption => ({
    id: `scheduled/${kind}`, label: m.faults.scheduledLabels[kind], kind: "scheduled", scheduled: kind, target: kind === "crash" ? "service" : "external",
  }));
  return [...rules, ...scheduled];
}

export interface TargetOption {
  /** Stable form value. */
  readonly value: string;
  readonly label: string;
  readonly source?: string;
  readonly target?: string;
  readonly name?: string;
  /** Graph element this option corresponds to, for picking and marking. */
  readonly graph: { readonly kind: "node"; readonly id: string } | { readonly kind: "link"; readonly source: string; readonly target: string };
}

/**
 * Targets come from the packaged architecture. A request travels a link from its
 * source to its target and the response travels back, so a response fault names
 * the responder as source, as the packaged lessons do.
 */
export function targetOptions(option: FaultKindOption | undefined, architecture: ArchitectureDefinition | undefined, m: Messages, names?: ComponentNames): readonly TargetOption[] {
  if (!option || !architecture) return [];
  // Labels name components by display name (#103); values and graph identity keep the IDs.
  const name = (id: string) => displayName(names, id);
  switch (option.target) {
    case "link":
      return architecture.links.map(link => {
        const response = option.point === "network.response";
        const source = response ? link.target : link.source;
        const target = response ? link.source : link.target;
        return { value: `link:${link.source}:${link.target}`, label: `${name(source)} → ${name(target)}`, source, target, graph: { kind: "link", source: link.source, target: link.target } };
      });
    case "destination":
      return architecture.subscriptions.map(item => ({
        value: `destination:${item.destination}:${item.consumer}`, label: `${item.destination} → ${name(item.consumer)}`, target: item.consumer, name: item.destination,
        graph: { kind: "link", source: item.destination, target: item.consumer },
      }));
    case "database":
      return architecture.databases.map(item => ({ value: `database:${item.owner}`, label: m.architecture.databaseOwnedBy(name(item.owner)), name: item.owner, graph: { kind: "node", id: databaseNodeId(item.owner) } }));
    case "service":
    case "external":
      return architecture.components.filter(item => item.kind === option.target).map(item => ({ value: `component:${item.id}`, label: name(item.id), target: item.id, graph: { kind: "node", id: item.id } }));
  }
}

/** The architecture graph's node for a database resource. */
export function databaseNodeId(owner: string): string {
  return `resource:db:${owner}`;
}

/** Resolves a graph click to the matching target option for the chosen kind, if any. */
export function pickTarget(options: readonly TargetOption[], picked: { readonly kind: "node"; readonly id: string } | { readonly kind: "link"; readonly source: string; readonly target: string }): TargetOption | undefined {
  return options.find(option => picked.kind === "node"
    ? option.graph.kind === "node" && option.graph.id === picked.id
      // A topic or queue node stands for its first subscription.
      || option.name !== undefined && option.graph.kind === "link" && option.graph.source === picked.id
    : option.graph.kind === "link" && option.graph.source === picked.source && option.graph.target === picked.target);
}

/** Every form field is text, exactly as typed. Empty means "use the default" or "no selector". */
export interface FaultForm {
  readonly kind: FaultKindId | "";
  readonly target: string;
  readonly endpoint: string;
  readonly from: string;
  readonly until: string;
  readonly occurrence: string;
  readonly maxApplications: string;
  readonly probability: string;
  readonly duration: string;
  readonly additionalCopies: string;
  readonly spacing: string;
  readonly at: string;
  readonly state: string;
}

export type FormField = keyof FaultForm;

export const emptyForm: FaultForm = {
  kind: "", target: "", endpoint: "", from: "0", until: "", occurrence: "", maxApplications: "1", probability: "1",
  duration: "100", additionalCopies: "1", spacing: "1", at: "0", state: "UNAVAILABLE",
};

export type DraftEntry =
  | { readonly kind: "rule"; readonly rule: FaultRule }
  | { readonly kind: "scheduled"; readonly action: OverlayScheduledFault };

/** A form field problem as a code and its parameters. The section keeps this, never the finished text (ADR-007). */
export type FieldError =
  | { readonly code: "CHOOSE_FAULT" | "CHOOSE_TARGET" | "WHOLE_NUMBER" | "CHOOSE_STATE" | "PROBABILITY" }
  | { readonly code: "MINIMUM"; readonly minimum: number };

export function fieldErrorText(error: FieldError, m: Messages): string {
  switch (error.code) {
    case "CHOOSE_FAULT": return m.faults.errors.chooseFault;
    case "CHOOSE_TARGET": return m.faults.errors.chooseTarget;
    case "WHOLE_NUMBER": return m.faults.errors.wholeNumber;
    case "MINIMUM": return m.faults.errors.minimum(error.minimum);
    case "CHOOSE_STATE": return m.faults.errors.chooseState;
    case "PROBABILITY": return m.faults.errors.probability;
  }
}

export interface FormResult {
  readonly entry?: DraftEntry;
  readonly errors: Partial<Record<FormField, FieldError>>;
}

const wholeNumber = /^(0|[1-9][0-9]*)$/;

/**
 * Maps panel input one-to-one onto `FaultRule` or a scheduled `fault` action.
 * Field checks here only reject text that has no contract value. Contract rules
 * (time windows, copy limits, overlapping duplicates, the lesson policy) come
 * back from the worker as diagnostics on the applied draft.
 */
export function buildEntry(form: FaultForm, options: readonly FaultKindOption[], targets: readonly TargetOption[], id: string): FormResult {
  const errors: Partial<Record<FormField, FieldError>> = {};
  const option = options.find(item => item.id === form.kind);
  if (!option) return { errors: { kind: { code: "CHOOSE_FAULT" } } };
  const target = targets.find(item => item.value === form.target);
  if (!target) errors.target = { code: "CHOOSE_TARGET" };
  const whole = (field: FormField, { required = false, minimum = 0 } = {}): number | undefined => {
    const text = form[field].trim();
    if (!text) { if (required) errors[field] = { code: "WHOLE_NUMBER" }; return undefined; }
    if (!wholeNumber.test(text) || !Number.isSafeInteger(Number(text))) { errors[field] = { code: "WHOLE_NUMBER" }; return undefined; }
    const value = Number(text);
    if (value < minimum) { errors[field] = { code: "MINIMUM", minimum }; return undefined; }
    return value;
  };
  if (option.kind === "scheduled") {
    const at = whole("at", { required: true });
    if (option.scheduled === "external-availability" && !["AVAILABLE", "DEGRADED", "UNAVAILABLE", "RATE_LIMITED"].includes(form.state)) errors.state = { code: "CHOOSE_STATE" };
    if (Object.keys(errors).length || at === undefined || !target?.target) return { errors };
    const fault: ScheduledFault = option.scheduled === "crash"
      ? { id: `${id}-fault`, kind: "crash", target: target.target }
      : { id: `${id}-fault`, kind: "external-availability", target: target.target, state: form.state as "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" };
    return { errors, entry: { kind: "scheduled", action: { id, at, kind: "fault", fault } as OverlayScheduledFault } };
  }
  const from = whole("from", { required: true });
  const until = whole("until");
  const occurrence = whole("occurrence", { minimum: 1 });
  const maxApplications = whole("maxApplications", { required: true, minimum: 1 });
  const probabilityText = form.probability.trim();
  const probability = probabilityText === "" ? 1 : Number(probabilityText);
  if (!/^(0(\.[0-9]+)?|1(\.0+)?|\.[0-9]+)$/.test(probabilityText) && probabilityText !== "") errors.probability = { code: "PROBABILITY" };
  let effect: FaultEffect | undefined;
  if (option.effect === "delay") {
    const duration = whole("duration", { required: true });
    // Durations are branded contract numbers; the worker validates the value.
    if (duration !== undefined) effect = { kind: "delay", duration } as unknown as FaultEffect;
  } else if (option.effect === "duplicate") {
    const additionalCopies = whole("additionalCopies", { required: true, minimum: 1 });
    const spacing = whole("spacing", { required: true });
    if (additionalCopies !== undefined && spacing !== undefined) effect = { kind: "duplicate", additionalCopies, spacing } as unknown as FaultEffect;
  } else if (option.effect) effect = { kind: option.effect } as FaultEffect;
  const endpoint = form.endpoint.trim();
  if (Object.keys(errors).length || from === undefined || maxApplications === undefined || !effect || !target || !option.point) return { errors };
  const rule = {
    id, point: option.point,
    ...(target.source !== undefined ? { source: target.source } : {}),
    ...(target.target !== undefined ? { target: target.target } : {}),
    ...(target.name !== undefined ? { name: target.name } : endpoint ? { name: endpoint } : {}),
    from, ...(until !== undefined ? { until } : {}), ...(occurrence !== undefined ? { occurrence } : {}),
    probability, maxApplications, effect,
  } as FaultRule;
  return { errors, entry: { kind: "rule", rule } };
}

/** Restores the form from an entry, so a student can inspect or edit it. */
export function formFromEntry(entry: DraftEntry, targets: (kind: FaultKindId) => readonly TargetOption[]): FaultForm {
  if (entry.kind === "scheduled") {
    const kind: FaultKindId = `scheduled/${entry.action.fault.kind}`;
    const target = targets(kind).find(item => item.target === entry.action.fault.target);
    return { ...emptyForm, kind, target: target?.value ?? "", at: String(entry.action.at),
      state: entry.action.fault.kind === "external-availability" ? entry.action.fault.state : emptyForm.state };
  }
  const rule = entry.rule;
  const kind: FaultKindId = `${rule.point}/${rule.effect.kind}`;
  const target = targets(kind).find(item => item.source === rule.source && item.target === rule.target && (item.name === undefined || item.name === rule.name));
  return {
    ...emptyForm, kind, target: target?.value ?? "",
    endpoint: target?.name === undefined && rule.name !== undefined ? rule.name : "",
    from: String(rule.from), until: rule.until === undefined ? "" : String(rule.until),
    occurrence: rule.occurrence === undefined ? "" : String(rule.occurrence),
    maxApplications: String(rule.maxApplications), probability: String(rule.probability),
    duration: rule.effect.kind === "delay" ? String(rule.effect.duration) : emptyForm.duration,
    additionalCopies: rule.effect.kind === "duplicate" ? String(rule.effect.additionalCopies) : emptyForm.additionalCopies,
    spacing: rule.effect.kind === "duplicate" ? String(rule.effect.spacing) : emptyForm.spacing,
  };
}

/** The next free student ID. IDs appear verbatim in Recorded history, so they stay short and readable. */
export function nextStudentId(entries: readonly DraftEntry[]): string {
  const used = entries.map(entry => entry.kind === "rule" ? entry.rule.id : entry.action.id);
  let index = entries.length + 1;
  while (used.includes(`${STUDENT_PREFIX}fault-${index}`)) index++;
  return `${STUDENT_PREFIX}fault-${index}`;
}

export function entryId(entry: DraftEntry): string {
  return entry.kind === "rule" ? entry.rule.id : entry.action.id;
}

/**
 * Short chip text, for example "Drop response · payment-processor → payments · occurrence 1". Each fact is its own
 * message, so a language orders and words them itself; the catalog's separator joins them.
 */
export function describeEntry(entry: DraftEntry, m: Messages): string {
  const copy = m.faults.describe;
  if (entry.kind === "scheduled") {
    const fault = entry.action.fault;
    return [
      fault.kind === "crash" ? m.faults.scheduledLabels.crash : copy.becomes({ target: fault.target, state: fault.state }),
      ...(fault.kind === "crash" ? [fault.target] : []),
      copy.at(entry.action.at),
    ].join(copy.separator);
  }
  const rule = entry.rule;
  const label = ruleLabel(rule.point, rule.effect.kind, m);
  const head = rule.effect.kind === "delay" ? copy.delayed({ label, duration: rule.effect.duration })
    : rule.effect.kind === "duplicate" ? copy.duplicated({ label, copies: rule.effect.additionalCopies + 1, spacing: rule.effect.spacing }) : label;
  const where = rule.point === "database.commit" ? rule.name === undefined ? copy.anyDatabase : copy.database(rule.name)
    : rule.point === "message.delivery" ? copy.route({ from: rule.name ?? copy.anyDestination, to: rule.target ?? copy.anyConsumer })
    : rule.name ? copy.routeNamed({ from: rule.source ?? copy.any, to: rule.target ?? copy.any, name: rule.name })
    : copy.route({ from: rule.source ?? copy.any, to: rule.target ?? copy.any });
  return [
    head, where,
    ...(rule.until !== undefined ? [copy.window({ from: rule.from, until: rule.until })] : rule.from > 0 ? [copy.from(rule.from)] : []),
    ...(rule.occurrence !== undefined ? [copy.occurrence(rule.occurrence)] : []),
    ...(rule.maxApplications !== 1 ? [copy.times(rule.maxApplications)] : []),
    ...(rule.probability !== 1 ? [copy.probability(rule.probability)] : []),
  ].join(copy.separator);
}

export function overlayFromDraft(entries: readonly DraftEntry[], parameters: SessionOverlay["parameters"] = []): SessionOverlay {
  return {
    version: 1,
    faults: entries.flatMap(entry => entry.kind === "rule" ? [entry.rule] : []),
    scheduledFaults: entries.flatMap(entry => entry.kind === "scheduled" ? [entry.action] : []),
    parameters,
  };
}

/** Rules first, then scheduled faults: the order the overlay itself keeps. */
export function draftFromOverlay(overlay: SessionOverlay): DraftEntry[] {
  return [
    ...overlay.faults.map(rule => ({ kind: "rule" as const, rule })),
    ...overlay.scheduledFaults.map(action => ({ kind: "scheduled" as const, action })),
  ];
}

/** True when the draft is exactly what the worker applied, after the fault engine's defaults. */
export function sameOverlay(left: SessionOverlay, right: SessionOverlay): boolean {
  return stable(left as unknown as CanonicalValue) === stable(right as unknown as CanonicalValue);
}

function stable(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key]!)}`).join(",")}}`;
}

/** An `INVALID_OVERLAY` diagnostic placed on the draft entry and form field it names. */
export interface EntryDiagnostic {
  readonly entryId: string;
  readonly field?: FormField;
  readonly message: string;
}

const fieldOf: Readonly<Record<string, FormField>> = {
  from: "from", until: "until", occurrence: "occurrence", maxApplications: "maxApplications", probability: "probability",
  source: "target", target: "target", name: "endpoint", point: "kind", effect: "kind", kind: "kind",
  duration: "duration", additionalCopies: "additionalCopies", spacing: "spacing", at: "at", state: "state",
};

/** Places worker diagnostics, whose paths point into the submitted overlay, on draft entries. */
export function placeDiagnostics(diagnostics: readonly ScenarioDiagnostic[], overlay: SessionOverlay, m: Messages): { readonly entries: readonly EntryDiagnostic[]; readonly general: readonly string[] } {
  const entries: EntryDiagnostic[] = [];
  const general: string[] = [];
  for (const item of diagnostics) {
    const match = /^\/(faults|scheduledFaults)\/(\d+)(?:\/(.*))?$/.exec(item.path);
    const entry = match ? (match[1] === "faults" ? overlay.faults[Number(match[2])] : overlay.scheduledFaults[Number(match[2])]) : undefined;
    const message = m.faults.withCode({ text: byCode(m.faults.diagnostics, item.code) ?? m.faults.diagnosticUnknown, code: item.code });
    if (!match || !entry) { general.push(m.faults.general({ path: item.path, message })); continue; }
    const tokens = (match[3] ?? "").split("/").filter(Boolean).filter(token => token !== "fault" && token !== "effect");
    const field = fieldOf[tokens.at(-1) ?? ""];
    entries.push({ entryId: entry.id, ...(field ? { field } : {}), message });
  }
  return { entries, general };
}

/**
 * Compare carries every student fault entry. A parameter override survives only
 * when the paired lesson declares the same key, domain, and default. An
 * architecture edit (ADR-005) survives only when the paired lesson's allowance
 * permits the same edit. The others are dropped and listed, never removed silently.
 */
export function carryOverlay(overlay: SessionOverlay, from: LessonOverlayPolicy | undefined, to: LessonOverlayPolicy | undefined, m: Messages): { readonly overlay: SessionOverlay; readonly dropped: readonly string[] } {
  const dropped: string[] = [];
  const parameters = overlay.parameters.filter(override => {
    const left = from?.parameters.find(item => item.key === override.key);
    const right = to?.parameters.find(item => item.key === override.key);
    const keep = left !== undefined && right !== undefined && stable(left.domain as unknown as CanonicalValue) === stable(right.domain as unknown as CanonicalValue);
    if (!keep) dropped.push(override.key);
    return keep;
  });
  const { architecture: edits, ...rest } = overlay;
  if (!edits) return { overlay: { ...rest, parameters }, dropped };
  const allowance = to?.architecture;
  const keep = <T>(items: readonly T[], allowed: (item: T) => boolean, label: (item: T) => string): T[] =>
    items.filter(item => { const kept = allowed(item); if (!kept) dropped.push(label(item)); return kept; });
  const architecture: ArchitectureEdits = {
    slots: keep(edits.slots, edit => allowance?.slots.some(slot => slot.component === edit.component
      && slot.models.some(model => model.model === edit.model && model.version === edit.version)) === true, edit => m.faults.dropped.slot(edit.component)),
    bindings: keep(edits.bindings, edit => allowance?.bindings.some(binding => binding.component === edit.component && binding.peer === edit.peer
      && binding.candidates.includes(edit.target)) === true, edit => m.faults.dropped.binding({ component: edit.component, peer: edit.peer })),
    resources: keep(edits.resources, edit => allowance?.resources.some(resource => resource.owner === edit.owner && resource.resource === edit.resource) === true,
      edit => m.faults.dropped.resource({ owner: edit.owner, resource: edit.resource })),
    subscriptions: keep(edits.subscriptions, edit => allowance?.subscriptions.some(subscription => subscription.consumer === edit.consumer
      && subscription.destination === edit.destination) === true, edit => m.faults.dropped.subscription({ consumer: edit.consumer, destination: edit.destination })),
  };
  return { overlay: { ...rest, parameters, ...(designEdits(architecture) ? { architecture } : {}) }, dropped };
}

/** Number of architecture edits in an overlay (ADR-005). */
export function designEdits(edits: ArchitectureEdits | undefined): number {
  return edits ? edits.slots.length + edits.bindings.length + edits.resources.length + edits.subscriptions.length : 0;
}

export function isEmptyOverlay(overlay: SessionOverlay): boolean {
  return !overlay.faults.length && !overlay.scheduledFaults.length && !overlay.parameters.length && !designEdits(overlay.architecture);
}

/** Graph marks for applied faults: a broken-link mark on links and a fault mark on components. */
export function faultMarks(entries: readonly DraftEntry[], architecture: ArchitectureDefinition | undefined, m: Messages): { readonly links: ReadonlyMap<string, string[]>; readonly nodes: ReadonlyMap<string, string[]> } {
  const links = new Map<string, string[]>();
  const nodes = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, label: string) => map.set(key, [...(map.get(key) ?? []), label]);
  for (const entry of entries) {
    const label = describeEntry(entry, m);
    if (entry.kind === "scheduled") { add(nodes, entry.action.fault.target, label); continue; }
    const rule = entry.rule;
    if (rule.point === "database.commit") {
      for (const item of architecture?.databases ?? []) if (rule.name === undefined || rule.name === item.owner) add(nodes, databaseNodeId(item.owner), label);
      continue;
    }
    if (rule.point === "message.delivery") {
      const subscriptions = architecture?.subscriptions.filter(item => (rule.name === undefined || item.destination === rule.name) && (rule.target === undefined || item.consumer === rule.target)) ?? [];
      for (const item of subscriptions) add(links, `${item.destination}->${item.consumer}`, label);
      continue;
    }
    const matching = architecture?.links.filter(link => {
      const [source, target] = rule.point === "network.response" ? [link.target, link.source] : [link.source, link.target];
      return (rule.source === undefined || rule.source === source) && (rule.target === undefined || rule.target === target);
    }) ?? [];
    for (const link of matching) add(links, `${link.source}->${link.target}`, label);
  }
  return { links, nodes };
}
