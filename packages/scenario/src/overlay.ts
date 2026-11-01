import type {
  LessonOverlayPolicy,
  LessonParameter,
  LessonParameterTarget,
  ParameterOverride,
  ScenarioDiagnostic,
  SessionOverlay,
} from "@distlab/contracts";
import { OverlayDiagnosticCodes, STUDENT_ID_PREFIX } from "@distlab/contracts";
import type { CanonicalValue } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode } from "@distlab/kernel";
import { DiagnosticCodes } from "./types.js";

/**
 * Session overlays (ADR-004). Pure functions of the packaged document, its policy
 * and the submitted overlay: no model is created, no simulation identity is
 * allocated, and no randomness is drawn. Only the worker composition root and
 * headless tools call this module.
 */

export const EMPTY_OVERLAY: SessionOverlay = Object.freeze({
  version: 1, faults: Object.freeze([]), scheduledFaults: Object.freeze([]), parameters: Object.freeze([]),
});

/** A lesson without a policy accepts only the empty overlay. */
const closedAllowance: LessonOverlayPolicy["faults"] = { rules: [], scheduled: [], maxEntries: 0 };

export interface OverlayValidation {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  /** Present only when `diagnostics` is empty. */
  readonly overlay?: SessionOverlay;
}

type Push = (path: string, code: string) => void;
type Doc = Record<string, CanonicalValue>;

const faultPoints = new Set<string>(["network.request", "network.response", "message.delivery", "database.commit"]);
const overlayKeys = ["version", "faults", "scheduledFaults", "parameters"];
const scheduledKeys = ["id", "at", "kind", "fault"];
const parameterKeys = ["key", "value"];

/**
 * Stage 3: the overlay against the lesson policy. Checks the schema, allowed
 * point and effect pairs, scheduled-fault kinds, the entry limit, the student
 * ID prefix and parameter keys and values, then normalizes. Field details such
 * as times and probability bounds are left to the applied-document stage.
 */
export function validateOverlay(input: CanonicalValue | undefined, policy: LessonOverlayPolicy | undefined): OverlayValidation {
  if (input === undefined) return { diagnostics: Object.freeze([]), overlay: EMPTY_OVERLAY };
  const found: ScenarioDiagnostic[] = [];
  const push: Push = (path, code) => { found.push({ path, code }); };
  const overlay = readOverlay(input, policy, push);
  const diagnostics = sortDiagnostics(found);
  return diagnostics.length === 0 && overlay ? { diagnostics, overlay } : { diagnostics };
}

function readOverlay(input: CanonicalValue, policy: LessonOverlayPolicy | undefined, push: Push): SessionOverlay | undefined {
  const root = record(input, "", overlayKeys, push);
  if (!root) return undefined;
  if (root.version === undefined) push("/version", DiagnosticCodes.REQUIRED);
  else if (root.version !== 1) push("/version", DiagnosticCodes.VERSION);
  const allowance = policy?.faults ?? closedAllowance;
  const faults = list(root.faults, "/faults", push)?.map((item, index) => readRule(item, `/faults/${index}`, allowance, push));
  const scheduled = list(root.scheduledFaults, "/scheduledFaults", push)?.map((item, index) => readScheduled(item, `/scheduledFaults/${index}`, allowance, push));
  const parameters = readParameters(root.parameters, policy?.parameters ?? [], push);
  if (faults && scheduled) {
    const entries = [...faults.map((_, index) => `/faults/${index}`), ...scheduled.map((_, index) => `/scheduledFaults/${index}`)];
    for (const path of entries.slice(allowance.maxEntries)) push(path, OverlayDiagnosticCodes.OVERLAY_LIMIT);
  }
  if (!faults || !scheduled || !parameters || faults.some(item => !item) || scheduled.some(item => !item)) return undefined;
  return Object.freeze({
    version: 1,
    faults: Object.freeze(faults as Doc[]) as unknown as SessionOverlay["faults"],
    scheduledFaults: Object.freeze(scheduled as Doc[]) as unknown as SessionOverlay["scheduledFaults"],
    parameters,
  });
}

