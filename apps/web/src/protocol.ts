import type { ApplicationError, CanonicalValue, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const oneOf = (value: unknown, values: readonly string[]): boolean => typeof value === "string" && values.includes(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const keys = (value: RecordValue, required: string[], optional: string[] = []): boolean =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

/** Transport validation only: reject capabilities, accessors, cycles and noncanonical data. */
export function isCanonical(value: unknown, active = new Set<object>()): value is CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object" || active.has(value)) return false;
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array && Object.keys(descriptors).length !== value.length + 1) return false;
    return Reflect.ownKeys(descriptors).every(key => {
      if (array && key === "length") return true;
      if (typeof key !== "string" || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) return false;
      const item = descriptors[key]!;
      return item.enumerable && "value" in item && isCanonical(item.value, active);
    });
  } finally { active.delete(value); }
}

/** Structured cloning removes identity; freezing is repeated after every receive. */
export function detached<T>(value: T): T {
  if (!isCanonical(value)) throw new TypeError("Noncanonical transport value");
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

export function isWorkerCommand(value: unknown): value is WorkerCommand {
  if (!isCanonical(value) || !record(value) || value.version !== 1 || !text(value.requestId)) return false;
  const base = ["version", "requestId", "type"];
  switch (value.type) {
    case "load": return keys(value, [...base, "scenario"]);
    case "run": return keys(value, base, ["maxEvents"]) && (!Object.hasOwn(value, "maxEvents") || count(value.maxEvents));
    case "pause": case "step": case "reset": return keys(value, base);
    default: return false;
  }
}

function isProjection(value: unknown): value is RuntimeProjectionSet {
  if (!record(value) || !keys(value, ["architecture", "simulation", "history", "components"])) return false;
  const { architecture, simulation, history, components } = value;
  if (!record(architecture) || !keys(architecture, ["components", "links"]) || !Array.isArray(architecture.components) || !Array.isArray(architecture.links)) return false;
  if (!architecture.components.every(node => record(node) && keys(node, ["id", "kind", "label"], ["model", "version"])
    && text(node.id) && oneOf(node.kind, ["client", "service", "external", "infrastructure"]) && typeof node.label === "string"
    && (!Object.hasOwn(node, "model") || text(node.model)) && (!Object.hasOwn(node, "version") || text(node.version)))) return false;
  if (!architecture.links.every(link => record(link) && keys(link, ["source", "target"], ["label"]) && text(link.source) && text(link.target)
    && (!Object.hasOwn(link, "label") || typeof link.label === "string"))) return false;
  if (!record(simulation) || !keys(simulation, ["runId", "status", "time", "pendingEvents", "processedEvents", "randomDrawCount"])
    || !text(simulation.runId) || !oneOf(simulation.status, ["READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED"])
    || ![simulation.time, simulation.pendingEvents, simulation.processedEvents, simulation.randomDrawCount].every(count)) return false;
  if (!record(history) || !keys(history, ["observations"]) || !Array.isArray(history.observations)) return false;
  if (!history.observations.every(item => {
    if (!record(item) || !keys(item, ["schemaVersion", "id", "time", "sequence", "type", "source"],
      ["target", "traceId", "spanId", "parentSpanId", "causationId", "eventId", "entityRefs", "data"])) return false;
    return item.schemaVersion === 1 && text(item.id) && count(item.time) && count(item.sequence) && text(item.type) && text(item.source)
      && ["target", "traceId", "spanId", "parentSpanId", "causationId", "eventId"].every(key => !Object.hasOwn(item, key) || text(item[key]))
      && (!Object.hasOwn(item, "entityRefs") || (Array.isArray(item.entityRefs) && item.entityRefs.every(ref => record(ref) && keys(ref, ["kind", "id"]) && text(ref.kind) && text(ref.id))));
  })) return false;
  return Array.isArray(components) && components.every(item => record(item) && keys(item, ["componentId", "state", "visibility"])
    && text(item.componentId) && oneOf(item.visibility, ["student", "assessment", "host"]));
}

export function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (!isCanonical(value) || !record(value) || value.version !== 1) return false;
  if (value.type === "projection.updated") return keys(value, ["version", "type", "projection"], ["requestId"])
    && (!Object.hasOwn(value, "requestId") || text(value.requestId)) && isProjection(value.projection);
  if (!text(value.requestId)) return false;
  const base = ["version", "requestId", "type"];
  switch (value.type) {
    case "accepted": return keys(value, base);
    case "loaded": return keys(value, [...base, "projection"]) && isProjection(value.projection);
    case "run.finished": return keys(value, [...base, "status"]) && oneOf(value.status, ["PAUSED", "COMPLETED", "FAILED"]);
    case "error": return keys(value, [...base, "error"]) && record(value.error) && keys(value.error, ["code", "message", "context"]) && text(value.error.code) && typeof value.error.message === "string";
    default: return false;
  }
}

export function applicationError(code: string, message: string, context: CanonicalValue = null): ApplicationError {
  return detached({ code, message, context });
}

/** Invalid envelopes can still echo a usable correlation ID without invoking accessors. */
export function requestIdOf(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "";
}
