import type { ComponentId } from "./kernel/identities.js";
import type { Duration, SimulationTime } from "./kernel/time.js";

export const FaultObservationTypes = {
  RuleMatched: "fault.rule.matched",
  EffectSelected: "fault.effect.selected",
  Applied: "fault.applied",
} as const;

export type FaultPoint =
  | "network.request"
  | "network.response"
  | "message.delivery"
  | "database.commit";

export interface FaultProbe {
  readonly point: FaultPoint;
  readonly subjectId: string;
  readonly source: ComponentId;
  readonly target: ComponentId;
  /** Endpoint, destination, or database owner ID. */
  readonly name: string;
}

/**
 * Transport/storage effects returned to the owning model.
 * Crash and provider availability are {@link ScheduledFault}, not effects.
 * Timeouts are absent/late replies, not a fault kind. Rate limiting uses
 * scheduled external availability.
 */
export type FaultEffect =
  | { readonly kind: "delay"; readonly duration: Duration }
  | { readonly kind: "drop" }
  | { readonly kind: "fail" }
  | {
      readonly kind: "duplicate";
      readonly additionalCopies: number;
      readonly spacing: Duration;
    }
  | { readonly kind: "disconnect" };

/**
 * Immutable ordered rule. Defaults: probability 1, maxApplications 1.
 * `until` is exclusive and must exceed `from` when present.
 */
export interface FaultRule {
  readonly id: string;
  readonly point: FaultPoint;
  readonly source?: ComponentId;
  readonly target?: ComponentId;
  readonly name?: string;
  readonly from: SimulationTime;
  readonly until?: SimulationTime;
  readonly occurrence?: number;
  readonly probability: number;
  readonly maxApplications: number;
  readonly effect: FaultEffect;
}

export interface FaultDecision {
  readonly ruleIds: readonly string[];
  readonly extraDelay: Duration;
  readonly drop: boolean;
  readonly additionalCopies: number;
  readonly copySpacing: Duration;
  readonly fail: boolean;
}

export interface FaultDecisionPort {
  evaluate(probe: FaultProbe): FaultDecision;
}

export type ScheduledFault =
  | { readonly id: string; readonly kind: "crash"; readonly target: ComponentId }
  | {
      readonly id: string;
      readonly kind: "external-availability";
      readonly target: ComponentId;
      readonly state: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED";
    };

export interface FaultController {
  apply(fault: ScheduledFault): void;
}
