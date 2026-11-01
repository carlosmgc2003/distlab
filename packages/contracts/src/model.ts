import type { ComponentId } from "./kernel/identities.js";
import type { DatabaseDefinition } from "./database.js";
import type { LessonParameterDomain } from "./overlay.js";
import type { ComponentKind } from "./scenario.js";

/**
 * Catalog model descriptors (docs/spec/adr/005-architecture-editor.md).
 * Data only: a descriptor states a model's whole interface so that wiring can
 * be offered and validated without running model code.
 */

/** A named outbound dependency of a model. Not a kernel port. */
export interface ModelPeer {
  /** Also the configuration field that holds the bound component ID. */
  readonly name: string;
  readonly kinds: readonly ("service" | "external")[];
  /** Endpoints for a service peer, operations for an external peer. */
  readonly calls: readonly string[];
  /** Bound component when the configuration omits the field. */
  readonly default: ComponentId;
}

/** A behavior option. */
export interface ModelOption {
  /** Also the configuration field that holds the value. */
  readonly key: string;
  readonly domain: LessonParameterDomain;
}

export interface ModelStorage {
  readonly database?: { readonly tables: DatabaseDefinition["tables"] };
  readonly store?: true;
}

export interface ModelDescriptor {
  readonly model: string;
  readonly version: string;
  readonly kind: ComponentKind;
  readonly actions: readonly string[];
  readonly endpoints: readonly string[];
  readonly consumers: readonly string[];
  readonly operations: readonly string[];
  readonly publishes: readonly string[];
  readonly peers: readonly ModelPeer[];
  readonly storage: ModelStorage;
  readonly options: readonly ModelOption[];
  /** Placeholder models read their endpoints or operations from `configuration.interface`. */
  readonly placeholder?: true;
}
