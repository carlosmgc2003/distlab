import type { CanonicalValue } from "./canonical.js";
import { ErrorCodes, throwSimulationError } from "./errors.js";

/**
 * Elapsed logical milliseconds. Not a calendar or Unix timestamp.
 * See docs/spec/virtual-clock.md.
 */
export type SimulationTime = number & { readonly __brand: "SimulationTime" };

/** Non-negative logical millisecond count used for delays and TTLs. */
export type Duration = number & { readonly __brand: "Duration" };

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function invalidNumberContext(value: number): CanonicalValue {
  return Number.isFinite(value) ? { value } : { value: String(value) };
}

export function simulationTime(value: number): SimulationTime {
  if (!isNonNegativeSafeInteger(value)) {
    throwSimulationError(
      ErrorCodes.INVALID_SIMULATION_TIME,
      invalidNumberContext(value),
    );
  }
  return value as SimulationTime;
}

export function duration(value: number): Duration {
  if (!isNonNegativeSafeInteger(value)) {
    throwSimulationError(
      ErrorCodes.INVALID_DURATION,
      invalidNumberContext(value),
    );
  }
  return value as Duration;
}