function readRule(value: CanonicalValue, path: string, allowance: LessonOverlayPolicy["faults"], push: Push): Doc | undefined {
  // Rule keys are checked again by the scenario validator; only the fields this stage needs are read.
  const rule = record(value, path, [], push, true);
  if (!rule) return undefined;
  studentId(rule.id, `${path}/id`, push);
  const point = rule.point;
  const effect = rule.effect;
  if (typeof point !== "string" || !faultPoints.has(point)) push(`${path}/point`, point === undefined ? DiagnosticCodes.REQUIRED : DiagnosticCodes.FAULT);
  const kind = effect !== null && typeof effect === "object" && !Array.isArray(effect) ? (effect as Doc).kind : undefined;
  if (typeof kind !== "string") push(effect === undefined ? `${path}/effect` : `${path}/effect/kind`, DiagnosticCodes.REQUIRED);
  if (typeof point === "string" && faultPoints.has(point) && typeof kind === "string") {
    const allowed = allowance.rules.find(item => item.point === point);
    if (!allowed) push(`${path}/point`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED);
    else if (!(allowed.effects as readonly string[]).includes(kind)) push(`${path}/effect/kind`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED);
  }
  // Fault engine defaults, so equal applied documents have one overlay identity.
  return { ...rule, probability: rule.probability ?? 1, maxApplications: rule.maxApplications ?? 1 };
}

function readScheduled(value: CanonicalValue, path: string, allowance: LessonOverlayPolicy["faults"], push: Push): Doc | undefined {
  const action = record(value, path, scheduledKeys, push);
  if (!action) return undefined;
  studentId(action.id, `${path}/id`, push);
  if (action.kind === undefined) push(`${path}/kind`, DiagnosticCodes.REQUIRED);
  else if (action.kind !== "fault") push(`${path}/kind`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED);
  const fault = record(action.fault, `${path}/fault`, [], push, true, true);
  if (fault) {
    studentId(fault.id, `${path}/fault/id`, push);
    if (typeof fault.kind !== "string") push(`${path}/fault/kind`, fault.kind === undefined ? DiagnosticCodes.REQUIRED : DiagnosticCodes.TYPE);
    else if (!(allowance.scheduled as readonly string[]).includes(fault.kind)) push(`${path}/fault/kind`, OverlayDiagnosticCodes.OVERLAY_NOT_ALLOWED);
  }
  return action;
}

function readParameters(value: CanonicalValue | undefined, declared: readonly LessonParameter[], push: Push): readonly ParameterOverride[] | undefined {
  const items = list(value, "/parameters", push);
  if (!items) return undefined;
  const seen = new Set<string>();
  const overrides: ParameterOverride[] = [];
  let valid = true;
  items.forEach((item, index) => {
    const path = `/parameters/${index}`;
    const entry = record(item, path, parameterKeys, push);
    if (!entry) { valid = false; return; }
    const key = entry.key;
    if (typeof key !== "string" || key.length === 0) { push(`${path}/key`, key === undefined ? DiagnosticCodes.REQUIRED : DiagnosticCodes.TYPE); valid = false; return; }
    if (seen.has(key)) { push(`${path}/key`, DiagnosticCodes.DUPLICATE); valid = false; return; }
    seen.add(key);
    const parameter = declared.find(candidate => candidate.key === key);
    if (!parameter) { push(`${path}/key`, OverlayDiagnosticCodes.UNKNOWN_PARAMETER); valid = false; return; }
    if (entry.value === undefined) { push(`${path}/value`, DiagnosticCodes.REQUIRED); valid = false; return; }
    if (!inDomain(entry.value, parameter)) { push(`${path}/value`, OverlayDiagnosticCodes.PARAMETER_VALUE); valid = false; return; }
    // An override equal to its default is removed: equal applied documents have one overlay identity.
    if (entry.value !== parameter.domain.default) overrides.push(Object.freeze({ key, value: entry.value }));
  });
  if (!valid) return undefined;
  overrides.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return Object.freeze(overrides);
}

