import type { CanonicalValue, ComponentInstance, NetworkReply } from "@distlab/contracts";
import { NOT_IMPLEMENTED } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { placeholderExternalDescriptor, placeholderServiceDescriptor } from "./descriptors.js";

/** The endpoints or operations a placeholder exposes: its configuration field `interface`, read as composition validation reads it. */
function exposed(instance: ComponentInstance): readonly string[] {
  const configuration = instance.configuration;
  const value = configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? (configuration as Readonly<Record<string, CanonicalValue>>).interface : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
const notImplemented = (): NetworkReply => ({ status: "error", body: { code: NOT_IMPLEMENTED } });

/** An empty service slot: every exposed endpoint answers `NOT_IMPLEMENTED`; no consumers, no background work, no storage. */
export const placeholderServiceModel: ScenarioModel = {
  ...placeholderServiceDescriptor, checks: {},
  instantiate: instance => ({
    id: instance.id, version: instance.version, consumers: {}, background: {},
    endpoints: Object.fromEntries(exposed(instance).map(endpoint => [endpoint, notImplemented])),
  }),
};

/** An empty external slot: every exposed operation answers `NOT_IMPLEMENTED` and changes no state. */
export const placeholderExternalModel: ScenarioModel = {
  ...placeholderExternalDescriptor, checks: {},
  instantiate: instance => ({
    id: instance.id, version: instance.version, initialState: {},
    operations: Object.fromEntries(exposed(instance).map(operation => [operation, {
      apply: (_body: CanonicalValue, state: CanonicalValue) => ({ nextState: state, reply: notImplemented(), visibleChanges: {}, callbacks: [] }),
    }])),
  }),
};
