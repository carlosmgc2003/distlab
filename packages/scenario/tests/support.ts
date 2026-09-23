import type { ClientDefinition, ExternalDefinition, ServiceDefinition } from "@distlab/contracts";
import type { ComponentInstance } from "@distlab/contracts";
import { DeterministicScenarioEngine, type ScenarioAssessment, type ScenarioCatalog, type ScenarioModel, type ScenarioPredicate } from "@distlab/scenario";

export function predicate(id: string, evaluate: ScenarioPredicate["evaluate"], version = "1"): ScenarioPredicate {
  return { id, version, evaluate };
}

export function assessmentOf(predicates: readonly ScenarioPredicate[], version = "1"): ScenarioAssessment {
  return { version, find: id => predicates.find(item => item.id === id) };
}

export function model(partial: Partial<ScenarioModel> & Pick<ScenarioModel, "model" | "kind"> & { instantiate?: ScenarioModel["instantiate"] }): ScenarioModel {
  const version = partial.version ?? "1";
  return {
    model: partial.model,
    version,
    kind: partial.kind,
    actions: partial.actions ?? [],
    endpoints: partial.endpoints ?? [],
    consumers: partial.consumers ?? [],
    operations: partial.operations ?? [],
    checks: partial.checks ?? {},
    instantiate: partial.instantiate ?? (instance => instantiate(partial.kind, instance)),
  };
}

export function catalogOf(models: readonly ScenarioModel[], version = "1", id = "fixture"): ScenarioCatalog {
  return {
    id,
    version,
    find: (name, modelVersion) => models.find(item => item.model === name && item.version === modelVersion),
    versions: name => models.filter(item => item.model === name).map(item => item.version),
  };
}

export function engineFor(models: readonly ScenarioModel[], predicates: readonly ScenarioPredicate[] = [], versions?: { catalog?: string; assessment?: string }): DeterministicScenarioEngine {
  return new DeterministicScenarioEngine({
    catalog: catalogOf(models, versions?.catalog ?? "1"),
    assessment: assessmentOf(predicates, versions?.assessment ?? "1"),
  });
}

function instantiate(kind: ScenarioModel["kind"], instance: ComponentInstance): ClientDefinition | ServiceDefinition | ExternalDefinition {
  if (kind === "client") return { id: instance.id, version: instance.version, actions: {}, callbacks: {}, initialState: {} };
  if (kind === "external") return { id: instance.id, version: instance.version, operations: {}, initialState: null };
  return { id: instance.id, version: instance.version, endpoints: {}, consumers: {}, background: {} };
}

export const truePredicate = predicate("demo.true", () => ({ pass: true, evidence: null }));
export const falsePredicate = predicate("demo.false", () => ({ pass: false, evidence: null }));

export function baseScenario(extra: Record<string, unknown> = {}) {
  return { version: 1, name: "baseline", seed: "seed", architecture: { components: [] as unknown[] }, ...extra };
}
