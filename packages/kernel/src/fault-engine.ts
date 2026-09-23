import type { FaultController, FaultDecision, FaultDecisionPort, FaultPoint, FaultProbe, FaultRule, ScheduledFault } from "@distlab/contracts";
import { FaultObservationTypes } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, ObservationSink, ScheduledEvent, SeededRandomPort, SimulationTime } from "@distlab/contracts/kernel";
import { duration, ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";
import { isIdentifier } from "./identity.js";

type Availability = Extract<ScheduledFault, { kind: "external-availability" }>["state"];
export interface FaultEngineOptions {
  readonly rules: readonly FaultRule[];
  readonly components: readonly ComponentId[];
  readonly clock: { now(): SimulationTime };
  readonly random: SeededRandomPort;
  readonly observations: ObservationSink & { registerSchema(type: string, validate: (data: CanonicalValue | undefined) => boolean): void };
  readonly activeEvent?: () => ScheduledEvent | undefined;
  readonly dispatching?: () => boolean;
  /** Trusted effect ports return only after the target transition succeeds. */
  readonly crash?: Readonly<Record<string, () => void>>;
  readonly externalAvailability?: Readonly<Record<string, (state: Availability) => void>>;
}

type RuleState = { readonly rule: FaultRule; candidates: number; applications: number };
const fail = (code: string = ErrorCodes.INVALID_FAULT): never => throwSimulationError(code);
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const positive = (value: unknown): value is number => whole(value) && value > 0;
const point = (value: unknown): value is FaultPoint => value === "network.request" || value === "network.response" || value === "message.delivery" || value === "database.commit";
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const overlaps = (a: FaultRule, b: FaultRule): boolean => a.point === b.point &&
  (["source", "target", "name"] as const).every(key => a[key] === undefined || b[key] === undefined || a[key] === b[key]) &&
  (a.until === undefined || b.from < a.until) && (b.until === undefined || a.from < b.until);

/** One attempt's deterministic selector. Transport and lifecycle owners retain all effects. */
export class DeterministicFaultEngine implements FaultDecisionPort, FaultController {
  readonly #rules: readonly FaultRule[];
  readonly #components: ReadonlySet<string>;
  #states: RuleState[];
  #options: FaultEngineOptions;
  #generation = 0;
  readonly #probes = new Set<string>();
  readonly #applied = new Set<string>();

  constructor(options: FaultEngineOptions) {
    if (!Array.isArray(options.components) || options.components.some(id => !isIdentifier(id)) || new Set(options.components).size !== options.components.length || !Array.isArray(options.rules)) fail();
    this.#components = new Set(options.components);
    this.#rules = Object.freeze(options.rules.map(input => this.#rule(input)));
    const ids = new Set<string>();
    for (const rule of this.#rules) { if (ids.has(rule.id)) fail(); ids.add(rule.id); }
    for (let i = 0; i < this.#rules.length; i++) for (let j = i + 1; j < this.#rules.length; j++) {
      const a = this.#rules[i]!, b = this.#rules[j]!;
      if (a.effect.kind === "duplicate" && b.effect.kind === "duplicate" && overlaps(a, b)) fail();
    }
    this.#states = this.#rules.map(rule => ({ rule, candidates: 0, applications: 0 }));
    this.#options = options;
    this.#register(options.observations);
  }

  #rule(input: FaultRule): FaultRule {
    let value: FaultRule;
    try { value = canonicalCopy(input) as unknown as FaultRule; } catch { return fail(); }
    if (!plain(value) || !exact(value, ["id", "point", "source", "target", "name", "from", "until", "occurrence", "probability", "maxApplications", "effect"]) ||
      !isIdentifier(value.id) || !point(value.point) || !whole(value.from) || (value.until !== undefined && (!whole(value.until) || value.until <= value.from)) ||
      (value.source !== undefined && !this.#components.has(value.source)) || (value.target !== undefined && !this.#components.has(value.target)) ||
      (value.name !== undefined && !isIdentifier(value.name)) || (value.occurrence !== undefined && !positive(value.occurrence)) ||
      typeof value.probability !== "number" || !Number.isFinite(value.probability) || value.probability < 0 || value.probability > 1 ||
      !positive(value.maxApplications) || !plain(value.effect)) fail();
    const effect = value.effect;
    if (!exact(effect, effect.kind === "delay" ? ["kind", "duration"] : effect.kind === "duplicate" ? ["kind", "additionalCopies", "spacing"] : ["kind"])) fail();
    if (effect.kind === "delay" && !whole(effect.duration) || effect.kind === "duplicate" && (!positive(effect.additionalCopies) || effect.additionalCopies > 16 || !whole(effect.spacing))) fail();
    if (value.point === "database.commit" ? effect.kind !== "fail" : effect.kind === "fail" ||
      (effect.kind === "duplicate" && value.point !== "message.delivery") || (effect.kind === "disconnect" && value.point !== "network.request") ||
      !["delay", "drop", "duplicate", "disconnect"].includes(effect.kind)) fail();
    return Object.freeze({ ...value, effect: Object.freeze({ ...effect }) });
  }

  #register(sink: FaultEngineOptions["observations"]): void {
    sink.registerSchema(FaultObservationTypes.RuleMatched, data => plain(data) && isIdentifier(data.ruleId) && plain(data.probe) &&
      positive(data.candidateOrdinal) && typeof data.selected === "boolean");
    sink.registerSchema(FaultObservationTypes.EffectSelected, data => plain(data) && isIdentifier(data.ruleId) &&
      isIdentifier(data.subjectId) && plain(data.effect) && positive(data.applicationOrdinal));
    sink.registerSchema(FaultObservationTypes.Applied, data => plain(data) && isIdentifier(data.faultId) &&
      isIdentifier(data.target) && (data.kind === "crash" || data.kind === "external-availability"));
  }
  /** Reset with fresh attempt ports when history or RNG is reconstructed. Old capabilities become stale. */
  reset(ports?: Pick<FaultEngineOptions, "clock" | "random" | "observations" | "activeEvent" | "dispatching" | "crash" | "externalAvailability">): void {
    if (ports) { this.#options = { ...this.#options, ...ports }; this.#register(ports.observations); }
    this.#generation++;
    this.#states = this.#rules.map(rule => ({ rule, candidates: 0, applications: 0 }));
    this.#probes.clear(); this.#applied.clear();
  }
  decisionPort(): FaultDecisionPort {
    const generation = this.#generation;
    return Object.freeze({ evaluate: (probe: FaultProbe) => { this.#check(generation); return this.evaluate(probe); } });
  }
  controller(): FaultController {
    const generation = this.#generation;
    return Object.freeze({ apply: (fault: ScheduledFault) => { this.#check(generation); this.apply(fault); } });
  }
  inspect(): Readonly<{ rules: readonly Readonly<{ id: string; candidates: number; applications: number }>[]; probes: readonly string[]; applied: readonly string[] }> {
    return Object.freeze({ rules: Object.freeze(this.#states.map(({ rule, candidates, applications }) => Object.freeze({ id: rule.id, candidates, applications }))),
      probes: Object.freeze([...this.#probes]), applied: Object.freeze([...this.#applied]) });
  }
  #check(generation = this.#generation): void {
    if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
    if (this.#options.dispatching && !this.#options.dispatching()) fail();
    if (this.#options.activeEvent && !this.#options.activeEvent()) fail();
  }
  #link(): Record<string, string> {
    const event = this.#options.activeEvent?.();
    return event ? { eventId: event.id, ...(event.traceId ? { traceId: event.traceId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}),
      ...(event.parentSpanId ? { parentSpanId: event.parentSpanId } : {}), ...(event.causationId ? { causationId: event.causationId } : {}) } : {};
  }
  #record(type: string, source: string, data: unknown): void {
    this.#options.observations.record({ type, source, ...this.#link(), data: canonicalCopy(data) });
  }
  evaluate(input: FaultProbe): FaultDecision {
    this.#check();
    let probe: FaultProbe;
    try { probe = canonicalCopy(input) as unknown as FaultProbe; } catch { return fail(); }
    if (!plain(probe) || !exact(probe, ["point", "subjectId", "source", "target", "name"]) || !point(probe.point) ||
      !isIdentifier(probe.subjectId) || !this.#components.has(probe.source) || !this.#components.has(probe.target) || !isIdentifier(probe.name) ||
      !whole(this.#options.clock.now())) fail();
    const identity = probe.point + "\u0000" + probe.subjectId;
    if (this.#probes.has(identity)) fail(ErrorCodes.FAULT_PROBE_REUSED);
    this.#probes.add(identity);
    const ids: string[] = [];
    let extraDelay = 0, additionalCopies = 0, copySpacing = 0, drop = false, failed = false;
    const now = this.#options.clock.now();
    for (const state of this.#states) {
      const rule = state.rule;
      if (rule.point !== probe.point || rule.source !== undefined && rule.source !== probe.source || rule.target !== undefined && rule.target !== probe.target ||
        rule.name !== undefined && rule.name !== probe.name || now < rule.from || rule.until !== undefined && now >= rule.until) continue;
      if (!Number.isSafeInteger(state.candidates + 1)) fail(ErrorCodes.IDENTITY_OVERFLOW);
      const ordinal = ++state.candidates;
      if (rule.occurrence !== undefined && ordinal !== rule.occurrence || state.applications >= rule.maxApplications) continue;
      const selected = rule.probability === 1 || rule.probability !== 0 && this.#options.random.draw("fault." + rule.id).unit < rule.probability;
      this.#record(FaultObservationTypes.RuleMatched, probe.source, { ruleId: rule.id, probe, candidateOrdinal: ordinal, selected });
      if (!selected) continue;
      const effect = rule.effect;
      if (effect.kind === "delay") {
        const sum = extraDelay + effect.duration;
        if (!Number.isSafeInteger(sum)) fail(ErrorCodes.TIME_OVERFLOW);
        extraDelay = sum;
      } else if (effect.kind === "drop" || effect.kind === "disconnect") drop = true;
      else if (effect.kind === "fail") failed = true;
      else { additionalCopies = effect.additionalCopies; copySpacing = effect.spacing; }
      if (!Number.isSafeInteger(state.applications + 1)) fail(ErrorCodes.IDENTITY_OVERFLOW);
      state.applications++;
      ids.push(rule.id);
      this.#record(FaultObservationTypes.EffectSelected, probe.source, { ruleId: rule.id, subjectId: probe.subjectId, effect, applicationOrdinal: state.applications });
    }
    return Object.freeze({ ruleIds: Object.freeze(ids), extraDelay: duration(extraDelay), drop, additionalCopies: drop ? 0 : additionalCopies,
      copySpacing: duration(drop ? 0 : copySpacing), fail: failed });
  }
  apply(input: ScheduledFault): void {
    this.#check();
    let fault: ScheduledFault;
    try { fault = canonicalCopy(input) as unknown as ScheduledFault; } catch { return fail(); }
    if (!plain(fault) || !isIdentifier(fault.id) || !this.#components.has(fault.target) ||
      (fault.kind === "crash" ? !exact(fault, ["id", "kind", "target"]) || typeof this.#options.crash?.[fault.target] !== "function" :
        fault.kind === "external-availability" ? !exact(fault, ["id", "kind", "target", "state"]) ||
          !["AVAILABLE", "DEGRADED", "UNAVAILABLE", "RATE_LIMITED"].includes(fault.state) || typeof this.#options.externalAvailability?.[fault.target] !== "function" : true)) fail();
    if (this.#applied.has(fault.id)) return;
    if (fault.kind === "crash") this.#options.crash![fault.target]!();
    else this.#options.externalAvailability![fault.target]!(fault.state);
    this.#applied.add(fault.id);
    this.#record(FaultObservationTypes.Applied, fault.target, { faultId: fault.id, target: fault.target, kind: fault.kind,
      ...(fault.kind === "external-availability" ? { state: fault.state } : {}) });
  }
}
