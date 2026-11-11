import type {
  CatalogReference,
  LessonArchitectureAllowance,
  LessonOverlayPolicy,
  LessonParameter,
  ScenarioDiagnostic,
  ScenarioDocument,
  ScenarioDocumentPresentation,
} from "@distlab/contracts";
import { SCENARIO_DOCUMENT_FORMAT, STUDENT_ID_PREFIX, ScenarioDocumentDiagnosticCodes, ScenarioDocumentLimits } from "@distlab/contracts";
import type { CanonicalValue } from "@distlab/contracts/kernel";
import { canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { DiagnosticCodes, type ScenarioAssessment, type ScenarioCatalog } from "./types.js";
import { normalizeScenario } from "./validate.js";
import { composeOverlay, resolveTarget } from "./overlay.js";
import { valueInDomain } from "./architecture-edits.js";

/**
 * Scenario documents (ADR-006). Pure functions of the document text and the
 * hosted catalog registry: nothing here creates a model, allocates a
 * simulation identity, or draws randomness. Only the worker composition root
 * and headless tools call this module.
 */

/** A model catalog paired with the assessment the worker uses with it. Its reference is the catalog's own `id` and `version`. */
export interface HostedCatalog {
  readonly catalog: ScenarioCatalog;
  readonly assessment: ScenarioAssessment;
}

/** What validation needs from the host: the hosted catalogs and the packaged scenario names an imported document may not reuse. */
export interface HostedCatalogRegistry {
  readonly catalogs: readonly HostedCatalog[];
  readonly reservedNames: readonly string[];
}

/** Envelope versions this layer accepts (ADR-006 "Versioning and compatibility"). */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = Object.freeze([1]);

export type DocumentStage = "text" | "envelope" | "scenario" | "policy";

export type DocumentValidation =
  | {
    readonly ok: true;
    /** The normalized document: the scenario as the engine normalizes it, and only the envelope members present. */
    readonly document: ScenarioDocument;
    /** `document.scenario` as a canonical value, ready for `ScenarioEngine.create` and overlay composition. */
    readonly scenario: CanonicalValue;
    /** SHA-256 of the canonical encoding of the parsed document value. */
    readonly digest: string;
    readonly hosted: HostedCatalog;
  }
  | {
    readonly ok: false;
    /** The first stage that failed; later stages did not run. */
    readonly stage: DocumentStage;
    /** Document-relative JSON pointers, sorted by path, then code. */
    readonly diagnostics: readonly ScenarioDiagnostic[];
  };

type Doc = Record<string, CanonicalValue>;
type Push = (path: string, code: string) => void;
const Codes = ScenarioDocumentDiagnosticCodes;
const Limits = ScenarioDocumentLimits;

/**
 * Validates a scenario document in stages and stops at the first stage that
 * fails: text, envelope, scenario, then overlay policy. Each stage reports all
 * of its diagnostics.
 */
export function validateScenarioDocument(text: string, registry: HostedCatalogRegistry): DocumentValidation {
  const parsed = parseDocumentText(text);
  if (!parsed.value) return { ok: false, stage: "text", diagnostics: parsed.diagnostics };
  const root = parsed.value;

  const envelope = checkEnvelope(root, registry);
  if (!envelope.hosted) return { ok: false, stage: "envelope", diagnostics: envelope.diagnostics };
  const hosted = envelope.hosted;
  const document = root as Doc;

  const checked = checkScenario(document, hosted, registry);
  if (!checked.scenario) return { ok: false, stage: "scenario", diagnostics: checked.diagnostics };
  const scenario = canonicalCopy(checked.scenario);

  const policy = document.overlayPolicy as unknown as LessonOverlayPolicy | undefined;
  if (policy) {
    const diagnostics = checkPolicy(policy, scenario, hosted);
    if (diagnostics.length) return { ok: false, stage: "policy", diagnostics };
  }

  const presentation = document.presentation as Doc;
  const normalized: ScenarioDocument = Object.freeze({
    format: SCENARIO_DOCUMENT_FORMAT,
    formatVersion: 1,
    catalog: Object.freeze({ id: hosted.catalog.id, version: hosted.catalog.version }),
    presentation: Object.freeze({
      title: presentation.title as string,
      ...(presentation.summary !== undefined ? { summary: presentation.summary as string } : {}),
      ...(presentation.assertions !== undefined ? { assertions: presentation.assertions as unknown as Readonly<Record<string, string>> } : {}),
    } satisfies ScenarioDocumentPresentation),
    scenario: checked.scenario,
    ...(policy ? { overlayPolicy: policy } : {}),
  });
  return { ok: true, document: normalized, scenario, digest: documentDigest(root), hosted };
}

/** SHA-256 of the canonical encoding of a parsed document value: whitespace and key order do not change it. */
export function documentDigest(value: CanonicalValue): string {
  return sha256Hex(canonicalEncode(value));
}

/** Looks up a reference in the registry. `UNKNOWN_CATALOG` and `CATALOG_VERSION` are distinct outcomes. */
export function resolveHostedCatalog(registry: HostedCatalogRegistry, reference: CatalogReference): HostedCatalog | typeof Codes.UNKNOWN_CATALOG | typeof Codes.CATALOG_VERSION {
  const known = registry.catalogs.filter(item => item.catalog.id === reference.id);
  if (!known.length) return Codes.UNKNOWN_CATALOG;
  return known.find(item => item.catalog.version === reference.version) ?? Codes.CATALOG_VERSION;
}

// --- Stage 2: text ----------------------------------------------------------------------

export interface DocumentParse {
  /** Present only when `diagnostics` is empty. */
  readonly value?: CanonicalValue;
  readonly diagnostics: readonly ScenarioDiagnostic[];
}

/**
 * Strict RFC 8259 parsing. The byte limit is checked before any character is
 * parsed. Duplicate keys, the `__proto__` key, and nesting deeper than the
 * limit are reported at their JSON pointers; a syntax error is one
 * diagnostic at `""`. The parser is iterative, so a deeply nested text cannot
 * exhaust the call stack.
 */
export function parseDocumentText(text: string): DocumentParse {
  if (typeof text !== "string") return failure([{ path: "", code: DiagnosticCodes.TYPE }]);
  if (utf8Exceeds(text, Limits.documentBytes)) return failure([{ path: "", code: Codes.DOCUMENT_SIZE }]);
  try {
    const { value, diagnostics } = new Parser(text).parse();
    return diagnostics.length ? failure(diagnostics) : { value: canonicalCopy(value), diagnostics: Object.freeze([]) };
  } catch (error) {
    if (error instanceof SyntaxFailure) return failure([{ path: "", code: Codes.DOCUMENT_SYNTAX }]);
    throw error;
  }
}

/** True when the UTF-8 encoding of `text` is longer than `limit` bytes. Stops counting at the limit. */
function utf8Exceeds(text: string, limit: number): boolean {
  if (text.length > limit) return true;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) { bytes += 4; index += 1; }
    else bytes += 3; // A lone surrogate encodes as U+FFFD.
    if (bytes > limit) return true;
  }
  return false;
}

