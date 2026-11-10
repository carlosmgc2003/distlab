export { DeterministicScenarioEngine, DeterministicScenarioSession, type ScenarioEngineOptions } from "./engine.js";
export { openHarness, inspectSession, compareExports, type HarnessExport, type HarnessSession } from "./harness.js";
export { normalizeScenario, type Normalization } from "./validate.js";
export { DiagnosticCodes, type DiagnosticCode, type ScenarioCatalog, type ScenarioModel, type ScenarioPredicate, type ScenarioAssessment, type AssessmentProjection } from "./types.js";
export { type DescriptorSource, type OverlayContext } from "./architecture-edits.js";
export { EMPTY_OVERLAY, applyOverlay, composeOverlay, inDomain, overlayKey, resolveTarget, validateOverlay, type OverlayComposition, type OverlayValidation, type TargetLocation } from "./overlay.js";
export {
  SUPPORTED_FORMAT_VERSIONS, documentDigest, parseDocumentText, resolveHostedCatalog, validateScenarioDocument,
  type DocumentParse, type DocumentStage, type DocumentValidation, type HostedCatalog, type HostedCatalogRegistry,
} from "./document.js";
export { validateAssessmentDefinition, type AssessmentBaseLesson } from "./assessment-definition.js";
