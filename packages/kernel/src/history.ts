import type { CanonicalValue, EntityRef, ExecutionHistoryExport, ExecutionHistoryReader, HistoryController, Observation, ObservationFilter, ObservationInput, ObservationListener, ObservationSink, RunId, SimulationTime, TerminalFailure, VisibilityMode, VisibilityPolicy } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";
import { DeterministicIdAllocator, isIdentifier } from "./identity.js";

export interface VirtualTimeSource { now(): SimulationTime; }
export interface ExecutionHistoryOptions {
  readonly runId: RunId;
  readonly clock: VirtualTimeSource;
  readonly historyLimit: number;
  readonly visibility: VisibilityPolicy;
}
type Schema = (data: CanonicalValue | undefined) => boolean;
type Registration = { listener: ObservationListener; active: boolean };

/** The concrete implementation behind the three kernel history capabilities. */
export class ExecutionHistory implements ObservationSink, ExecutionHistoryReader, HistoryController {
  readonly #runId: RunId;
  readonly #clock: VirtualTimeSource;
  readonly #limit: number;
  readonly #visibility: Readonly<{ defaultMode: VisibilityMode; byType: Readonly<Record<string, VisibilityMode>>; summaryFields: Readonly<Record<string, readonly string[]>> }>;
  readonly #ids: DeterministicIdAllocator;
  readonly #schemas = new Map<string, Schema>();
  readonly #records: readonly Observation[] = [];
  readonly #byId = new Map<string, Observation>();
  readonly #byType = new Map<string, Observation[]>();
  readonly #byComponent = new Map<string, Observation[]>();
  readonly #byTrace = new Map<string, Observation[]>();
  readonly #byEvent = new Map<string, Observation[]>();
  readonly #byEntity = new Map<string, Observation[]>();
  readonly #listeners: Registration[] = [];
  #pending: Observation[] = [];
  #delivering = false;
  #sealed?: TerminalFailure;