export function inDomain(value: CanonicalValue, parameter: LessonParameter): boolean {
  const domain = parameter.domain;
  if (domain.type === "boolean") return typeof value === "boolean";
  if (domain.type === "integer") return typeof value === "number" && Number.isSafeInteger(value) && value >= domain.minimum && value <= domain.maximum;
  return typeof value === "string" && domain.choices.includes(value);
}

function studentId(value: CanonicalValue | undefined, path: string, push: Push): void {
  if (value === undefined) push(path, DiagnosticCodes.REQUIRED);
  else if (typeof value !== "string") push(path, DiagnosticCodes.TYPE);
  else if (!value.startsWith(STUDENT_ID_PREFIX) || value.length === STUDENT_ID_PREFIX.length) push(path, OverlayDiagnosticCodes.OVERLAY_ID_PREFIX);
}

/**
 * Applies a normalized overlay. Packaged faults and actions come first, so
 * packaged rules compose before student rules and packaged actions dispatch
 * first at equal virtual time. The empty overlay returns the packaged document.
 */
export function applyOverlay(packaged: CanonicalValue, policy: LessonOverlayPolicy | undefined, overlay: SessionOverlay): CanonicalValue {
  const source = packaged as Doc;
  if (!overlay.faults.length && !overlay.scheduledFaults.length && !overlay.parameters.length) return packaged;
  const document = structuredClone(canonicalCopy(source)) as Doc;
  if (overlay.faults.length) document.faults = [...((source.faults ?? []) as CanonicalValue[]), ...(overlay.faults as unknown as CanonicalValue[])];
  if (overlay.scheduledFaults.length) document.actions = [...((source.actions ?? []) as CanonicalValue[]), ...(overlay.scheduledFaults as unknown as CanonicalValue[])];
  for (const override of overlay.parameters) {
    const parameter = policy?.parameters.find(item => item.key === override.key);
    if (!parameter) throw new TypeError(`Undeclared parameter ${override.key}`);
    for (const target of parameter.targets) {
      const location = resolveTarget(document, target);
      if (!location) throw new TypeError(`Unresolved parameter target for ${override.key}`);
      location.container[location.field] = override.value;
    }
  }
  return canonicalCopy(document);
}

export interface TargetLocation {
  readonly container: Doc;
  readonly field: string;
  /** JSON pointer of the value in the packaged document. */
  readonly path: string;
  readonly count: number;
}

/** Resolves a parameter target by stable identity, never by index. */
export function resolveTarget(document: CanonicalValue, target: LessonParameterTarget): TargetLocation | undefined {
  const root = document as Doc;
  const architecture = (root.architecture ?? {}) as Doc;
  const find = (items: CanonicalValue | undefined, match: (item: Doc) => boolean) => {
    const all = Array.isArray(items) ? items as Doc[] : [];
    const indexes = all.flatMap((item, index) => item && typeof item === "object" && match(item) ? [index] : []);
    return { all, indexes };
  };
  let found: { all: Doc[]; indexes: number[] };
  let base: string;
  let container: (item: Doc) => CanonicalValue | undefined;
  switch (target.kind) {
    case "component":
      found = find(architecture.components, item => item.id === target.component);
      base = "/architecture/components"; container = item => item.configuration; break;
    case "link":
      found = find(architecture.links, item => item.source === target.source && item.target === target.target);
      base = "/architecture/links"; container = item => item.policy; break;
    case "destination":
      found = find(architecture.destinations, item => item.id === target.destination);
      base = "/architecture/destinations"; container = item => item; break;
    case "action":
      found = find(root.actions, item => item.id === target.action && item.kind === "client");
      base = "/actions"; container = item => item.data; break;
  }
  const index = found.indexes[0];
  if (index === undefined) return undefined;
  const holder = container(found.all[index]!);
  if (!holder || typeof holder !== "object" || Array.isArray(holder) || !Object.hasOwn(holder, target.field)) return undefined;
  const middle = target.kind === "component" ? "/configuration" : target.kind === "link" ? "/policy" : target.kind === "action" ? "/data" : "";
  return { container: holder as Doc, field: target.field, path: `${base}/${index}${middle}/${escape(target.field)}`, count: found.indexes.length };
}

