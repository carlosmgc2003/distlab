import type { ClientDefinition, DatabaseRow, ExternalDefinition, ServiceDefinition } from "@distlab/contracts";
import type { CanonicalValue, ComponentId, SimulationStatus, SimulationTime } from "@distlab/contracts/kernel";
import type { ComponentInstance } from "@distlab/contracts";

/** Versioned catalog entry. `instantiate` runs only while composing a session. */
export interface ScenarioModel {
  readonly model: string;
  readonly version: string;
  readonly kind: "client" | "service" | "external";
  readonly actions: readonly string[];
  readonly endpoints: readonly string[];
  readonly consumers: readonly string[];
  readonly operations: readonly string[];
  readonly checks: Readonly<Record<string, (row: DatabaseRow) => boolean>>;
  instantiate(instance: ComponentInstance): ClientDefinition | ServiceDefinition | ExternalDefinition;
}

/** Trusted definitions addressed by exact model version. */
export interface ScenarioCatalog {
  readonly id: string;
  readonly version: string;
  find(model: string, version: string): ScenarioModel | undefined;
  versions(model: string): readonly string[];
}

/** Detached read-only boundary. Predicates cannot schedule or mutate through it. */
export interface AssessmentProjection {
  readonly time: SimulationTime;
  readonly status: SimulationStatus;
  readonly history: CanonicalValue;
  readonly components: CanonicalValue;
  readonly databases: CanonicalValue;
  readonly stores: CanonicalValue;
  readonly messageBus: CanonicalValue;
}

export interface ScenarioPredicate {
  readonly id: string;
  readonly version: string;
  evaluate(input: {
    readonly parameters: CanonicalValue;
    readonly projection: AssessmentProjection;
  }): { readonly pass: boolean; readonly evidence: CanonicalValue };
}

export interface ScenarioAssessment {
  readonly version: string;
  find(id: string): ScenarioPredicate | undefined;
}

export const DiagnosticCodes = {
  CANONICAL: "CANONICAL",
  REQUIRED: "REQUIRED",
  TYPE: "TYPE",
  UNSUPPORTED: "UNSUPPORTED",
  DUPLICATE: "DUPLICATE",
  UNKNOWN_COMPONENT: "UNKNOWN_COMPONENT",
  UNKNOWN_MODEL: "UNKNOWN_MODEL",
  VERSION: "VERSION",
  KIND: "KIND",
  OWNERSHIP: "OWNERSHIP",
  UNKNOWN_PREDICATE: "UNKNOWN_PREDICATE",
  TIME: "TIME",
  ASSERTION_TIMING: "ASSERTION_TIMING",
  SEED: "SEED",
  BEFORE_START: "BEFORE_START",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
  LINK: "LINK",
  SUBSCRIPTION: "SUBSCRIPTION",
  FAULT: "FAULT",
  START_TIME_MISMATCH: "START_TIME_MISMATCH",
  STATE: "STATE",
  CONSTRAINT: "CONSTRAINT",
  REFERENCE: "REFERENCE",
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];