  constructor(options: ExecutionHistoryOptions) {
    if (!isIdentifier(options.runId) || !Number.isSafeInteger(options.historyLimit) || options.historyLimit <= 0) {
      throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason: "invalid history options" });
    }
    this.#runId = options.runId; this.#clock = options.clock; this.#limit = options.historyLimit;
    this.#visibility = normalizePolicy(options.visibility);
    this.#ids = new DeterministicIdAllocator("observation", options.runId);
  }

  registerSchema(type: string, validate: Schema): void {
    if (!validType(type) || typeof validate !== "function" || this.#schemas.has(type)) {
      throwSimulationError(ErrorCodes.INVALID_OBSERVATION_SCHEMA, { type: typeof type === "string" ? type : "" });
    }
    this.#schemas.set(type, validate);
  }

  record<T extends CanonicalValue>(input: ObservationInput<T>): Readonly<Observation> {
    if (this.#delivering) throwSimulationError(ErrorCodes.OBSERVER_REENTRANCY);
    if (this.#sealed) throwSimulationError(ErrorCodes.HISTORY_SEALED);
    if (this.#records.length >= this.#limit) throwSimulationError(ErrorCodes.HISTORY_LIMIT_EXCEEDED, { type: safeType(input) });
    const normalized = this.validate(input);
    const time = this.#clock.now();
    if (!isTime(time)) throwSimulationError(ErrorCodes.INVALID_OBSERVATION, { reason: "invalid clock time" });
    const id = this.#ids.allocate();
    const record = Object.freeze({ schemaVersion: 1 as const, id, time, sequence: this.#records.length, ...normalized }) as Observation;
    (this.#records as Observation[]).push(record);
    this.index(record); this.#pending.push(record);
    return record;
  }

  all(): readonly Readonly<Observation>[] { return Object.freeze([...this.#records]); }
  byId(id: string): Readonly<Observation> | undefined {
    if (!isIdentifier(id)) throwSimulationError(ErrorCodes.INVALID_OBSERVATION_FILTER, { field: "id" });
    return this.#byId.get(id);
  }
  query(filter: ObservationFilter): readonly Readonly<Observation>[] {
    validateFilter(filter);
    let candidate: readonly Observation[] = this.#records;
    const indexed = filter.type ? this.#byType.get(filter.type) : filter.traceId ? this.#byTrace.get(filter.traceId) : filter.eventId ? this.#byEvent.get(filter.eventId) : filter.component ? this.#byComponent.get(filter.component) : filter.entity ? this.#byEntity.get(entityKey(filter.entity)) : undefined;
    if (indexed) candidate = indexed;
    return Object.freeze(candidate.filter((record) => matches(record, filter)));
  }
  export(): ExecutionHistoryExport {
    const result: ExecutionHistoryExport = this.#sealed === undefined
      ? { schemaVersion: 1, runId: this.#runId, observations: Object.freeze([...this.#records]) }
      : { schemaVersion: 1, runId: this.#runId, observations: Object.freeze([...this.#records]), terminalFailure: this.#sealed };
    return Object.freeze(result);
  }
  subscribe(listener: ObservationListener): () => void {
    if (typeof listener !== "function") throwSimulationError(ErrorCodes.INVALID_OBSERVATION, { reason: "listener" });
    const registration: Registration = { listener, active: true }; this.#listeners.push(registration);
    return () => { registration.active = false; };
  }
  /** Called by the host after a control operation; callbacks never run in record(). */
  flushNotifications(): void {
    if (this.#delivering) return;
    this.#delivering = true;
    try {
      const pending = this.#pending; this.#pending = [];
      for (const record of pending) for (const registration of this.#listeners) {
        if (!registration.active) continue;
        try { registration.listener(record); } catch { registration.active = false; }
      }
    } finally { this.#delivering = false; }
  }
  sealFailure(failure: TerminalFailure): void {
    const fixed = freezeFailure(failure);
    if (this.#sealed) {
      if (JSON.stringify(this.#sealed) !== JSON.stringify(fixed)) throwSimulationError(ErrorCodes.HISTORY_SEALED);
      return;
    }
    this.#sealed = fixed;
  }

  validate(input: ObservationInput): Omit<Observation, "schemaVersion" | "id" | "time" | "sequence"> {
    const raw = dataProperties(input, ErrorCodes.INVALID_OBSERVATION);
    if (!validType(raw.type) || !isIdentifier(raw.source) || (raw.target !== undefined && !isIdentifier(raw.target))) failObservation();
    const schema = this.#schemas.get(raw.type);
    if (!schema) throwSimulationError(ErrorCodes.UNKNOWN_OBSERVATION_TYPE, { type: raw.type });
    let data: CanonicalValue | undefined;
    try { data = raw.data === undefined ? undefined : canonicalCopy(raw.data); }
    catch { throwSimulationError(ErrorCodes.INVALID_OBSERVATION, { reason: "noncanonical data" }); }
    let accepted: unknown;
    try { accepted = schema(data); } catch { throwSimulationError(ErrorCodes.INVALID_OBSERVATION_SCHEMA, { type: raw.type }); }
    if (typeof accepted !== "boolean" || !accepted) throwSimulationError(ErrorCodes.INVALID_OBSERVATION_SCHEMA, { type: raw.type });
    validateCorrelation(raw, this.#byId);
    const entityRefs = raw.entityRefs === undefined ? undefined : freezeEntities(raw.entityRefs);
    const transformed = transformData(raw.type, data, this.#visibility);
    const result: Record<string, unknown> = { type: raw.type, source: raw.source };
    for (const field of ["target", "traceId", "spanId", "parentSpanId", "causationId", "eventId"] as const) if (raw[field] !== undefined) result[field] = raw[field];
    if (entityRefs !== undefined) result.entityRefs = entityRefs;
    if (transformed !== undefined) result.data = transformed;
    return Object.freeze(result) as Omit<Observation, "schemaVersion" | "id" | "time" | "sequence">;
  }
  index(record: Observation): void {
    this.#byId.set(record.id, record); add(this.#byType, record.type, record); add(this.#byComponent, record.source, record);
    if (record.target) add(this.#byComponent, record.target, record); if (record.traceId) add(this.#byTrace, record.traceId, record); if (record.eventId) add(this.#byEvent, record.eventId, record);
    for (const entity of record.entityRefs ?? []) add(this.#byEntity, entityKey(entity), record);
  }
}

function normalizePolicy(policy: VisibilityPolicy): ExecutionHistoryOptions["visibility"] {
  const raw = dataProperties(policy, ErrorCodes.INVALID_RUN_INPUT);
  if (!isMode(raw.defaultMode)) throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason: "visibility mode" });
  const byType = copyStringMap(raw.byType, isMode); const summaryFields = copyStringMap(raw.summaryFields, value => Array.isArray(value) && value.every(isIdentifier), true) as Record<string, readonly string[]>;
  return Object.freeze({ defaultMode: raw.defaultMode, byType: Object.freeze(byType as Record<string, VisibilityMode>), summaryFields: Object.freeze(summaryFields) });
}
function copyStringMap(value: unknown, predicate: (v: unknown) => boolean, arrays = false): Record<string, unknown> {
  const raw = dataProperties(value, ErrorCodes.INVALID_RUN_INPUT); const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(raw)) { if (!validType(key) || !predicate(item)) throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason: "visibility policy" }); result[key] = arrays ? Object.freeze([...(item as string[])]) : item; }
  return result;
}
function transformData(type: string, data: CanonicalValue | undefined, policy: ExecutionHistoryOptions["visibility"]): CanonicalValue | undefined {
  const mode = policy.byType[type] ?? policy.defaultMode;
  if (mode === "omitted") return undefined;
  if (mode === "redacted") return Object.freeze({ redacted: true });
  if (mode === "visible") return data;
  const fields = policy.summaryFields[type];
  if (!fields || data === undefined || data === null || Array.isArray(data) || typeof data !== "object") failObservation();
  const summary: Record<string, CanonicalValue> = Object.create(null);
  const objectData = data as { readonly [key: string]: CanonicalValue };
  for (const field of fields) { const value = objectData[field]; if (value !== undefined) summary[field] = value; }
  return Object.freeze(summary);
}
function dataProperties(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throwSimulationError(code);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) { if (typeof key !== "string") throwSimulationError(code); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throwSimulationError(code); result[key] = descriptor.value; }
  return result;
}
function freezeEntities(value: unknown): readonly EntityRef[] { if (!Array.isArray(value)) failObservation(); return Object.freeze(value.map((entity) => { const raw=dataProperties(entity, ErrorCodes.INVALID_OBSERVATION); if (!isIdentifier(raw.kind)||!isIdentifier(raw.id)) failObservation(); return Object.freeze({kind:raw.kind,id:raw.id}); })); }
function validateCorrelation(raw: Record<string, unknown>, byId: Map<string, Observation>): void { for(const field of ["traceId","spanId","parentSpanId","causationId","eventId"]){if(raw[field]!==undefined&&!isIdentifier(raw[field]))failObservation();} if ((raw.spanId!==undefined&&raw.traceId===undefined)||(raw.parentSpanId!==undefined&&(raw.spanId===undefined||raw.traceId===undefined))) failObservation(); if(raw.causationId!==undefined&&!byId.has(raw.causationId as string)) failObservation(); }
function validateFilter(filter: ObservationFilter): void { const raw=dataProperties(filter, ErrorCodes.INVALID_OBSERVATION_FILTER); for(const key of Object.keys(raw)) if(!["fromTime","toTime","type","component","traceId","eventId","entity"].includes(key)) throwSimulationError(ErrorCodes.INVALID_OBSERVATION_FILTER); if((raw.fromTime!==undefined&&!isTime(raw.fromTime))||(raw.toTime!==undefined&&!isTime(raw.toTime))||(isTime(raw.fromTime)&&isTime(raw.toTime)&&raw.fromTime>raw.toTime)) throwSimulationError(ErrorCodes.INVALID_OBSERVATION_FILTER); for(const key of ["type","component","traceId","eventId"])if(raw[key]!==undefined&&!isIdentifier(raw[key]))throwSimulationError(ErrorCodes.INVALID_OBSERVATION_FILTER); if(raw.entity!==undefined)freezeEntities([raw.entity]); }
function matches(r: Observation,f: ObservationFilter):boolean{return !(f.fromTime!==undefined&&r.time<f.fromTime||f.toTime!==undefined&&r.time>f.toTime||f.type!==undefined&&r.type!==f.type||f.component!==undefined&&r.source!==f.component&&r.target!==f.component||f.traceId!==undefined&&r.traceId!==f.traceId||f.eventId!==undefined&&r.eventId!==f.eventId||f.entity!==undefined&&!(r.entityRefs??[]).some(e=>e.kind===f.entity!.kind&&e.id===f.entity!.id));}
function add(map:Map<string,Observation[]>,key:string,value:Observation):void{const list=map.get(key);if(list)list.push(value);else map.set(key,[value]);}
function entityKey(entity:EntityRef):string{return `${entity.kind}\u0000${entity.id}`;}
function validType(value:unknown):value is string{return isIdentifier(value)&&/^[a-z]+(?:[a-z0-9-]*)(?:\.[a-z][a-z0-9-]*)+$/.test(value);}
function isMode(value:unknown):value is VisibilityMode{return value==="visible"||value==="summary"||value==="redacted"||value==="omitted";}
function isTime(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function safeType(input:unknown):string {try {return dataProperties(input,ErrorCodes.INVALID_OBSERVATION).type as string ?? "";}catch{return "";}}
function failObservation():never{throwSimulationError(ErrorCodes.INVALID_OBSERVATION);}
function freezeFailure(failure:TerminalFailure):TerminalFailure {const raw=dataProperties(failure,ErrorCodes.INVALID_OBSERVATION);if(!Number.isSafeInteger(raw.time)||!isIdentifier(raw.code)||typeof raw.historyComplete!=="boolean"||(raw.lastObservationId!==undefined&&!isIdentifier(raw.lastObservationId)))failObservation();const context=canonicalCopy(raw.context);const value:TerminalFailure=raw.lastObservationId===undefined?{time:raw.time as SimulationTime,code:raw.code,context,historyComplete:raw.historyComplete as boolean}:{time:raw.time as SimulationTime,code:raw.code,context,historyComplete:raw.historyComplete as boolean,lastObservationId:raw.lastObservationId};return Object.freeze(value);}
