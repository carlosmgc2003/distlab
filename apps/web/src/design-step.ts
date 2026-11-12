import type { ModelDescriptor } from "@distlab/contracts";
import { checkoutDescriptors } from "../../../packages/catalogs/src/descriptors.ts";
import { commerceDescriptors } from "../../../packages/catalogs/src/commerce/descriptors.ts";

/**
 * Empty slots (#164). Pure and data-only: it reads the catalogs' data-only model descriptors
 * (ADR-005), never a runtime model. The Design editor (#112) fills a slot; the graph and the
 * Component inspector mark one that is still empty.
 */

export const EMPTY_SLOT_LABEL = "Empty slot";

export const EMPTY_SLOT_DESCRIPTION = "No model fills this component yet. It receives, publishes, and stores nothing, and answers any request with NOT_IMPLEMENTED.";

const placeholders: readonly ModelDescriptor[] = [...checkoutDescriptors, ...commerceDescriptors].filter(descriptor => descriptor.placeholder === true);

/** Whether a component's declared model is a placeholder that fills an empty slot. */
export function isEmptySlot(model: string | undefined, version: string | undefined): boolean {
  return placeholders.some(descriptor => descriptor.model === model && descriptor.version === version);
}