export type OverlayComposition =
  | { readonly ok: true; readonly overlay: SessionOverlay; readonly document: CanonicalValue }
  | { readonly ok: false; readonly code: "INVALID_OVERLAY" | "INVALID_SCENARIO"; readonly diagnostics: readonly ScenarioDiagnostic[] };

/**
 * Stages 3 and 4 of ADR-004 validation. `validate` is the unchanged, pure
 * `ScenarioEngine.validate`. Diagnostics inside overlay-originated entries or
 * parameter targets are translated to overlay paths; any other diagnostic is a
 * catalog defect.
 */
export function composeOverlay(
  packaged: CanonicalValue,
  policy: LessonOverlayPolicy | undefined,
  input: CanonicalValue | undefined,
  validate: (document: CanonicalValue) => readonly ScenarioDiagnostic[],
): OverlayComposition {
  const checked = validateOverlay(input, policy);
  if (!checked.overlay) return { ok: false, code: "INVALID_OVERLAY", diagnostics: checked.diagnostics };
  const document = applyOverlay(packaged, policy, checked.overlay);
  const diagnostics = validate(document);
  if (diagnostics.length === 0) return { ok: true, overlay: checked.overlay, document };
  const translate = translator(packaged, policy, input);
  const translated = diagnostics.map(item => ({ item, path: translate(item.path) }));
  if (translated.some(entry => entry.path === undefined)) return { ok: false, code: "INVALID_SCENARIO", diagnostics };
  return { ok: false, code: "INVALID_OVERLAY", diagnostics: sortDiagnostics(translated.map(entry => ({ path: entry.path!, code: entry.item.code }))) };
}

function translator(packaged: CanonicalValue, policy: LessonOverlayPolicy | undefined, input: CanonicalValue | undefined): (path: string) => string | undefined {
  const source = packaged as Doc;
  const faultCount = Array.isArray(source.faults) ? source.faults.length : 0;
  const actionCount = Array.isArray(source.actions) ? source.actions.length : 0;
  const submitted = input !== null && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Doc).parameters) ? (input as Doc).parameters as Doc[] : [];
  const targets = submitted.flatMap((entry, index) => {
    const parameter = policy?.parameters.find(item => item.key === entry.key);
    return (parameter?.targets ?? []).flatMap(target => {
      const location = resolveTarget(packaged, target);
      return location ? [{ path: location.path, overlay: `/parameters/${index}/value` }] : [];
    });
  });
  return path => {
    const entry = /^\/(faults|actions)\/(\d+)(\/.*)?$/.exec(path);
    if (entry) {
      const index = Number(entry[2]);
      const offset = entry[1] === "faults" ? faultCount : actionCount;
      if (index >= offset) return `/${entry[1] === "faults" ? "faults" : "scheduledFaults"}/${index - offset}${entry[3] ?? ""}`;
    }
    return targets.find(target => path === target.path || path.startsWith(`${target.path}/`))?.overlay;
  };
}

function sortDiagnostics(found: readonly ScenarioDiagnostic[]): readonly ScenarioDiagnostic[] {
  const sorted = [...found].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
  return Object.freeze(sorted.filter((item, index) => index === 0 || item.path !== sorted[index - 1]!.path || item.code !== sorted[index - 1]!.code)
    .map(item => Object.freeze({ path: item.path, code: item.code })));
}

function record(value: CanonicalValue | undefined, path: string, allowed: readonly string[], push: Push, open = false, required = false): Doc | undefined {
  if (value === undefined && required) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) { push(path || "/", DiagnosticCodes.TYPE); return undefined; }
  if (!open) for (const key of Object.keys(value)) if (!allowed.includes(key)) push(`${path}/${escape(key)}`, DiagnosticCodes.UNSUPPORTED);
  return value as Doc;
}

function list(value: CanonicalValue | undefined, path: string, push: Push): CanonicalValue[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { push(path, DiagnosticCodes.TYPE); return undefined; }
  return value as CanonicalValue[];
}

function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Canonical identity of a normalized overlay, for equality checks in tools and tests. */
export function overlayKey(overlay: SessionOverlay): string {
  return canonicalEncode(canonicalCopy(overlay));
}

