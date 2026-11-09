import type { LessonOverlayPolicy, ModelDescriptor } from "@distlab/contracts";
import { checkoutDescriptors } from "../../../packages/catalogs/src/descriptors.ts";
import { commerceDescriptors } from "../../../packages/catalogs/src/commerce/descriptors.ts";

/**
 * Design steps the browser cannot offer yet (#164). Pure and data-only: it reads a lesson's overlay
 * policy and the catalogs' data-only model descriptors (ADR-005), never a runtime model.
 */

/**
 * Whether the browser has a Design editor (#112). Until it does, a lesson whose policy allows
 * architecture edits cannot be completed here, so the Lesson chooser and ① Goal say so.
 */
export const DESIGN_EDITOR_AVAILABLE = false;

export const DESIGN_STEP_NOTICE = "The design step is not available in the browser yet. You can run the lesson with the empty slot and see what is missing.";

/** Whether a lesson asks for design edits that this browser cannot make. */
export function designStepUnavailable(policy: Pick<LessonOverlayPolicy, "architecture"> | undefined, editorAvailable = DESIGN_EDITOR_AVAILABLE): boolean {
  return !editorAvailable && policy?.architecture !== undefined;
}

export const EMPTY_SLOT_LABEL = "Empty slot";

export const EMPTY_SLOT_DESCRIPTION = "No model fills this component yet. It receives, publishes, and stores nothing, and answers any request with NOT_IMPLEMENTED.";

const placeholders: readonly ModelDescriptor[] = [...checkoutDescriptors, ...commerceDescriptors].filter(descriptor => descriptor.placeholder === true);

/** Whether a component's declared model is a placeholder that fills an empty slot. */
export function isEmptySlot(model: string | undefined, version: string | undefined): boolean {
  return placeholders.some(descriptor => descriptor.model === model && descriptor.version === version);
}
