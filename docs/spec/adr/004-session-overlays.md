# ADR-004: Session overlays on packaged lessons

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-31 |
| Scope | Application boundary, worker protocol, scenario composition; contracts and implementation follow in #94, #95, #97 |
| Related issues | #93, #94, #95, #96, #97, #104 |

## Context

The vision's activity loop is DESIGN → RUN → OBSERVE → BREAK → INSPECT →
EXPLAIN → MODIFY → RUN AGAIN ([vision §12](../../vision.md#12-product-experience)).
Students or instructors inject faults ([vision §16](../../vision.md#16-failure-injection)),
and the same architecture, scenario, configuration, and seed must give the same
execution ([vision §15](../../vision.md#15-deterministic-simulation)).

Today every fault and every design value is fixed inside a packaged document.
The worker accepts only exact packaged documents
([application boundary](../application-boundary.md#packaged-scenario-hosting)),
so the only "modify" step is loading the paired variant. The fault engine
forbids dynamic rule edits, and the scenario engine requires an interactive
fault edit to produce a new scenario input, not to change the current run
([fault engine](../fault-engine.md), [scenario engine](../scenario-engine.md)).
The main thread must not import runtime factories, `ScenarioEngine`, or
mutation ports.

Students need a sanctioned way to change a session's inputs that keeps those
guarantees. Architecture §40 requires an ADR because the change touches
deterministic execution, the host's accepted inputs, and the worker protocol.

In this ADR a **packaged lesson** is any packaged scenario document the host
accepts: the two checkout documents and the ten commerce lessons.

## Decision

### Session overlay

A **session overlay** is a small, declarative delta a student composes for one
packaged lesson. It has three parts:

- **Fault rules**: `FaultRule` values, unchanged from the fault engine.
- **Scheduled faults**: scenario actions of kind `fault`, so each one carries
  its virtual time `at` and a `ScheduledFault` (crash or external availability).
- **Parameter overrides**: `{ key, value }` pairs for parameters that the
  lesson declares.

The issue calls the third part "configuration overrides". This ADR names it
**parameter overrides** because `configuration` already means
`RunInputs.configuration` (start time, history limit, visibility, model
configuration). An overlay can never change `RunInputs.configuration`. A
student cannot change the history limit, and cannot loosen visibility or
redaction.

An overlay cannot add, remove, or edit assertions, client workload, service
lifecycle actions, external behavior, topology, the seed, or the start time.
Restoring a crashed service, choosing a seed, and assertion editing are deferred.

### Lesson overlay policy (allow-list)

Each packaged lesson may declare a **lesson overlay policy**. The policy is data,
kept beside the packaged documents in the data-only modules
`packages/catalogs/src/scenarios.ts` and
`packages/catalogs/src/commerce/scenarios.ts`. The main thread can then render
the Break and Design choices panels from the same data that the worker enforces.
A lesson without a policy accepts only the empty overlay.

The policy declares:

- **Allowed fault rules**: a list of `{ point, effects }` pairs. A student rule
  is allowed only when its `point` and `effect.kind` appear together, for
  example `network.response` with `drop` and `delay`. The fault engine's own
  point and effect compatibility still applies.
- **Allowed scheduled faults**: the `ScheduledFault` kinds a student may
  schedule (`crash`, `external-availability`).
- **A fault entry limit**: the maximum combined number of student fault rules
  and scheduled faults.
- **Parameters**: each has a stable `key`, a typed value domain, a default,
  and one or more targets.

A parameter value domain is one of:

- `boolean`
- `integer`, with inclusive safe-integer `minimum` and `maximum`
- `choice`, with a nonempty list of strings

A parameter target names one location in the packaged document by stable
identity, never by array index:

| Target kind | Location |
| --- | --- |
| `component` | `architecture.components[id = component].configuration[field]` |
| `link` | `architecture.links[source, target].policy[field]`, where `field` is a `NetworkPolicy` key |
| `destination` | `architecture.destinations[id = destination][field]`, where `field` is a numeric `DestinationDefinition` key |
| `action` | `actions[id = action].data[field]` for a client action |

The policy is trusted catalog data. Catalog tests (OVL-AC-6) check that each
target resolves to exactly one existing location, that the packaged value at
every target equals the parameter default, that defaults lie in their domain,
that no two parameters share a target, and that no packaged ID starts with the
student prefix. The worker resolves the policy from its own catalog after the
packaged document has matched. It never accepts a policy from a command.

Presentation copy (labels, consequence hints) is UI data keyed by lesson and
parameter key. It is not part of the policy contract and makes no outcome claim.

### Validation

The worker validates in this order, and stops at the first stage that fails:

1. **Command shape.** `load` matches the protocol, otherwise
   `INVALID_WORKER_COMMAND`.
2. **Packaged document.** `scenario` is canonically equal to a packaged lesson,
   otherwise `INVALID_SCENARIO` (unchanged).
3. **Overlay against the policy.** The worker checks the overlay schema, unknown
   or duplicate parameter keys, value types and ranges, allowed point and effect
   pairs, allowed scheduled-fault kinds, and the entry limit. Every student fault
   rule ID, scheduled-fault action ID, and `ScheduledFault` ID must start with
   `student-`. Failures return `INVALID_OVERLAY`.
4. **Applied document.** The worker applies the overlay, then runs the unchanged
   `ScenarioEngine.validate` on the result. This covers references, time windows
   at or after `startTime`, probability bounds, ID uniqueness, and overlapping
   duplicate rules. A diagnostic inside an overlay-originated entry or a
   parameter target is translated to an overlay path and returned as
   `INVALID_OVERLAY`. Any other diagnostic is a catalog defect and returns
   `INVALID_SCENARIO`.

`INVALID_OVERLAY` context is `{ diagnostics: ScenarioDiagnostic[] }`. Paths are
JSON pointers into the submitted overlay, for example `/faults/0/effect/kind`,
`/scheduledFaults/1/at`, or `/parameters/0/value`. Diagnostics are sorted by
path, then code. Overlay-specific codes are `OVERLAY_NOT_ALLOWED`,
`OVERLAY_ID_PREFIX`, `OVERLAY_LIMIT`, `UNKNOWN_PARAMETER`, and
`PARAMETER_VALUE`. Translated scenario codes, such as `FAULT`, `DUPLICATE`,
`UNKNOWN_COMPONENT`, and `BEFORE_START`, keep their existing names.

Validation is pure, like `ScenarioEngine.validate`. It creates no model, uses
no simulation identity, and draws no randomness. A rejected `load` follows the
existing atomic rule: no old session stays exposed. The main thread keeps the
student's draft, so the student can correct it and load again.

### Applying an overlay

Applying an overlay is a pure function of the packaged document, its policy, and
the normalized overlay. It runs in the worker, before `ScenarioEngine.create`.

1. **Normalize.** An absent overlay is the empty overlay. Fault rules keep their
   declared order and receive the fault engine's defaults (probability 1,
   maxApplications 1). Scheduled faults keep their declared order. Parameter
   overrides are sorted by key. An override equal to its default is removed, so
   equal applied documents have one overlay identity.
2. **Compose.**
   - `faults` = packaged faults, then overlay fault rules.
   - `actions` = packaged actions, then overlay scheduled faults.
   - Each parameter override replaces the value at every target of that parameter.
   - Every other field of the document is unchanged, including `name`, `seed`,
     `startTime`, `external`, `assertions`, and `configuration`.

Appending gives fixed, explainable precedence. At a shared probe, packaged rules
are evaluated and composed before student rules. At equal virtual time,
packaged actions dispatch before student scheduled faults, because declared
order breaks ties. A student rule with a probability strictly between 0 and 1
draws from the session's single seeded stream. It can therefore shift later
random outcomes in the same run. The result is still a deterministic function
of the overlay and the seed. The UI says that such a rule "uses the session seed".

The applied document becomes `RunInputs.scenario` through the normal
`ScenarioEngine.create` path. The kernel, runtime models, and fault engine are
unaware of overlays. The pure overlay validation and application belong to the
scenario application layer (`@distlab/scenario`). Only the worker composition
root and headless tools call them. The main thread never imports them, and it
never sends an applied document.

The overlay never edits assertions. The packaged assertions are evaluated
against the overlaid run, and they may report FAIL. Such a result means the
change altered the lesson's story, not that the simulator failed. Separating
business invariants from scenario expectations belongs to #96.

### Worker protocol

The overlay crosses the boundary as an optional field on the existing `load`
command. Protocol version 1 is kept. The two ends ship in one bundle, and a
worker without this field rejects it as an unknown key instead of ignoring it.

```ts
type WorkerCommand =
  | { version: 1; requestId: string; type: "load"; scenario: CanonicalValue;
      overlay?: CanonicalValue }
  | /* run, pause, step, reset: unchanged */;

type WorkerEvent =
  | { version: 1; requestId: string; type: "loaded";
      projection: RuntimeProjectionSet; session: SessionIdentity }
  | /* other events: unchanged */;
```

`overlay` is typed as `CanonicalValue` at the transport, like `scenario`, and is
validated into a `SessionOverlay` in the worker. `loaded.session` returns the
normalized overlay the worker actually applied. The main thread displays that
value, not its draft. No new command is added. `run`, `pause`, `step`, and
`reset` are unchanged and take no overlay.

### Deterministic identity and display

The deterministic identity of a session is the pair (packaged lesson name, normalized
overlay). The lesson name carries its version, for example `retry-unsafe@1`, and
fixes the architecture, scenario, configuration, and seed. The applied document
is a pure function of that pair. It enters `RunInputs.scenario`, so the existing
input-derived `runId` (a SHA-256 digest of the canonical normalized inputs) already
distinguishes overlaid runs. It is unchanged for the empty overlay. No new
observation type is added. Provenance in Recorded history comes from the
required `student-` ID prefix, which appears in `fault.rule.matched`,
`fault.effect.selected`, `fault.applied`, and `scenario.action.dispatched`.

The run header shows:

- the lesson title and seed
- every applied parameter that differs from its default, for example
  `idempotency=on · timeout=40`
- the number of student faults
- a short form of `runId`

Equal `runId` values mean equal inputs. The Break panel shows student faults
as removable chips. When the draft differs from the applied overlay, the panel
says that the draft is not applied yet and that applying it replaces the
session. Exports for #97 carry the `SessionIdentity` and `runId`.

### Load, Reset, and Compare

- **Apply is Load.** The student edits a draft overlay as UI state. Editing is
  available whenever Load is available: no command is outstanding and the
  simulation is not running. Applying sends `load` with the packaged
  document and the draft. This replaces the session and starts from the
  lesson's start time. An overlay is never applied to a run in progress.
- **Reset replays.** `reset` reconstructs the packaged document with the applied
  overlay. It produces the same `RunInputs`, `runId`, and history. Reset never
  applies the draft. Removing every fault and override and applying gives the
  packaged lesson exactly.
- **Choosing another lesson** starts from an empty draft.
- **Compare** loads the paired packaged lesson and carries the overlay as
  follows. It keeps every student fault entry. It keeps a parameter override
  only when the paired lesson declares the same key with the same value domain
  and the same default. It drops overrides for keys whose defaults differ, since
  those keys are the design choice the pair compares, and for keys the paired
  lesson does not declare. The main thread computes the carried overlay from the
  data-only policies and sends an ordinary `load`. It lists what was dropped, and
  no override is removed silently. If the paired lesson's policy rejects a
  carried fault, the load fails with `INVALID_OVERLAY` like any other load.
- **Presets.** A lesson may present its pair as a preset, a named set of
  parameter values, only when applying the preset gives a document canonically
  equal to the paired packaged document. Current pairs differ in assertions
  until #96, so Compare keeps loading the paired packaged document.
- **Assessment (#97)** runs each suite row as a fresh `load` of a base lesson
  with an overlay. The overlay holds the row's faults and the student's
  parameters. No further command is needed.

## Contract types

The follow-up implementation adds these shapes to `@distlab/contracts` in a new
module `packages/contracts/src/overlay.ts`, exported from the package index. It
also extends `WorkerCommand` and `WorkerEvent` in `application.ts` as shown
above. The shapes reuse existing fault and scenario types instead of
redeclaring them.

```ts
type OverlayScheduledFault = Extract<ScenarioAction, { kind: "fault" }>;

interface ParameterOverride {
  readonly key: string;
  readonly value: CanonicalValue;
}

interface SessionOverlay {
  readonly version: 1;
  readonly faults: readonly FaultRule[];
  readonly scheduledFaults: readonly OverlayScheduledFault[];
  readonly parameters: readonly ParameterOverride[];
}

type LessonParameterDomain =
  | { readonly type: "boolean"; readonly default: boolean }
  | { readonly type: "integer"; readonly default: number;
      readonly minimum: number; readonly maximum: number }
  | { readonly type: "choice"; readonly default: string;
      readonly choices: readonly string[] };

type LessonParameterTarget =
  | { readonly kind: "component"; readonly component: ComponentId; readonly field: string }
  | { readonly kind: "link"; readonly source: ComponentId; readonly target: ComponentId;
      readonly field: keyof NetworkPolicy }
  | { readonly kind: "destination"; readonly destination: string;
      readonly field: "deliveryDelay" | "ackTimeout" | "retryDelay" | "maxAttempts" | "capacity" }
  | { readonly kind: "action"; readonly action: string; readonly field: string };

interface LessonParameter {
  readonly key: string;
  readonly domain: LessonParameterDomain;
  readonly targets: readonly LessonParameterTarget[];
}

interface LessonFaultAllowance {
  readonly rules: readonly {
    readonly point: FaultPoint;
    readonly effects: readonly FaultEffect["kind"][];
  }[];
  readonly scheduled: readonly ScheduledFault["kind"][];
  readonly maxEntries: number;
}

interface LessonOverlayPolicy {
  readonly version: 1;
  /** Packaged scenario `name`, for example "retry-unsafe@1". */
  readonly lesson: string;
  readonly faults: LessonFaultAllowance;
  readonly parameters: readonly LessonParameter[];
}

interface SessionIdentity {
  readonly lesson: string;
  readonly seed: string;
  readonly overlay: SessionOverlay;
}
```

The student ID prefix (`student-`) and the overlay diagnostic codes are
exported as constants beside these types. Presets and Compare carry rules
are main-thread functions over this data. They add no contract type.

## Required tests

The implementation must pass these tests. #94 and #95 implement them, and #97
reuses OVL-AC-2 for its export equality.

- **OVL-AC-1 Empty-overlay equivalence.** Run every packaged lesson three ways:
  with no overlay, with an explicit empty overlay, and with every declared
  parameter set to its default. All three give an applied document canonically
  equal to the packaged document, the same `runId`, and a complete export (state,
  history, assertion results, counters, digest) equal to the packaged run. The
  existing golden digests do not change.
- **OVL-AC-2 Overlay replay.** Each lesson with a policy has a fixture overlay.
  Where the policy allows them, it has at least one fault rule with a
  probability strictly between 0 and 1, one scheduled fault, and one non-default
  parameter. Two fresh worker sessions loaded with the same lesson and overlay
  give canonically equal exports and equal `runId`. Reset of one session also
  gives an equal export, and so does a run under different `maxEvents` and
  step cadence.
- **OVL-AC-3 Sensitivity and provenance.** Changing any single overlay field
  changes `runId`. Overlay-originated fault and action observations carry
  `student-` IDs. At a shared probe, packaged rules appear before student rules
  in `fault.rule.matched` order.
- **OVL-AC-4 Atomic validation.** Each overlay diagnostic code has a rejection
  test. A rejected load creates no session, draws no randomness, and returns
  overlay-relative paths sorted by path, then code. A disallowed effect and a
  missing ID prefix are rejected before the overlay is applied.
- **OVL-AC-5 Boundary.** The main thread sends only an exact packaged document
  and an overlay. `tests/boundaries.test.ts` proves that the main thread imports
  policies only from data-only modules and never imports overlay application
  code. The worker takes the policy from its own catalog.
- **OVL-AC-6 Policy integrity.** Catalog tests check every policy against its
  packaged document: each target resolves exactly once, each default equals the
  packaged value and lies in its domain, targets are disjoint, no packaged ID
  uses the student prefix, and every declared preset reproduces its paired
  document.

## Alternatives considered

- **Main thread sends the applied document.** Rejected. The host would have to
  accept arbitrary documents, and the main thread would need merge code. A
  forged document could not be told apart from a lesson.
- **A new `configure` command that rebuilds the current session.** Rejected. It
  is a second construction path beside `load`. It creates a "loaded, overlay
  pending" state and makes the meaning of Reset ambiguous.
- **`reset` carries the overlay.** Rejected. Reset must replay identical inputs
  ([ADR-001](001-deterministic-execution.md)). If Reset could change inputs, it
  could no longer serve as the determinism check.
- **Policy or overlay inside the scenario document.** Rejected. It changes
  `ScenarioDefinition`, rejects unsupported fields, and alters every packaged
  document and golden digest.
- **Address parameters by JSON pointer.** Rejected. Array indexes are brittle
  when catalogs change, and a free pointer could reach assertions, the seed,
  or visibility.
- **An `overlay.applied` observation.** Rejected. Inputs are not modeled
  execution. `runId` and ID provenance already identify the change, and the
  observation would add records that the empty-overlay test must special-case.
- **Keep the old session when an overlay is rejected.** Rejected for now. The
  current shell treats every failed load the same way, and keeping the draft on
  the main thread gives the same recovery.
- **Edits mid-run.** Rejected by the fault engine ("no dynamic rule edits") and
  by the issue's scope.

## Consequences

- Students can break and modify a lesson themselves. Every run is still a
  reproducible experiment: the same lesson, overlay, and seed give the same
  history.
- The host rule changes from "exact packaged documents only" to "an exact
  packaged document plus an overlay that the lesson's policy allows". Runtime
  packages and the kernel are unchanged. The dependency direction is unchanged.
- Packaged assertions can FAIL under an overlay. The UI must not present that
  as a broken simulator. #96 gives the presentation for it.
- Restoring a crashed service is not an overlay capability. A lesson that wants
  crash and recovery must keep packaging the restart actions.
- Fault IDs written by students are visible in Recorded history and exports.
  They are canonical data, so they follow the existing visibility policy.

## Verification and traceability

OVL-AC-1 to OVL-AC-6, APP-AC-5 to APP-AC-7, and the existing FAULT-AC-5 and
SCENARIO-AC-5 verify this decision. It serves the vision's activity loop (§12),
reproducibility (§15), and failure injection (§16). It adds no simulation semantics
and refines only the application boundary, as architecture §40 requires.

## References

- [Application boundary](../application-boundary.md)
- [Fault Engine](../fault-engine.md), [Scenario Engine](../scenario-engine.md)
- [ADR-001](001-deterministic-execution.md), [ADR-002](002-runtime-model-semantics.md),
  [ADR-003](003-boundary-counters.md)
- [Architecture: change policy](../../architecture.md#40-architectural-change-policy)
- [Vision](../../vision.md)
