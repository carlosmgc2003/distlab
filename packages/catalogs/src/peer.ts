import type { CanonicalValue, ComponentId, ComponentInstance, ModelDescriptor } from "@distlab/contracts";

/**
 * The component bound to a declared peer (ADR-005): the configuration field named after
 * the peer, or the descriptor default when the configuration omits it.
 */
export function peer(descriptor: ModelDescriptor, instance: ComponentInstance, name: string): ComponentId {
  const declared = descriptor.peers.find(item => item.name === name);
  if (!declared) throw new Error(`${descriptor.model} declares no peer ${name}`);
  const configuration = instance.configuration;
  const value = configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? (configuration as Readonly<Record<string, CanonicalValue>>)[name] : undefined;
  if (value === undefined) return declared.default;
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${name} peer of ${instance.id}`);
  return value;
}
