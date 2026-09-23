import { ScenarioObservationTypes } from "@distlab/contracts";
import type { AssertionResult, ScenarioAssertion } from "@distlab/contracts";
import type { CanonicalValue, ObservationInput, ScheduledEvent, SimulationTime } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "@distlab/kernel";
import type { AssessmentProjection, ScenarioPredicate } from "./types.js";

function fail(code: string): never {
  return throwSimulationError(code);
}

type Phase = "init" | "event" | "completion";
type Row = { id: string; status: AssertionResult["status"]; time: SimulationTime; evidence: CanonicalValue };

export interface AssessmentAttempt {
  readonly results: AssertionResult[];
  afterInitialization(): void;
  afterEvent(event: Readonly<ScheduledEvent>): void;
  onCompletion(): void;
  onFailure(): void;
}

/**
 * Read-only assertion state machine. Records evaluations through the supplied
 * sink and never subscribes to host notifications.
 */
export function startAssessment(input: {
  readonly assertions: readonly ScenarioAssertion[];
  readonly predicates: ReadonlyMap<string, ScenarioPredicate>;
  readonly startTime: SimulationTime;
  readonly project: (time: SimulationTime) => AssessmentProjection;
  readonly record: (observation: ObservationInput) => void;
}): AssessmentAttempt {
  const rows = new Map<string, Row>(input.assertions.map(assertion => [assertion.id, {
    id: assertion.id, status: "PENDING", time: input.startTime, evidence: null,
  }]));
  let now = input.startTime;
  const publish = (): AssertionResult[] => [...rows.values()].map(row => Object.freeze({
    id: row.id, status: row.status, time: row.time, evidence: canonicalCopy(row.evidence),
  }));
  const attempt: AssessmentAttempt = {
    get results() { return publish(); },
    afterInitialization: () => { now = input.startTime; evaluate("init", undefined); },
    afterEvent: event => { now = event.time; evaluate("event", event); },
    onCompletion: () => { evaluate("completion", undefined); },
    onFailure: () => { for (const row of rows.values()) if (row.status === "PENDING") row.status = "INCOMPLETE"; },
  };

  function evaluate(phase: Phase, event: Readonly<ScheduledEvent> | undefined): void {
    for (const assertion of input.assertions) {
      const row = rows.get(assertion.id);
      if (!row || row.status !== "PENDING") continue;
      if (assertion.mode === "at") {
        if (phase === "event" && markerFor(event, assertion.id) || phase === "completion") settle(assertion, row, event, true);
        continue;
      }
      if (assertion.mode === "always") {
        const verdict = call(assertion);
        const status = verdict.pass ? (phase === "completion" ? "PASS" : "PENDING") : "FAIL";
        commit(assertion, row, status, verdict.pass, verdict.evidence, event);
        continue;
      }
      const verdict = call(assertion);
      if (verdict.pass) commit(assertion, row, "PASS", true, verdict.evidence, event);
      else if (phase === "event" && markerFor(event, assertion.id) || phase === "completion") commit(assertion, row, "FAIL", false, verdict.evidence, event);
      else commit(assertion, row, "PENDING", false, verdict.evidence, event);
    }
  }

  function settle(assertion: ScenarioAssertion, row: Row, event: Readonly<ScheduledEvent> | undefined, terminal: boolean): void {
    const verdict = call(assertion);
    commit(assertion, row, verdict.pass ? "PASS" : terminal ? "FAIL" : "PENDING", verdict.pass, verdict.evidence, event);
  }

  function call(assertion: ScenarioAssertion): { pass: boolean; evidence: CanonicalValue } {
    const predicate = input.predicates.get(assertion.predicate);
    if (!predicate) fail(ErrorCodes.INVALID_ASSESSMENT_RESULT);
    let raw: unknown;
    try {
      raw = predicate.evaluate({ parameters: canonicalCopy(assertion.parameters), projection: input.project(now) });
    } catch (error) {
      if (isAssessment(error)) throw error;
      fail(ErrorCodes.INVALID_ASSESSMENT_RESULT);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(ErrorCodes.INVALID_ASSESSMENT_RESULT);
    const record = raw as { pass?: unknown; evidence?: unknown };
    if (typeof record.pass !== "boolean" || !Object.hasOwn(record, "evidence")) fail(ErrorCodes.INVALID_ASSESSMENT_RESULT);
    let evidence: CanonicalValue;
    try { evidence = canonicalCopy(record.evidence); }
    catch { fail(ErrorCodes.INVALID_ASSESSMENT_RESULT); }
    return { pass: record.pass, evidence };
  }

  function commit(assertion: ScenarioAssertion, row: Row, status: Row["status"], pass: boolean, evidence: CanonicalValue, event: Readonly<ScheduledEvent> | undefined): void {
    input.record({
      type: ScenarioObservationTypes.AssertionEvaluated,
      source: "simulation",
      ...(event ? { eventId: event.id } : {}),
      entityRefs: [{ kind: "assertion", id: assertion.id }],
      data: { assertionId: assertion.id, verdict: pass, evidence, ...(event ? { boundaryEvent: event.id } : {}) },
    });
    row.status = status;
    row.time = now;
    row.evidence = evidence;
  }

  return attempt;
}

function markerFor(event: Readonly<ScheduledEvent> | undefined, assertionId: string): boolean {
  if (!event || event.type !== "scenario.assertion" || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return false;
  return (event.payload as { assertionId?: unknown }).assertionId === assertionId;
}

function isAssessment(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === ErrorCodes.INVALID_ASSESSMENT_RESULT;
}
