export { DeterministicScenarioEngine, DeterministicScenarioSession, type ScenarioEngineOptions } from "./engine.js";
export { openHarness, inspectSession, compareExports, type HarnessExport, type HarnessSession } from "./harness.js";
export { normalizeScenario, type Normalization } from "./validate.js";
export { DiagnosticCodes, type DiagnosticCode, type ScenarioCatalog, type ScenarioModel, type ScenarioPredicate, type ScenarioAssessment, type AssessmentProjection } from "./types.js";
export { type DescriptorSource, type OverlayContext } from "./architecture-edits.js";
export { EMPTY_OVERLAY, applyOverlay, composeOverlay, inDomain, overlayKey, resolveTarget, validateOverlay, type OverlayComposition, type OverlayValidation, type TargetLocation } from "./overlay.js";
