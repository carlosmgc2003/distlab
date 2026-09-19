import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { Simulation, RunInputs } from "./kernel/simulation.js";
import type { SimulationTime } from "./kernel/time.js";
import type { DatabaseDefinition } from "./database.js";
import type { FaultRule, ScheduledFault } from "./fault.js";
import type { KeyValueDefinition } from "./kv-store.js";
import type { DestinationDefinition } from "./message-bus.js";
import type { NetworkPolicy } from "./network.js";
import type { ServiceState } from "./service.js";
import type { ExternalAvailability, ExternalBehavior } from "./external.js";

export const ScenarioObservationTypes = {
  ActionDispatched: "scenario.action.dispatched",
  AssertionEvaluated: "scenario.assertion.evaluated",
} as const;

export type ComponentKind = "client" | "service" | "external";

export interface ComponentInstance {
  readonly id: ComponentId;
  readonly kind: ComponentKind;
  readonly model: string;
  readonly version: string;
  readonly configuration: CanonicalValue;
}

export interface ArchitectureDefinition {
  readonly components: readonly ComponentInstance[];
  readonly links: readonly {
    readonly source: ComponentId;
    readonly target: ComponentId;
    readonly policy: NetworkPolicy;
  }[];
  readonly databases: readonly DatabaseDefinition[];
  readonly stores: readonly KeyValueDefinition[];
  readonly destinations: readonly DestinationDefinition[];
  readonly subscriptions: readonly {
    readonly destination: string;
    readonly consumer: ComponentId;
  }[];
}

export type ScenarioAction =
  | {
      readonly id: string;
      readonly at: SimulationTime;
      readonly kind: "client";
      readonly target: ComponentId;
      readonly action: string;
      readonly data: CanonicalValue;
    }
  | {
      readonly id: string;
      readonly at: SimulationTime;
      readonly kind: "service";
      readonly target: ComponentId;
      readonly state: ServiceState;
    }
  | {
      readonly id: string;
      readonly at: SimulationTime;
      readonly kind: "external";
      readonly target: ComponentId;
      readonly state: ExternalAvailability;
    }
  | {
      readonly id: string;
      readonly at: SimulationTime;
      readonly kind: "external-behavior";
      readonly target: ComponentId;
      readonly operation: string;
      readonly behavior: ExternalBehavior;
    }
  | {
      readonly id: string;
      readonly at: SimulationTime;
      readonly kind: "fault";
      readonly fault: ScheduledFault;
    };

export interface ScenarioAssertion {
  readonly id: string;
  readonly predicate: string;
  readonly parameters: CanonicalValue;
  readonly mode: "always" | "at" | "eventually";
  readonly at?: SimulationTime;
  readonly deadline?: SimulationTime;
}

/**
 * Normalized experiment. The TypeScript shape is the post-validation form:
 * omitted lists are empty, startTime defaults to 0, and model defaults are
 * applied.
 */
export interface ScenarioDefinition {
  readonly version: 1;
  readonly name: string;
  readonly seed: string;
  readonly architecture: ArchitectureDefinition;
  readonly startTime: SimulationTime;
  readonly external: readonly {
    readonly target: ComponentId;
    readonly operation: string;
    readonly behavior: ExternalBehavior;
  }[];
  readonly faults: readonly FaultRule[];
  readonly actions: readonly ScenarioAction[];
  readonly assertions: readonly ScenarioAssertion[];
  readonly configuration: RunInputs["configuration"];
}

export interface ScenarioDiagnostic {
  readonly path: string;
  readonly code: string;
}

export interface AssertionResult {
  readonly id: string;
  readonly status: "PENDING" | "PASS" | "FAIL" | "INCOMPLETE";
  readonly time: SimulationTime;
  readonly evidence: CanonicalValue;
}

export interface ScenarioSession {
  readonly simulation: Simulation;
  results(): readonly AssertionResult[];
}

/**
 * Application-layer adapter. Does not belong in the kernel. `validate` is
 * pure and must not allocate simulation identities or consume randomness.
 */
export interface ScenarioEngine {
  validate(input: CanonicalValue): readonly ScenarioDiagnostic[];
  create(input: CanonicalValue): ScenarioSession;
}
