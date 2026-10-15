// Experiment edits: a pure, data-only transformation of a packaged scenario definition.
// It never touches the worker, virtual time, or a runtime model. The edited scenario is
// handed to the existing `load` command, so the worker remains the only validator.
import type { CanonicalValue } from "@distlab/contracts";

export const linkFields = ["requestLatency", "responseLatency", "jitter", "timeout", "failureRate"] as const;
export type LinkField = (typeof linkFields)[number];
export type LinkPolicyEdit = Partial<Record<LinkField, number>>;

export const faultPoints = ["network.request", "network.response"] as const;
export const faultEffects = ["drop", "fail", "delay", "duplicate"] as const;

export interface FaultDraft {
  /** Link key `source->target` as declared in the architecture. */
  readonly link: string;
  readonly point: (typeof faultPoints)[number];
  readonly effect: (typeof faultEffects)[number];
  /** Endpoint name; empty matches every endpoint on the link. */
  readonly name: string;
  readonly from: number;
  /** Delay duration or duplicate spacing, in virtual time units. */
  readonly duration: number;
}

export interface ExperimentEdits {
  readonly seed?: string;
  readonly links: Readonly<Record<string, LinkPolicyEdit>>;
  readonly flags: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly faults: readonly FaultDraft[];
}

export interface EditableLink { readonly key: string; readonly source: string; readonly target: string; readonly policy: Readonly<Record<LinkField, number>> }
export interface EditableFlag { readonly componentId: string; readonly flag: string; readonly value: boolean }
export interface EditProblem { readonly path: string; readonly message: string }

export const noEdits: ExperimentEdits = Object.freeze({ links: Object.freeze({}), flags: Object.freeze({}), faults: Object.freeze([]) });

type Row = Record<string, CanonicalValue>;
const row = (value: CanonicalValue | undefined): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const list = (value: CanonicalValue | undefined): readonly CanonicalValue[] => Array.isArray(value) ? value : [];
export const linkKey = (source: string, target: string): string => `${source}->${target}`;

export function scenarioSeed(scenario: CanonicalValue): string {
  return String(row(scenario).seed ?? "");
}

export function editableLinks(scenario: CanonicalValue): EditableLink[] {
  return list(row(row(scenario).architecture).links).map(item => {
    const link = row(item);
    const policy = row(link.policy);
    const source = String(link.source), target = String(link.target);
    const defaults: Record<LinkField, number> = { requestLatency: 0, responseLatency: 0, jitter: 0, timeout: 1000, failureRate: 0 };
    for (const field of linkFields) if (typeof policy[field] === "number") defaults[field] = policy[field];
    return { key: linkKey(source, target), source, target, policy: defaults };
  });
}

/** Boolean configuration entries are the design switches a student may flip (idempotent, outbox…). */
export function editableFlags(scenario: CanonicalValue): EditableFlag[] {
  return list(row(row(scenario).architecture).components).flatMap(item => {
    const component = row(item);
    return Object.entries(row(component.configuration))
      .filter(([, value]) => typeof value === "boolean")
      .map(([flag, value]) => ({ componentId: String(component.id), flag, value: value as boolean }));
  });
}

export function hasEdits(scenario: CanonicalValue, edits: ExperimentEdits): boolean {
  if (edits.seed !== undefined && edits.seed !== scenarioSeed(scenario)) return true;
  if (edits.faults.length) return true;
  const links = new Map(editableLinks(scenario).map(link => [link.key, link]));
  if (Object.entries(edits.links).some(([key, policy]) => Object.entries(policy).some(([field, value]) => links.get(key)?.policy[field as LinkField] !== value))) return true;
  const flags = editableFlags(scenario);
  return Object.entries(edits.flags).some(([componentId, values]) => Object.entries(values)
    .some(([flag, value]) => flags.find(item => item.componentId === componentId && item.flag === flag)?.value !== value));
}