class SyntaxFailure extends Error {}

type Frame =
  | { readonly array: true; readonly items: CanonicalValue[] }
  | { readonly array: false; readonly entries: Record<string, CanonicalValue>; readonly seen: Set<string>; key: string | undefined };

const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const escapes: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class Parser {
  readonly #text: string;
  #index = 0;
  /** Reference tokens of the value being read. */
  readonly #path: string[] = [];
  readonly #stack: Frame[] = [];
  readonly #diagnostics: ScenarioDiagnostic[] = [];

  constructor(text: string) { this.#text = text; }

  parse(): { value: CanonicalValue; diagnostics: readonly ScenarioDiagnostic[] } {
    let value = this.#value();
    for (;;) {
      const frame = this.#stack.at(-1);
      if (!frame) break;
      if (frame.array) {
        frame.items.push(value);
        const next = this.#next();
        if (next === ",") { this.#path[this.#path.length - 1] = String(frame.items.length); value = this.#value(); continue; }
        if (next !== "]") throw new SyntaxFailure();
        value = this.#close();
      } else {
        if (frame.key !== undefined) frame.entries[frame.key] = value;
        const next = this.#next();
        if (next === ",") { this.#key(frame); value = this.#value(); continue; }
        if (next !== "}") throw new SyntaxFailure();
        value = this.#close();
      }
    }
    this.#whitespace();
    if (this.#index !== this.#text.length) throw new SyntaxFailure();
    return { value, diagnostics: this.#diagnostics };
  }

  /** Reads one value. A container is opened and its first member read; the loop in `parse` completes it. */
  #value(): CanonicalValue {
    for (;;) {
      this.#whitespace();
      const char = this.#text[this.#index];
      if (char === "{" || char === "[") {
        this.#index += 1;
        // The root container is depth 1. Only the outermost container past the limit is reported.
        if (this.#stack.length === Limits.nestingDepth) this.#report(Codes.DOCUMENT_DEPTH);
        if (char === "[") {
          this.#stack.push({ array: true, items: [] });
          this.#path.push("0");
          this.#whitespace();
          if (this.#text[this.#index] === "]") { this.#index += 1; return this.#close(); }
          continue;
        }
        const frame: Frame = { array: false, entries: Object.create(null) as Record<string, CanonicalValue>, seen: new Set(), key: undefined };
        this.#stack.push(frame);
        this.#path.push("");
        this.#whitespace();
        if (this.#text[this.#index] === "}") { this.#index += 1; return this.#close(); }
        this.#key(frame);
        continue;
      }
      if (char === '"') return this.#string();
      if (char === "t" && this.#text.startsWith("true", this.#index)) { this.#index += 4; return true; }
      if (char === "f" && this.#text.startsWith("false", this.#index)) { this.#index += 5; return false; }
      if (char === "n" && this.#text.startsWith("null", this.#index)) { this.#index += 4; return null; }
      numberPattern.lastIndex = this.#index;
      const match = numberPattern.exec(this.#text);
      if (!match) throw new SyntaxFailure();
      this.#index += match[0].length;
      const number = Number(match[0]);
      if (!Number.isFinite(number)) throw new SyntaxFailure();
      return number === 0 ? 0 : number; // -0 is not canonical.
    }
  }

  /** Reads `"key":` and records it as the current path token. */
  #key(frame: Extract<Frame, { array: false }>): void {
    this.#whitespace();
    if (this.#text[this.#index] !== '"') throw new SyntaxFailure();
    const key = this.#string();
    if (this.#next() !== ":") throw new SyntaxFailure();
    this.#path[this.#path.length - 1] = key;
    frame.key = undefined;
    if (key === "__proto__") this.#report(Codes.RESERVED_KEY);
    else if (frame.seen.has(key)) this.#report(Codes.DUPLICATE_KEY);
    else { frame.seen.add(key); frame.key = key; }
  }

  #close(): CanonicalValue {
    const frame = this.#stack.pop()!;
    this.#path.pop();
    return frame.array ? frame.items : frame.entries;
  }

  #string(): string {
    const text = this.#text;
    let index = this.#index + 1;
    let start = index;
    let result = "";
    for (;;) {
      if (index >= text.length) throw new SyntaxFailure();
      const unit = text.charCodeAt(index);
      if (unit === 0x22) { result += text.slice(start, index); this.#index = index + 1; return result; }
      if (unit < 0x20) throw new SyntaxFailure();
      if (unit !== 0x5c) { index += 1; continue; }
      result += text.slice(start, index);
      const escape = text[index + 1];
      if (escape === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxFailure();
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
      } else {
        const decoded = escape === undefined ? undefined : escapes[escape];
        if (decoded === undefined) throw new SyntaxFailure();
        result += decoded;
        index += 2;
      }
      start = index;
    }
  }

  #next(): string | undefined {
    this.#whitespace();
    const char = this.#text[this.#index];
    this.#index += 1;
    return char;
  }

  #whitespace(): void {
    const text = this.#text;
    while (this.#index < text.length) {
      const char = text[this.#index];
      if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") return;
      this.#index += 1;
    }
  }

  #report(code: string): void {
    this.#diagnostics.push({ path: pointer(this.#path), code });
  }
}

// --- Stage 3: envelope ------------------------------------------------------------------

const envelopeKeys = ["format", "formatVersion", "catalog", "presentation", "scenario", "overlayPolicy"];
const catalogKeys = ["id", "version"];
const presentationKeys = ["title", "summary", "assertions"];
const policyKeys = ["version", "lesson", "faults", "parameters", "architecture"];
const faultAllowanceKeys = ["rules", "scheduled", "maxEntries"];
const ruleAllowanceKeys = ["point", "effects"];
const parameterKeys = ["key", "domain", "targets"];
const domainKeys: Readonly<Record<string, readonly string[]>> = {
  boolean: ["type", "default"],
  integer: ["type", "default", "minimum", "maximum"],
  choice: ["type", "default", "choices"],
};
const targetKeys: Readonly<Record<string, readonly string[]>> = {
  component: ["kind", "component", "field"],
  link: ["kind", "source", "target", "field"],
  destination: ["kind", "destination", "field"],
  action: ["kind", "action", "field"],
};
const allowanceKeys = ["slots", "bindings", "resources", "subscriptions", "linkPolicy", "maxEdits"];
const linkPolicyKeys = ["requestLatency", "responseLatency", "jitter", "timeout", "failureRate"];
const faultPoints = ["network.request", "network.response", "message.delivery", "database.commit"];
const effectKinds = ["delay", "drop", "fail", "duplicate", "disconnect"];
const scheduledKinds = ["crash", "external-availability"];
const destinationFields = ["deliveryDelay", "ackTimeout", "retryDelay", "maxAttempts", "capacity"];

interface EnvelopeCheck {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  /** Present only when `diagnostics` is empty. */
  readonly hosted?: HostedCatalog;
}

/**
 * `format`, `formatVersion`, required members and their types, unknown keys at
 * every envelope level, presentation lengths, the overlay policy's shape, and
 * the catalog reference. A wrong `format` or an unsupported `formatVersion`
 * stops the stage, because the rest of the envelope cannot be read.
 */
function checkEnvelope(value: CanonicalValue, registry: HostedCatalogRegistry): EnvelopeCheck {
  const found: ScenarioDiagnostic[] = [];
  const push: Push = (path, code) => { found.push({ path, code }); };
  const done = (hosted?: HostedCatalog): EnvelopeCheck => {
    const diagnostics = sortDiagnostics(found);
    return diagnostics.length === 0 && hosted ? { diagnostics, hosted } : { diagnostics };
  };
  if (!isRecord(value)) { push("", DiagnosticCodes.TYPE); return done(); }
  const root = value;
  if (root.format === undefined) push("/format", DiagnosticCodes.REQUIRED);
  else if (root.format !== SCENARIO_DOCUMENT_FORMAT) push("/format", Codes.FORMAT);
  if (root.formatVersion === undefined) push("/formatVersion", DiagnosticCodes.REQUIRED);
  else if (typeof root.formatVersion !== "number") push("/formatVersion", DiagnosticCodes.TYPE);
  else if (!SUPPORTED_FORMAT_VERSIONS.includes(root.formatVersion)) push("/formatVersion", Codes.FORMAT_VERSION);
  if (found.length) return done();

  unknownKeys(root, "", envelopeKeys, push);
  const presentation = member(root, "presentation", "", push);
  if (presentation) checkPresentation(presentation, push);
  if (root.scenario === undefined) push("/scenario", DiagnosticCodes.REQUIRED);
  else if (!isRecord(root.scenario)) push("/scenario", DiagnosticCodes.TYPE);
  if (root.overlayPolicy !== undefined) checkPolicyShape(root.overlayPolicy, "/overlayPolicy", push);

  const catalog = member(root, "catalog", "", push);
  let hosted: HostedCatalog | undefined;
  if (catalog) {
    unknownKeys(catalog, "/catalog", catalogKeys, push);
    const id = string(catalog.id, "/catalog/id", push);
    const version = string(catalog.version, "/catalog/version", push);
    if (id !== undefined && version !== undefined) {
      const resolved = resolveHostedCatalog(registry, { id, version });
      if (resolved === Codes.UNKNOWN_CATALOG) push("/catalog/id", Codes.UNKNOWN_CATALOG);
      else if (resolved === Codes.CATALOG_VERSION) push("/catalog/version", Codes.CATALOG_VERSION);
      else hosted = resolved;
    }
  }
  return done(hosted);
}

function checkPresentation(presentation: Doc, push: Push): void {
  unknownKeys(presentation, "/presentation", presentationKeys, push);
  const title = string(presentation.title, "/presentation/title", push);
  if (title !== undefined && characters(title) > Limits.titleLength) push("/presentation/title", Codes.DOCUMENT_LIMIT);
  if (presentation.summary !== undefined) {
    const summary = string(presentation.summary, "/presentation/summary", push);
    if (summary !== undefined && characters(summary) > Limits.summaryLength) push("/presentation/summary", Codes.DOCUMENT_LIMIT);
  }
  if (presentation.assertions === undefined) return;
  if (!isRecord(presentation.assertions)) { push("/presentation/assertions", DiagnosticCodes.TYPE); return; }
  for (const [id, label] of Object.entries(presentation.assertions)) {
    const path = `/presentation/assertions/${escape(id)}`;
    const text = string(label, path, push);
    if (text !== undefined && characters(text) > Limits.assertionLabelLength) push(path, Codes.DOCUMENT_LIMIT);
  }
}

/** The `LessonOverlayPolicy` shape. Whether it fits the scenario is stage 5. */
function checkPolicyShape(value: CanonicalValue, path: string, push: Push): void {
  if (!isRecord(value)) { push(path, DiagnosticCodes.TYPE); return; }
  unknownKeys(value, path, policyKeys, push);
  if (value.version === undefined) push(`${path}/version`, DiagnosticCodes.REQUIRED);
  else if (value.version !== 1) push(`${path}/version`, DiagnosticCodes.VERSION);
  string(value.lesson, `${path}/lesson`, push);

  const faults = member(value, "faults", path, push);
  if (faults) {
    const base = `${path}/faults`;
    unknownKeys(faults, base, faultAllowanceKeys, push);
    const points = new Set<string>();
    each(faults.rules, `${base}/rules`, push, (rule, rulePath) => {
      if (!isRecord(rule)) { push(rulePath, DiagnosticCodes.TYPE); return; }
      unknownKeys(rule, rulePath, ruleAllowanceKeys, push);
      const point = choice(rule.point, `${rulePath}/point`, faultPoints, push);
      if (point !== undefined) {
        if (points.has(point)) push(`${rulePath}/point`, DiagnosticCodes.DUPLICATE);
        points.add(point);
      }
      each(rule.effects, `${rulePath}/effects`, push, (effect, effectPath) => { choice(effect, effectPath, effectKinds, push); });
    });
    each(faults.scheduled, `${base}/scheduled`, push, (kind, kindPath) => { choice(kind, kindPath, scheduledKinds, push); });
    count(faults.maxEntries, `${base}/maxEntries`, push);
  }

  const keys = new Set<string>();
  each(value.parameters, `${path}/parameters`, push, (parameter, parameterPath) => {
    if (!isRecord(parameter)) { push(parameterPath, DiagnosticCodes.TYPE); return; }
    unknownKeys(parameter, parameterPath, parameterKeys, push);
    const key = string(parameter.key, `${parameterPath}/key`, push, true);
    if (key !== undefined) {
      if (keys.has(key)) push(`${parameterPath}/key`, DiagnosticCodes.DUPLICATE);
      keys.add(key);
    }
    const domain = member(parameter, "domain", parameterPath, push);
    if (domain) {
      const domainPath = `${parameterPath}/domain`;
      const type = choice(domain.type, `${domainPath}/type`, Object.keys(domainKeys), push);
      if (type !== undefined) {
        unknownKeys(domain, domainPath, domainKeys[type]!, push);
        if (domain.default === undefined) push(`${domainPath}/default`, DiagnosticCodes.REQUIRED);
        if (type === "integer") {
          integer(domain.minimum, `${domainPath}/minimum`, push);
          integer(domain.maximum, `${domainPath}/maximum`, push);
        }
        if (type === "choice") each(domain.choices, `${domainPath}/choices`, push, (item, itemPath) => { string(item, itemPath, push, true); });
      }
    }
    each(parameter.targets, `${parameterPath}/targets`, push, (target, targetPath) => {
      if (!isRecord(target)) { push(targetPath, DiagnosticCodes.TYPE); return; }
      const kind = choice(target.kind, `${targetPath}/kind`, Object.keys(targetKeys), push);
      if (kind === undefined) return;
      const fields = targetKeys[kind]!;
      unknownKeys(target, targetPath, fields, push);
      for (const field of fields.slice(1)) string(target[field], `${targetPath}/${field}`, push, true);
    });
  });

  if (value.architecture !== undefined) checkAllowanceShape(value.architecture, `${path}/architecture`, push);
}

function checkAllowanceShape(value: CanonicalValue, path: string, push: Push): void {
  if (!isRecord(value)) { push(path, DiagnosticCodes.TYPE); return; }
  unknownKeys(value, path, allowanceKeys, push);
  const entries = (name: string, keys: readonly string[], read: (item: Doc, itemPath: string) => void) =>
    each(value[name], `${path}/${name}`, push, (item, itemPath) => {
      if (!isRecord(item)) { push(itemPath, DiagnosticCodes.TYPE); return; }
      unknownKeys(item, itemPath, keys, push);
      read(item, itemPath);
    });
  entries("slots", ["component", "models"], (slot, slotPath) => {
    string(slot.component, `${slotPath}/component`, push, true);
    each(slot.models, `${slotPath}/models`, push, (model, modelPath) => {
      if (!isRecord(model)) { push(modelPath, DiagnosticCodes.TYPE); return; }
      unknownKeys(model, modelPath, ["model", "version"], push);
      string(model.model, `${modelPath}/model`, push, true);
      string(model.version, `${modelPath}/version`, push, true);
    });
  });
  entries("bindings", ["component", "peer", "candidates"], (binding, bindingPath) => {
    string(binding.component, `${bindingPath}/component`, push, true);
    string(binding.peer, `${bindingPath}/peer`, push, true);
    each(binding.candidates, `${bindingPath}/candidates`, push, (item, itemPath) => { string(item, itemPath, push, true); });
  });
  entries("resources", ["owner", "resource"], (resource, resourcePath) => {
    string(resource.owner, `${resourcePath}/owner`, push, true);
    choice(resource.resource, `${resourcePath}/resource`, ["database", "store"], push);
  });
  entries("subscriptions", ["consumer", "destination"], (subscription, subscriptionPath) => {
    string(subscription.consumer, `${subscriptionPath}/consumer`, push, true);
    string(subscription.destination, `${subscriptionPath}/destination`, push, true);
  });
  const linkPolicy = member(value, "linkPolicy", path, push);
  if (linkPolicy) {
    unknownKeys(linkPolicy, `${path}/linkPolicy`, linkPolicyKeys, push);
    for (const key of linkPolicyKeys) {
      const field = linkPolicy[key];
      if (field === undefined) push(`${path}/linkPolicy/${key}`, DiagnosticCodes.REQUIRED);
      else if (typeof field !== "number") push(`${path}/linkPolicy/${key}`, DiagnosticCodes.TYPE);
    }
  }
  count(value.maxEdits, `${path}/maxEdits`, push);
}

// --- Stage 4: scenario ------------------------------------------------------------------

interface ScenarioCheck {
  readonly diagnostics: readonly ScenarioDiagnostic[];
  readonly scenario?: ScenarioDocument["scenario"];
}

/**
 * Count and `historyLimit` limits, reserved names and IDs, the unchanged
 * engine validation under `/scenario`, and presentation labels that name an
 * existing assertion. The engine runs only when the limits hold, because the
 * limits bound validation time.
 */
function checkScenario(document: Doc, hosted: HostedCatalog, registry: HostedCatalogRegistry): ScenarioCheck {
  const found: ScenarioDiagnostic[] = [];
  const push: Push = (path, code) => { found.push({ path, code }); };
  const scenario = document.scenario as Doc;
  const architecture = isRecord(scenario.architecture) ? scenario.architecture : {};
  const configuration = isRecord(scenario.configuration) ? scenario.configuration : {};
  const limited: [CanonicalValue | undefined, string, number][] = [
    [architecture.components, "/scenario/architecture/components", Limits.components],
    [architecture.links, "/scenario/architecture/links", Limits.links],
    [scenario.actions, "/scenario/actions", Limits.actions],
    [scenario.faults, "/scenario/faults", Limits.faultRules],
    [scenario.assertions, "/scenario/assertions", Limits.assertions],
  ];
  for (const [items, path, limit] of limited) if (Array.isArray(items) && items.length > limit) push(path, Codes.DOCUMENT_LIMIT);
  if (typeof configuration.historyLimit === "number" && configuration.historyLimit > Limits.historyLimit) push("/scenario/configuration/historyLimit", Codes.DOCUMENT_LIMIT);
  const withinLimits = found.length === 0;

  if (typeof scenario.name === "string") {
    const name = scenario.name.trim().normalize("NFC");
    if (registry.reservedNames.some(reserved => reserved.trim().normalize("NFC") === name)) push("/scenario/name", Codes.RESERVED_NAME);
  }
  for (const [id, path] of scenarioIds(scenario)) if (id.startsWith(STUDENT_ID_PREFIX)) push(path, Codes.RESERVED_ID);

  const assertionIds = new Set(list(scenario.assertions).flatMap(item => isRecord(item) && typeof item.id === "string" ? [item.id] : []));
  const labels = (document.presentation as Doc).assertions;
  if (isRecord(labels)) for (const id of Object.keys(labels)) if (!assertionIds.has(id)) push(`/presentation/assertions/${escape(id)}`, DiagnosticCodes.REFERENCE);

  let normalized: ScenarioDocument["scenario"] | undefined;
  if (withinLimits) {
    const result = normalizeScenario(scenario, hosted.catalog, hosted.assessment);
    for (const item of result.diagnostics) push(`/scenario${item.path}`, item.code);
    normalized = result.scenario;
  }
  const diagnostics = sortDiagnostics(found);
  return diagnostics.length === 0 && normalized ? { diagnostics, scenario: normalized } : { diagnostics };
}

/** Every ID a document declares, with its path. No ID may use the student prefix (ADR-004 provenance). */
function scenarioIds(scenario: Doc): [string, string][] {
  const architecture = isRecord(scenario.architecture) ? scenario.architecture : {};
  const ids: [string, string][] = [];
  const collect = (items: CanonicalValue | undefined, path: string, read: (item: Doc, itemPath: string) => void) =>
    list(items).forEach((item, index) => { if (isRecord(item)) read(item, `${path}/${index}`); });
  const id = (item: Doc, path: string) => { if (typeof item.id === "string") ids.push([item.id, `${path}/id`]); };
  collect(architecture.components, "/scenario/architecture/components", id);
  collect(architecture.destinations, "/scenario/architecture/destinations", id);
  collect(scenario.faults, "/scenario/faults", id);
  collect(scenario.assertions, "/scenario/assertions", id);
  collect(scenario.actions, "/scenario/actions", (action, path) => {
    id(action, path);
    if (isRecord(action.fault)) id(action.fault, `${path}/fault`);
  });
  return ids;
}

// --- Stage 5: overlay policy ------------------------------------------------------------

/**
 * ADR-004's OVL-AC-6 policy integrity and, with an architecture allowance,
 * ADR-005's ARCH-AC-6 allowance integrity, run against the normalized
 * scenario the policy governs.
 */
function checkPolicy(policy: LessonOverlayPolicy, scenario: CanonicalValue, hosted: HostedCatalog): readonly ScenarioDiagnostic[] {
  const found: ScenarioDiagnostic[] = [];
  const push: Push = (path, code) => { found.push({ path, code }); };
  const base = "/overlayPolicy";
  if (policy.lesson !== (scenario as Doc).name) push(`${base}/lesson`, DiagnosticCodes.REFERENCE);

  const allowance = policy.architecture;
  const slots = new Set(allowance?.slots.map(slot => slot.component) ?? []);
  const owned = new Set<string>();
  policy.parameters.forEach((parameter, index) => {
    const path = `${base}/parameters/${index}`;
    if (!parameter.targets.length) push(`${path}/targets`, Codes.POLICY_TARGET);
    if (!valueInDomain(parameter.domain.default as CanonicalValue, parameter.domain)) push(`${path}/domain/default`, Codes.POLICY_DEFAULT);
    parameter.targets.forEach((target, targetIndex) => {
      const targetPath = `${path}/targets/${targetIndex}`;
      if (!targetFieldAllowed(target)) { push(targetPath, Codes.POLICY_TARGET); return; }
      if (target.kind === "component" && slots.has(target.component)) push(targetPath, Codes.POLICY_ALLOWANCE);
      const location = resolveTarget(scenario, target);
      if (!location || location.count !== 1) { push(targetPath, Codes.POLICY_TARGET); return; }
      if (owned.has(location.path)) push(targetPath, Codes.POLICY_TARGET);
      owned.add(location.path);
      if (canonicalEncode(location.container[location.field]!) !== canonicalEncode(parameter.domain.default as CanonicalValue)) push(targetPath, Codes.POLICY_DEFAULT);
    });
  });

  if (allowance) checkAllowance(policy, allowance, scenario, hosted, push);
  return sortDiagnostics(found);
}

function targetFieldAllowed(target: LessonParameter["targets"][number]): boolean {
  if (target.kind === "link") return linkPolicyKeys.includes(target.field);
  if (target.kind === "destination") return destinationFields.includes(target.field);
  return true;
}

function checkAllowance(policy: LessonOverlayPolicy, allowance: LessonArchitectureAllowance, scenario: CanonicalValue, hosted: HostedCatalog, push: Push): void {
  const base = "/overlayPolicy/architecture";
  const architecture = (scenario as Doc).architecture as Doc;
  const components = new Map(list(architecture.components).map(item => [(item as Doc).id as string, item as Doc]));
  const destinations = new Set(list(architecture.destinations).map(item => (item as Doc).id as string));
  const owners = (name: string) => new Set(list(architecture[name]).map(item => (item as Doc).owner as string));
  const databases = owners("databases");
  const stores = owners("stores");
  const subscribed = new Set(list(architecture.subscriptions).map(item => `${(item as Doc).consumer as string}\u0000${(item as Doc).destination as string}`));
  const engine = { validate: (value: CanonicalValue) => normalizeScenario(value, hosted.catalog, hosted.assessment).diagnostics };

  allowance.slots.forEach((slot, index) => {
    const path = `${base}/slots/${index}`;
    const component = components.get(slot.component);
    if (!component) { push(`${path}/component`, Codes.POLICY_ALLOWANCE); return; }
    slot.models.forEach(({ model, version }, modelIndex) => {
      const modelPath = `${path}/models/${modelIndex}`;
      const descriptor = hosted.catalog.find(model, version);
      if (!descriptor || descriptor.kind !== component.kind) { push(modelPath, Codes.POLICY_ALLOWANCE); return; }
      const fields = [...descriptor.peers.map(peer => peer.name), ...descriptor.options.map(option => option.key)];
      if (new Set(fields).size !== fields.length) { push(modelPath, Codes.POLICY_ALLOWANCE); return; }
      // A slot edit replaces the configuration with options, so a model with lesson data cannot fill a slot (#122).
      if (descriptor.lessonData?.length) { push(modelPath, Codes.POLICY_ALLOWANCE); return; }
      // The model substituted alone, completed with the resource and subscription edits its descriptor needs and the allowance offers.
      const resources = allowance.resources.filter(item => item.owner === slot.component
        && ((item.resource === "database" && descriptor.storage.database && !databases.has(item.owner))
          || (item.resource === "store" && descriptor.storage.store && !stores.has(item.owner))))
        .map(item => ({ owner: item.owner, resource: item.resource, change: "attach" }));
      const subscriptions = allowance.subscriptions.filter(item => item.consumer === slot.component && descriptor.consumers.includes(item.destination)
        && !subscribed.has(`${item.consumer}\u0000${item.destination}`))
        .map(item => ({ consumer: item.consumer, destination: item.destination, change: "subscribe" }));
      const overlay = { version: 1, architecture: { slots: [{ component: slot.component, model, version, options: [] }], resources, subscriptions } };
      const composed = composeOverlay(scenario, policy, overlay as unknown as CanonicalValue, value => engine.validate(value), hosted.catalog);
      if (!composed.ok) push(modelPath, Codes.POLICY_ALLOWANCE);
    });
  });
  allowance.bindings.forEach((binding, index) => {
    const path = `${base}/bindings/${index}`;
    if (!components.has(binding.component)) push(`${path}/component`, Codes.POLICY_ALLOWANCE);
    binding.candidates.forEach((candidate, candidateIndex) => {
      if (!components.has(candidate)) push(`${path}/candidates/${candidateIndex}`, Codes.POLICY_ALLOWANCE);
    });
  });
  allowance.resources.forEach((resource, index) => {
    if (components.get(resource.owner)?.kind !== "service") push(`${base}/resources/${index}/owner`, Codes.POLICY_ALLOWANCE);
  });
  allowance.subscriptions.forEach((subscription, index) => {
    const path = `${base}/subscriptions/${index}`;
    if (components.get(subscription.consumer)?.kind !== "service") push(`${path}/consumer`, Codes.POLICY_ALLOWANCE);
    if (!destinations.has(subscription.destination)) push(`${path}/destination`, Codes.POLICY_ALLOWANCE);
  });
}

// --- Helpers ----------------------------------------------------------------------------

function isRecord(value: CanonicalValue | undefined): value is Doc {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value: CanonicalValue | undefined): readonly CanonicalValue[] {
  return Array.isArray(value) ? value : [];
}

function unknownKeys(value: Doc, path: string, allowed: readonly string[], push: Push): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) push(`${path}/${escape(key)}`, DiagnosticCodes.UNSUPPORTED);
}

/** A required object member. */
function member(value: Doc, key: string, path: string, push: Push): Doc | undefined {
  const item = value[key];
  if (item === undefined) { push(`${path}/${key}`, DiagnosticCodes.REQUIRED); return undefined; }
  if (!isRecord(item)) { push(`${path}/${key}`, DiagnosticCodes.TYPE); return undefined; }
  return item;
}

function string(value: CanonicalValue | undefined, path: string, push: Push, nonEmpty = false): string | undefined {
  if (value === undefined) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  if (typeof value !== "string") { push(path, DiagnosticCodes.TYPE); return undefined; }
  if (nonEmpty && value.length === 0) { push(path, DiagnosticCodes.REQUIRED); return undefined; }
  return value;
}

/** A string from a closed set. A value outside the set uses the overlay layer's `FAULT` for fault vocabulary and `TYPE` otherwise. */
function choice(value: CanonicalValue | undefined, path: string, choices: readonly string[], push: Push): string | undefined {
  const text = string(value, path, push);
  if (text === undefined) return undefined;
  if (!choices.includes(text)) { push(path, choices === faultPoints || choices === effectKinds || choices === scheduledKinds ? DiagnosticCodes.FAULT : DiagnosticCodes.TYPE); return undefined; }
  return text;
}

function integer(value: CanonicalValue | undefined, path: string, push: Push): void {
  if (value === undefined) push(path, DiagnosticCodes.REQUIRED);
  else if (typeof value !== "number" || !Number.isSafeInteger(value)) push(path, DiagnosticCodes.TYPE);
}

function count(value: CanonicalValue | undefined, path: string, push: Push): void {
  integer(value, path, push);
  if (typeof value === "number" && Number.isSafeInteger(value) && value < 0) push(path, DiagnosticCodes.TYPE);
}

/** A required array; `read` sees each item and its path. */
function each(value: CanonicalValue | undefined, path: string, push: Push, read: (item: CanonicalValue, path: string) => void): void {
  if (value === undefined) { push(path, DiagnosticCodes.REQUIRED); return; }
  if (!Array.isArray(value)) { push(path, DiagnosticCodes.TYPE); return; }
  value.forEach((item, index) => read(item, `${path}/${index}`));
}

/** Unicode code points, so a label's limit does not depend on UTF-16 surrogate pairs. */
function characters(text: string): number {
  return [...text].length;
}

function pointer(tokens: readonly string[]): string {
  return tokens.map(token => `/${escape(token)}`).join("");
}

function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function failure(diagnostics: readonly ScenarioDiagnostic[]): DocumentParse {
  return { diagnostics: sortDiagnostics(diagnostics) };
}

function sortDiagnostics(found: readonly ScenarioDiagnostic[]): readonly ScenarioDiagnostic[] {
  const sorted = [...found].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
  return Object.freeze(sorted.filter((item, index) => index === 0 || item.path !== sorted[index - 1]!.path || item.code !== sorted[index - 1]!.code)
    .map(item => Object.freeze({ path: item.path, code: item.code })));
}
