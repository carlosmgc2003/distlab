import type { ModelDescriptor } from "@distlab/contracts";
import { checkoutDescriptors } from "../../../packages/catalogs/src/descriptors.ts";
import { commerceDescriptors } from "../../../packages/catalogs/src/commerce/descriptors.ts";

/**
 * Empty slots (#164). Pure and data-only: it reads the catalogs' data-only model descriptors
 * (ADR-005), never a runtime model. The Design editor (#112) fills a slot; the graph and the
 * Component inspector mark one that is still empty.
 */

const placeholders: readonly ModelDescriptor[] = [...checkoutDescriptors, ...commerceDescriptors].filter(descriptor => descriptor.placeholder === true);

/** Whether a component's declared model is a placeholder that fills an empty slot. */
export function isEmptySlot(model: string | undefined, version: string | undefined): boolean {
  return placeholders.some(descriptor => descriptor.model === model && descriptor.version === version);
}
