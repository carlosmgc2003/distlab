# MVP Application Boundary Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-21 |
| Related issues | #3 |

## Responsibility

The MVP application composes contracts, runtime models, scenario/catalog code,
and a browser UI without changing simulation semantics. The headless host and
the browser worker expose read-only projections and command/event messages; they
never expose mutable model handles to React components.

## Package and dependency direction

The dependency direction is:

```text
@distlab/contracts
  <- kernel/runtime model packages
  <- catalog/scenario application package
  <- browser worker host
  <- React + React Flow UI
```

No kernel or runtime package imports catalogs, scenario authoring, browser APIs,
React, React Flow, or assessment UI. The UI may depend on application-level
message contracts and projection types, but can control a run only by sending
worker commands.

React plus React Flow is the MVP presentation stack. React Flow positions and
selection state are host/UI state and must not enter `RunInputs`, scheduling,
randomness, assertions, or canonical history.

## Read-only projections

```ts
interface ComponentNodeProjection {
  readonly id: ComponentId;
  readonly kind: "client" | "service" | "external" | "infrastructure";
  readonly label: string;
  readonly model?: string;
  readonly version?: string;
}
interface ArchitectureProjection {
  readonly components: readonly ComponentNodeProjection[];
  readonly links: readonly { readonly source: ComponentId; readonly target: ComponentId; readonly label?: string }[];
}
interface SimulationProjection {
  readonly runId: RunId;
  readonly status: SimulationStatus;
  readonly time: SimulationTime;
  readonly pendingEvents: number;
  readonly processedEvents: number;
  readonly randomDrawCount: number;
}
interface ExecutionHistoryProjection { readonly observations: readonly Observation[]; }
interface ComponentStateProjection {
  readonly componentId: ComponentId;
  readonly state: CanonicalValue;
  readonly visibility: "student" | "assessment" | "host";
}
interface RuntimeProjectionSet {
  readonly architecture: ArchitectureProjection;
  readonly simulation: SimulationProjection;
  readonly history: ExecutionHistoryProjection;
  readonly components: readonly ComponentStateProjection[];
}
```

Projection objects are canonical, detached, and frozen by value. They omit
operation handles, generator state, writable databases, scheduler controllers,
random state internals, and live callbacks. `randomDrawCount` is an observable
counter only; it cannot reveal or advance the generator. React Flow positions
and selection remain UI-owned state and are excluded from every projection.
Authorized projections may reveal more detail to assessment than the student UI,
but neither projection can
schedule events, mutate state, complete operations, or consume randomness.

Selecting an interactive fault in the UI creates or loads recorded scenario
inputs (`actions` or `faults`) and then constructs/resets a run from those inputs.
It must not invisibly mutate a running simulation.

## Browser worker protocol

Commands and events are versioned discriminated unions. Each command carries a
host-generated `requestId`; every terminal response echoes it.

```ts
type WorkerCommand =
  | { version: 1; requestId: string; type: "load"; scenario: CanonicalValue }
  | { version: 1; requestId: string; type: "run"; maxEvents?: number }
  | { version: 1; requestId: string; type: "pause" }
  | { version: 1; requestId: string; type: "step" }
  | { version: 1; requestId: string; type: "reset" };

type WorkerEvent =
  | { version: 1; requestId: string; type: "accepted" }
  | { version: 1; requestId: string; type: "loaded"; projection: RuntimeProjectionSet }
  | { version: 1; requestId?: string; type: "projection.updated"; projection: RuntimeProjectionSet }
  | { version: 1; requestId: string; type: "run.finished"; status: "PAUSED" | "COMPLETED" | "FAILED" }
  | { version: 1; requestId: string; type: "error"; error: ApplicationError };
```

`load` validates and constructs a new session. `run` processes event boundaries
until completion, pause, failure, or the optional event limit. `pause` requests a
boundary pause and does not finalize assertions. `step` processes at most one
scheduled event. `reset` reconstructs the current loaded scenario with the same
normalized inputs.

The worker emits projection updates only after initialization, after event
boundaries, reset, completion, or failure. It may coalesce updates, but it must
not publish projections from the middle of a handler or controlled operation.
Host notification cadence cannot affect scheduling, time, random draws, or
assessment.

## Error handling

Application errors are canonical:

```ts
interface ApplicationError { readonly code: string; readonly message: string; readonly context: CanonicalValue; }
```

Invalid commands return `INVALID_WORKER_COMMAND`. Invalid scenario input returns
`INVALID_SCENARIO`. Runtime terminal failures return `SIMULATION_FAILED` with the
simulation error context. A failed subscriber or UI render path is host-only and
cannot alter canonical history.

## Deferred capabilities

The MVP does not include a general architecture editor, YAML authoring format,
save/load persistence, rewind, full snapshots, server execution, collaborative
sessions, or direct mutation from inspectors.

## Acceptance coverage

- **APP-AC-1:** Worker commands and events match the protocol and are versioned.
- **APP-AC-2:** Projections are detached read-only values with no mutation ports.
- **APP-AC-3:** UI fault selection records scenario inputs before construction or
  reset; it does not alter a live run invisibly.
- **APP-AC-4:** Runtime packages have no React, React Flow, browser, catalog, or
  scenario dependencies.

## References

- [Shared contracts](contracts.md)
- [Scenario Engine](scenario-engine.md)
- [Observability](observability.md)
