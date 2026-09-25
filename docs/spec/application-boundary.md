# MVP Application Boundary Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-24 |
| Related issues | #3, #46, #47 |

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
Timeline filters, the selected observation, and the playback cursor are UI-owned
too. Text filters offer the distinct canonical values already present in the
visible history projection. Exact mode uses the same comparisons as
`ExecutionHistoryReader.query`: inclusive virtual-time bounds, exact type,
component as source or target, exact trace, exact event, and entity kind plus
id on the same reference. Prefix and Contains are explicit, case-sensitive,
read-only projections over that same snapshot. They are not reader queries,
they do not accept a query language, and they never read assessment-only state
or redacted payload fields. Choosing a suggestion applies Exact. Active chips,
removal, result counts, and clear-all change only this UI state. Suggestions
are recomputed from the history snapshot currently shown, including when a run
is replaced. Playback may use a host timer only to move that cursor and to paint a
transient request or message cue. It does not advance virtual time, record
observations, or send worker commands.
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

## Shell action matrix

Browser controls follow the simulation lifecycle. A disabled Run, Pause, Step, or
Reset means that command is unavailable in the current state. The shell does not
add a worker command to stand in for it. Scenario choice and Load replace the
session only when no command is outstanding and the simulation is not running.

Timeline filters, the selected observation, evidence and trace navigation, graph
gestures, and playback stay in the UI. They do not advance virtual time, record
observations, or send worker commands. Restart timeline moves the playback
cursor to the first visible observation and leaves the simulation where it is.

While a command is outstanding, scenario choice, Load, Run, Step, and Reset are
unavailable. Pause stays available only when Run is the sole outstanding command,
and it takes effect at an event boundary.

| Action | Empty | Ready | Running | Paused | Completed | Error |
| --- | --- | --- | --- | --- | --- | --- |
| Scenario choice | Choose a packaged scenario | Choosing a different scenario replaces the session | Unavailable while the run is in progress | Choosing a different scenario replaces the session | Choosing a different scenario replaces the session | Choosing a different packaged scenario loads a fresh session |
| Load scenario | Load the chosen scenario | Replace the session | Unavailable | Replace the session | Replace the session | Load again after a load or worker error. `SIMULATION_FAILED` recovers through Reset |
| Run | Unavailable until a session is loaded | Start the loaded scenario | Unavailable. Pause is the command for a run in progress | Continue from the current boundary | Unavailable because the run has finished. Reset runs the loaded scenario again | Unavailable |
| Pause | Unavailable | Unavailable | Request a pause at the next event boundary | Unavailable | Unavailable because the run is not in progress | Unavailable |
| Step | Unavailable | Process one scheduled event | Unavailable | Process one scheduled event | Unavailable because the run has finished | Unavailable |
| Reset | Unavailable | Reconstruct the loaded scenario | Unavailable | Reconstruct the loaded scenario | Reconstruct the loaded scenario | Available for `SIMULATION_FAILED`, including when history was withheld. Unavailable when no session was loaded |
| Fit, zoom, and pan | Not shown | Change the local viewport | Change the local viewport | Change the local viewport | Change the local viewport | Not shown when the failure withholds the projection |
| Component selection | Not shown | Inspect that component. Escape clears the selection | Inspect that component | Inspect that component | Inspect that component | Not shown when the failure withholds the projection |
| Timeline filters | Not shown | Narrow the visible rows with recorded suggestions. Exact, Prefix, and Contains are labeled. Clear all filters is unavailable when no filter is set | Narrow the rows received so far | Narrow the visible rows | Narrow the visible rows | Not shown when history is withheld |
| Evidence, causation, and trace | Not shown | Select the recorded observation, show its row and detail, and move focus to that row. A filter cleared to reveal it is announced | Same read-only navigation | Same read-only navigation | Same read-only navigation | Not shown when history is withheld |
| Play / Restart | Not shown | Play moves the cursor through visible rows. Zero or one visible row leaves Play unavailable. On the last visible row the control is Restart timeline | Move the cursor only. Playback does not pause or advance the simulation | Move the cursor only | Move the cursor only | Not shown when history is withheld |
| Pause timeline | Not shown | Unavailable until playback is running | Stop the cursor | Stop the cursor | Stop the cursor | Not shown when history is withheld |
| Previous / Next | Not shown | Available only when that direction selects a different visible row | Available only when that direction selects a different visible row | Available only when that direction selects a different visible row | Available only when that direction selects a different visible row | Not shown when history is withheld |

Empty means no session is loaded. Error means a host error is showing. A terminal
`SIMULATION_FAILED` withholds incomplete history, keeps the failure visible, and
still accepts Reset for the loaded scenario. Ready, paused, and completed
projections keep the timeline. Before any row is selected, Next selects the
first visible observation and Previous selects the last, including when the
filter matches one row. After that only row is selected, both controls are
unavailable. Previous is unavailable on the first visible row, and Next is
unavailable on the last.

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
