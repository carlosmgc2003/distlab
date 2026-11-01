import type { CanonicalValue } from "./kernel/canonical.js";
import type { ComponentId } from "./kernel/identities.js";
import type { FaultEffect, FaultPoint, FaultRule, ScheduledFault } from "./fault.js";
import type { NetworkPolicy } from "./network.js";
import type { ScenarioAction } from "./scenario.js";

/**
 * Session overlays on packaged lessons (docs/spec/adr/004-session-overlays.md).
 * Shapes only: validation and application live in the scenario application layer.
 */

/** Every student fault rule ID, scheduled-fault action ID, and `ScheduledFault` ID starts with this prefix. */
export const STUDENT_ID_PREFIX = "student-";

/** Overlay-specific diagnostic codes. Translated scenario codes keep their existing names. */
export const OverlayDiagnosticCodes = {
  OVERLAY_NOT_ALLOWED: "OVERLAY_NOT_ALLOWED",
  OVERLAY_ID_PREFIX: "OVERLAY_ID_PREFIX",
  OVERLAY_LIMIT: "OVERLAY_LIMIT",
  UNKNOWN_PARAMETER: "UNKNOWN_PARAMETER",
  PARAMETER_VALUE: "PARAMETER_VALUE",
} as const;

export type OverlayDiagnosticCode = (typeof OverlayDiagnosticCodes)[keyof typeof OverlayDiagnosticCodes];

export type OverlayScheduledFault = Extract<ScenarioAction, { kind: "fault" }>;

export interface ParameterOverride {
  readonly key: string;
  readonly value: CanonicalValue;
}

export interface SessionOverlay {
  readonly version: 1;
  readonly faults: readonly FaultRule[];
  readonly scheduledFaults: readonly OverlayScheduledFault[];
  readonly parameters: readonly ParameterOverride[];
}

export type LessonParameterDomain =
  | { readonly type: "boolean"; readonly default: boolean }
  | { readonly type: "integer"; readonly default: number; readonly minimum: number; readonly maximum: number }
  | { readonly type: "choice"; readonly default: string; readonly choices: readonly string[] };

export type LessonParameterTarget =
  | { readonly kind: "component"; readonly component: ComponentId; readonly field: string }
  | { readonly kind: "link"; readonly source: ComponentId; readonly target: ComponentId; readonly field: keyof NetworkPolicy }
  | {
      readonly kind: "destination";
      readonly destination: string;
      readonly field: "deliveryDelay" | "ackTimeout" | "retryDelay" | "maxAttempts" | "capacity";
    }
  | { readonly kind: "action"; readonly action: string; readonly field: string };

export interface LessonParameter {
  readonly key: string;
  readonly domain: LessonParameterDomain;
  readonly targets: readonly LessonParameterTarget[];
}

export interface LessonFaultAllowance {
  readonly rules: readonly {
    readonly point: FaultPoint;
    readonly effects: readonly FaultEffect["kind"][];
  }[];
  readonly scheduled: readonly ScheduledFault["kind"][];
  readonly maxEntries: number;
}

export interface LessonOverlayPolicy {
  readonly version: 1;
  /** Packaged scenario `name`, for example "retry-unsafe@1". */
  readonly lesson: string;
  readonly faults: LessonFaultAllowance;
  readonly parameters: readonly LessonParameter[];
}

export interface SessionIdentity {
  readonly lesson: string;
  readonly seed: string;
  readonly overlay: SessionOverlay;
}
