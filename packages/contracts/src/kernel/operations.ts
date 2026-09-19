import type { CanonicalValue } from "./canonical.js";
import type { OperationId } from "./identities.js";
import type { SimulationError } from "./errors.js";

/**
 * Opaque kernel-issued handle. Not a Promise and not a serializable payload.
 * Tasks yield exactly one owned operation at a time.
 */
export interface ControlledOperation {
  readonly operationId: OperationId;
}

export type OperationOutcome =
  | { readonly kind: "success"; readonly value: CanonicalValue }
  | { readonly kind: "failure"; readonly error: SimulationError };

/**
 * Trusted-adapter port. `complete` is legal only inside dispatch of that
 * completion event. A second completion is an idempotent no-op.
 */
export interface OperationController {
  create(): ControlledOperation;
  complete(operationId: OperationId, outcome: OperationOutcome): void;
}

export type ControlledTask = Generator<ControlledOperation, void, CanonicalValue>;