const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Rejects edits before they reach the worker, so an invalid value never replaces the running session. */
export function validateEdits(scenario: CanonicalValue, edits: ExperimentEdits): EditProblem[] {
  const problems: EditProblem[] = [];
  if (edits.seed !== undefined && edits.seed.trim() === "") problems.push({ path: "seed", message: "Seed must not be empty." });
  const links = new Map(editableLinks(scenario).map(link => [link.key, link]));
  for (const [key, policy] of Object.entries(edits.links)) {
    if (!links.has(key)) { problems.push({ path: `links.${key}`, message: `Unknown link ${key}.` }); continue; }
    for (const [field, value] of Object.entries(policy) as [LinkField, number][]) {
      const path = `links.${key}.${field}`;
      if (field === "failureRate") { if (!(Number.isFinite(value) && value >= 0 && value <= 1)) problems.push({ path, message: `${key} failure rate must be between 0 and 1.` }); }
      else if (field === "timeout") { if (!(nonNegativeInteger(value) && value > 0)) problems.push({ path, message: `${key} timeout must be a whole number greater than 0.` }); }
      else if (!nonNegativeInteger(value)) problems.push({ path, message: `${key} ${field} must be a whole number of 0 or more.` });
    }
  }
  const flags = editableFlags(scenario);
  for (const [componentId, values] of Object.entries(edits.flags)) for (const [flag, value] of Object.entries(values)) {
    if (typeof value !== "boolean" || !flags.some(item => item.componentId === componentId && item.flag === flag))
      problems.push({ path: `flags.${componentId}.${flag}`, message: `${componentId} has no switch named ${flag}.` });
  }
  edits.faults.forEach((fault, index) => {
    const path = `faults.${index}`;
    if (!links.has(fault.link)) problems.push({ path: `${path}.link`, message: `Fault ${index + 1}: choose a link.` });
    if (!nonNegativeInteger(fault.from)) problems.push({ path: `${path}.from`, message: `Fault ${index + 1}: start time must be a whole number of 0 or more.` });
    if ((fault.effect === "delay" || fault.effect === "duplicate") && !(nonNegativeInteger(fault.duration) && fault.duration > 0))
      problems.push({ path: `${path}.duration`, message: `Fault ${index + 1}: ${fault.effect === "delay" ? "delay" : "spacing"} must be a whole number greater than 0.` });
  });
  return problems;
}

function faultRule(fault: FaultDraft, index: number, links: Map<string, EditableLink>): CanonicalValue {
  const link = links.get(fault.link)!;
  const [source, target] = fault.point === "network.response" ? [link.target, link.source] : [link.source, link.target];
  const effect: Row = fault.effect === "delay" ? { kind: "delay", duration: fault.duration }
    : fault.effect === "duplicate" ? { kind: "duplicate", additionalCopies: 1, spacing: fault.duration }
    : { kind: fault.effect };
  return { id: `experiment-fault-${index + 1}`, point: fault.point, source, target, ...(fault.name.trim() ? { name: fault.name.trim() } : {}),
    from: fault.from, probability: 1, maxApplications: 1, effect };
}

/** Scenario + edits → a new scenario. The input is never mutated; invalid edits throw. */
export function applyEdits(scenario: CanonicalValue, edits: ExperimentEdits): CanonicalValue {
  const problems = validateEdits(scenario, edits);
  if (problems.length) throw new RangeError(problems.map(problem => problem.message).join(" "));
  const base = row(scenario);
  const architecture = row(base.architecture);
  const links = new Map(editableLinks(scenario).map(link => [link.key, link]));
  const next: Row = {
    ...base,
    ...(edits.seed !== undefined ? { seed: edits.seed.trim() } : {}),
    architecture: {
      ...architecture,
      components: list(architecture.components).map(item => {
        const component = row(item);
        const flags = edits.flags[String(component.id)];
        return flags ? { ...component, configuration: { ...row(component.configuration), ...flags } } : component;
      }),
      links: list(architecture.links).map(item => {
        const link = row(item);
        const policy = edits.links[linkKey(String(link.source), String(link.target))];
        return policy ? { ...link, policy: { ...row(link.policy), ...policy } } : link;
      }),
    },
    faults: [...list(base.faults), ...edits.faults.map((fault, index) => faultRule(fault, index, links))],
  };
  return JSON.parse(JSON.stringify(next)) as CanonicalValue;
}
