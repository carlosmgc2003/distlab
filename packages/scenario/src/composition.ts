import type { ArchitectureDefinition, CanonicalValue, ComponentInstance, ModelDescriptor } from "@distlab/contracts";
import { DiagnosticCodes, type DiagnosticCode, type ScenarioCatalog } from "./types.js";

/**
 * ADR-005 composition rules: every endpoint or operation a component calls is
 * reachable before the run starts. Pure: reads the architecture and the catalog
 * descriptors only. Expects an architecture that already read without
 * diagnostics, so component array indexes are document indexes.
 *
 * Paths:
 * - a peer (`PEER`, `INTERFACE`, and `LINK` for a missing peer link) points at the
 *   configuration field that holds, or would hold, the bound component ID;
 * - `PUBLISH` points at the publishing component;
 * - `STORAGE` points at the owner's database tables when a table is missing,
 *   otherwise at the component that needs the missing database or store.
 */
export function checkComposition(architecture: ArchitectureDefinition, catalog: ScenarioCatalog, push: (path: string, code: DiagnosticCode) => void): void {
  const byId = new Map(architecture.components.map(component => [component.id, component]));
  const links = new Set(architecture.links.map(link => `${link.source}\u0000${link.target}`));
  const destinations = new Set(architecture.destinations.map(destination => destination.id));
  const databases = new Map(architecture.databases.map((database, index) => [database.owner, { database, index }]));
  const stores = new Set(architecture.stores.map(store => store.owner));
  architecture.components.forEach((component, index) => {
    const path = `/architecture/components/${index}`;
    const descriptor = catalog.find(component.model, component.version);
    if (!descriptor) return;
    for (const peer of descriptor.peers) {
      const peerPath = `${path}/configuration/${escape(peer.name)}`;
      const configured = field(component.configuration, peer.name);
      if (configured !== undefined && (typeof configured !== "string" || configured.trim() === "")) { push(peerPath, DiagnosticCodes.TYPE); continue; }
      const target = byId.get(configured ?? peer.default);
      if (!target || target.kind === "client" || !peer.kinds.includes(target.kind)) { push(peerPath, DiagnosticCodes.PEER); continue; }
      const offered = exposed(target, catalog.find(target.model, target.version));
      if (peer.calls.some(call => !offered.has(call))) push(peerPath, DiagnosticCodes.INTERFACE);
      if (!links.has(`${component.id}\u0000${target.id}`)) push(peerPath, DiagnosticCodes.LINK);
    }
    if (descriptor.publishes.some(destination => !destinations.has(destination))) push(path, DiagnosticCodes.PUBLISH);
    const required = descriptor.storage.database;
    if (required) {
      const owned = databases.get(component.id);
      if (!owned) push(path, DiagnosticCodes.STORAGE);
      else {
        const names = new Set(owned.database.tables.map(table => table.name));
        if (required.tables.some(table => !names.has(table.name))) push(`/architecture/databases/${owned.index}/tables`, DiagnosticCodes.STORAGE);
      }
    }
    if (descriptor.storage.store && !stores.has(component.id)) push(path, DiagnosticCodes.STORAGE);
  });
}

/** Endpoints of a service, operations of an external; a placeholder exposes its configured `interface`. */
function exposed(component: ComponentInstance, descriptor: ModelDescriptor | undefined): ReadonlySet<string> {
  if (!descriptor) return new Set();
  if (descriptor.placeholder) {
    const configured = field(component.configuration, "interface");
    return new Set(Array.isArray(configured) ? configured.filter((item): item is string => typeof item === "string") : []);
  }
  return new Set(component.kind === "service" ? descriptor.endpoints : component.kind === "external" ? descriptor.operations : []);
}

function field(configuration: CanonicalValue, name: string): CanonicalValue | undefined {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return undefined;
  return (configuration as Readonly<Record<string, CanonicalValue>>)[name];
}

function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
