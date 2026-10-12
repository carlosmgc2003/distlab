# Scenario package

`@distlab/scenario` turns a canonical scenario document into a reproducible,
UI-independent simulation session. This reference is for developers tracing
validation, runtime composition, assertion evaluation, and headless replay, or
adding trusted models and predicates.

The [Scenario Engine specification](../spec/scenario-engine.md) defines the
public behavior. Shared document and session shapes come from
[`@distlab/contracts`](../../packages/contracts/src/scenario.ts); kernel inputs,
time, events, and simulation controls come from `@distlab/contracts/kernel`.
Package-local integration types describe catalogs and assessment adapters rather
than redeclaring those shared contracts. Execution and boundary rules follow
[ADR-001](../spec/adr/001-deterministic-execution.md) and
[ADR-002](../spec/adr/002-runtime-model-semantics.md).

## Responsibilities and dependency direction

The package owns normalization, diagnostics, version resolution, canonical
`RunInputs`, initial action scheduling, session access, assessment state, and
headless inspection. Runtime models own business state; the kernel owns virtual
time, event ordering, randomness, controlled tasks, and execution history.

It imports only contracts and kernel implementations. The kernel does not
interpret scenario documents or import scenario assessment. Catalog providers
and application composition roots supply trusted definitions to the engine.
The package does not parse YAML, edit UI state, grade students, restore snapshots,
or mutate a running scenario from host controls.

## Source modules

Every source module under `packages/scenario/src/` is described below.

### `index.ts`: public exports

[`index.ts`](../../packages/scenario/src/index.ts) defines the sole package entry
point; `package.json` exposes no source subpaths.

| Export group | Public names |
| --- | --- |
| Engine | `DeterministicScenarioEngine`, `DeterministicScenarioSession`, `ScenarioEngineOptions` |
| Harness | `openHarness`, `inspectSession`, `compareExports`, `HarnessExport`, `HarnessSession` |
| Normalization | `normalizeScenario`, `Normalization` |
| Catalog and assessment adapters | `ScenarioCatalog`, `ScenarioModel`, `ScenarioPredicate`, `ScenarioAssessment`, `AssessmentProjection` |
| Diagnostics | `DiagnosticCodes`, `DiagnosticCode` |

Types in this table are exported as TypeScript types. `DiagnosticCodes` is a
runtime constant. `startAssessment` and `AssessmentAttempt` are internal module
exports and are not exposed through the package entry point. Import shared
`ScenarioDefinition`, `ScenarioAction`, `ScenarioAssertion`, `ScenarioEngine`,
`ScenarioSession`, and `AssertionResult` from `@distlab/contracts`.

### `types.ts`: trusted integration interfaces

[`types.ts`](../../packages/scenario/src/types.ts) defines the injection seams:

- `ScenarioModel` identifies an exact `model`, `version`, and component `kind`.
  Its `actions`, `endpoints`, `consumers`, and `operations` describe supported
  names; `checks` supplies trusted database row constraints. `instantiate`
  receives a shared `ComponentInstance` and returns a `ClientDefinition`,
  `ServiceDefinition`, or `ExternalDefinition` appropriate to the kind.
- `ScenarioCatalog` has its own `id` and `version`, resolves exact model versions
  with `find(model, version)`, and lists known versions with `versions(model)`.
  Validation uses this metadata without calling `instantiate`.
- `ScenarioAssessment` has a `version` and resolves a predicate by ID with
  `find(id)`. Each `ScenarioPredicate` carries its own `id` and `version` and
  synchronously evaluates `{ parameters, projection }`, returning
  `{ pass: boolean, evidence: CanonicalValue }`.
- `AssessmentProjection` contains `time`, `status`, `history`, `components`,
  `databases`, `stores`, and `messageBus`. State/history values are detached
  canonical data; there are no scheduler, controller, or mutation ports.

`DiagnosticCodes` names schema, canonical-data, version, reference, ownership,
timing, constraint, and fault failures. Shared `ScenarioDiagnostic` retains the
specification's `{ path: string, code: string }` shape.

### `validate.ts`: normalization and diagnostics

[`validate.ts`](../../packages/scenario/src/validate.ts) exposes
`normalizeScenario(input, catalog, assessment): Normalization`. The returned
`diagnostics` are sorted by JSON-pointer path and then code, deduplicated by that
pair, and frozen. A `scenario` is present only when no diagnostics remain.
Validation creates no runtime, allocates no simulation identity, evaluates no
assessment predicate, and draws no randomness. It does invoke trusted database
row checks while validating initial rows; those checks must be deterministic
and free of simulation side effects.

Object readers reject unsupported fields and noncanonical values. Array readers
preserve declared order and normalize omitted lists to empty arrays. JSON-pointer
tokens escape `~` and `/`. The top-level version must be `1`; name and seed must
be nonempty strings. The seed is trimmed and normalized to NFC.

Normalization supplies these defaults:

| Area | Defaults |
| --- | --- |
| Start | Top-level `startTime`, else `configuration.startTime`, else `0`; supplied locations must agree |
| Configuration | `historyLimit: 100000`, visible history with empty `byType` and `summaryFields`, `models: {}` |
| Component | Omitted `configuration` becomes `{}` |
| Network policy | Request/response latency and jitter `0`, timeout `1000`, failure rate `0` |
| Database | Empty initial rows for each declared table; empty unique/check lists |
| KV store | Empty initial list; omitted TTL means no expiration |
| Destination | Delivery/retry delay `0`, ACK timeout `1000`, max attempts `3`, capacity `10000` |
| Fault rule | Probability `1`, max applications `1` |

The readers enforce the following relationships and constraints:

- Components have unique IDs, explicit `client`, `service`, or `external` kinds,
  and exact catalog model versions with matching kinds. Infrastructure is
  declared in architecture resource fields, not as another `ComponentInstance`
  kind. Directed links have known endpoints and no duplicate source/target pair.
- Databases and KV stores are owned by services, with at most one of each per
  service. Tables and initial KV keys are unique. Initial database rows are
  canonical objects, satisfy declared checks and unique tuples, and refer only
  to declared tables. TTLs are positive integer durations.
- Destinations have unique IDs and valid queue/topic policies. Subscriptions
  reference existing destinations and service consumers, have no duplicate pair,
  and match the consumer names declared by the model in both directions.
- Initial external behaviors have unique target/operation pairs, target external
  components, and use catalog operation names. Behavior fields include latency,
  degraded extra latency, response-drop policy, and canonical parameters.
- Actions have unique IDs, valid target kinds, supported client action or external
  operation names, and times at or after the run start. Service and external
  states are checked against their contract vocabularies; legal service
  transitions are enforced during execution.
- Fault IDs are unique across initial rules and scheduled faults. Rule selectors,
  time windows, counts, probabilities, and effects must be valid. Commit faults
  allow `fail`; duplication applies to message delivery; disconnection applies
  to network requests. Overlapping duplicate rules are rejected. Scheduled
  faults support service crashes and external availability changes.
- Assertions have unique IDs, known predicates, canonical parameters, and valid
  timing: `always` accepts neither timing field, `at` requires only `at`, and
  `eventually` requires only `deadline`. Supplied times cannot precede start.

There is no model-specific configuration-schema callback in `ScenarioModel`.
The validator copies component configuration as canonical data; trusted model
definitions are responsible for any additional interpretation. Row-check lookup
currently occurs when initial rows are visited, so an unknown check on an empty
table is not diagnosed by that loop.

### `engine.ts`: creation, scheduling, and the session facade

[`engine.ts`](../../packages/scenario/src/engine.ts) implements the shared
`ScenarioEngine` and `ScenarioSession` interfaces.
`ScenarioEngineOptions` contains `catalog` and `assessment`. Construction
requires nonblank catalog ID/version and assessment version. `validate` returns
normalization diagnostics. `create` repeats the same normalization and throws
`INVALID_SCENARIO` with ordered diagnostics if it fails, returning no session.

The successful composition flow is:

1. Resolve assertion predicates and build canonical `RunInputs`. These include
   normalized architecture/scenario, configuration, seed, contract version, the
   seeded-random algorithm, runtime versions, catalog and assessment versions,
   component model versions, and predicate versions per assertion.
2. Construct `HeadlessSimulationFactory` with network links/targets and optional
   message bus, KV stores, and fault decision port. Attach a synchronous boundary
   hook backed by a fresh assessment attempt.
3. In the initialization callback, clear runtime maps, register scenario
   observation schemas, build service-owned databases, and compose client,
   service, and external runtimes in component array order. Trusted model
   factories supply definitions; initial external behaviors configure providers
   during setup. Build the fault engine when rules or fault actions require it.
4. Register action handlers and the no-op assertion marker handler before
   scheduling scenario work. Resource expirations are armed before action drafts
   in store/key order. Enqueue actions in declared order, followed by assertion
   markers in assertion order.
5. Dispatch through runtime controllers under kernel event ownership, then
   evaluate assertions at complete event boundaries. The kernel decides time
   advancement, completion, pause, and failure.

The current implementation constructs the concrete factory and runtime classes
internally; it does not expose the specification's broader factory-injection
seam through `ScenarioEngineOptions`.

Each action uses an internal `scenario.action.<target>` event with an action ID
payload. The trusted handler resolves the normalized action, records
`scenario.action.dispatched`, and delegates client starts, external availability,
external behavior, or scheduled faults. A service action additionally enqueues
the service runtime's lifecycle event immediately after its dispatch event.
Its state transition therefore has a separate event boundary. Services begin
`STARTING`; put an explicit `RUNNING` action before same-time client traffic.
Time orders events first and insertion sequence breaks ties. Assertion markers
cannot see future same-time events.

The boundary hook evaluates initialization, each completed event, completion,
and failure. After an event it cancels deadline handles for settled assertions.
Assessment is not driven by host notifications. The engine registers strict
schemas for `scenario.action.dispatched` and
`scenario.assertion.evaluated`, using `ScenarioObservationTypes` from contracts.

`DeterministicScenarioSession.simulation` exposes the `HeadlessSimulation`.
`results()` reads detached assertion snapshots without running predicates.
`projection()` reads the current generation's detached component/resource/history
state; databases and stores are keyed by owner, components by component ID, and
an absent bus is `null`. A failed individual inspection is represented as `null`.
Assessment projections use status `RUNNING` at boundary reads; host session
projections use the simulation's actual status. This trusted read surface is not
a student visibility-policy adapter.

Reset recreates runtimes and assessment from normalized inputs and rebinds the
session's internal cell, so the existing facade reads the new generation.
`bindRuntime()` returns a closure over the current setup capability; using that
closure after reset fails with `STALE_CAPABILITY`. It is a generation check,
not a business mutation API.

### `assessment.ts`: assertion state machine

[`assessment.ts`](../../packages/scenario/src/assessment.ts) creates an
`AssessmentAttempt` through `startAssessment`. It owns rows in assertion order,
initially `{ id, status: "PENDING", time: startTime, evidence: null }`, and
receives only predicate definitions, a projection function, and an observation
sink. Its callbacks correspond to initialization, event, completion, and failure
boundaries.

| Mode | Evaluation and settlement |
| --- | --- |
| `always` | Evaluate every boundary while pending; first false becomes `FAIL`; true stays `PENDING` until normal completion makes it `PASS` |
| `at` | Evaluate at its `scenario.assertion` marker and settle `PASS` or `FAIL`; the completion path also settles a still-pending row |
| `eventually` | Evaluate initialization and each boundary while pending; first true becomes `PASS`; false at its deadline marker becomes `FAIL`; completion settles remaining pending rows |

Completed rows are not evaluated again. Pending evaluations also record
observations and update evidence/time. Predicate parameters and evidence are
canonical copies. Exceptions, a missing predicate, a nonobject result, a
nonboolean `pass`, missing evidence, or noncanonical evidence terminate execution
with `INVALID_ASSESSMENT_RESULT`.

An ordinary false predicate changes an assertion result without stopping the
simulation. Pauses and event limits leave unresolved rows pending. Failure
changes only unresolved rows to `INCOMPLETE`, without recording to a failed
history sink; earlier `PASS` or `FAIL` rows remain. Consumers must consider
simulation status as well as rows when judging an entire run. No aggregate score
or passing-run classification is computed here.

Each successful evaluation records `scenario.assertion.evaluated` with assertion
ID, boolean verdict, canonical evidence, and the boundary event ID when present,
then updates the row. Result reads return fresh arrays with frozen rows and copied
evidence. The specification allows conditional eventual obligations in
assessment-owned state. This implementation reuses resolved predicate objects
across reset and exposes no predicate reset hook, so fresh assertion rows alone
do not reset mutable state captured by a predicate. Stateless predicates fit
the current seam directly; stateful obligations need explicit lifecycle support
before they can satisfy reset equivalence.

### `harness.ts`: UI-free controls and replay comparison

[`harness.ts`](../../packages/scenario/src/harness.ts) wraps a concrete session
with `openHarness`. Its `run`, `step`, `pause`, and `reset` methods delegate to
simulation controls; `inspect` and `results` are read operations.

`inspectSession` returns `HarnessExport` with `status`, `time`, canonical `state`,
`history: ExecutionHistoryExport`, assertion `results`, and a SHA-256 `digest`.
The state contains components, databases, stores, and message bus. The digest is
computed from the canonical encoding of the whole export body before adding the
digest field. History is the simulation's existing export, not reconstructed
from presentation records.

`compareExports` compares canonical encodings of both complete exports, including
their digest fields. It supports fresh-run and reset replay checks, without
advancing time or evaluating assertions. A harness export is an inspection
artifact, not a restorable snapshot; suspended tasks and runtime capabilities
are not serialized.

## Extension points and checks

Add a trusted versioned `ScenarioModel` through a `ScenarioCatalog`, with metadata
matching its definition and deterministic row checks. Use modeled network/bus
communication and owned resources inside definitions. Keep catalog lookup and
validation free of runtime construction and random draws.

Add a predicate through `ScenarioAssessment`, returning a boolean and canonical
evidence from detached authorized projections. Version changes must be reflected
in catalog/assessment metadata so `RunInputs` fingerprints describe the behavior
actually loaded. Predicate IDs are resolved by `find(id)`; the selected entry's
version is recorded rather than supplied as a separate assertion field.

New scenario action kinds, document fields, or assertion modes require an update
to the shared specification/contracts plus validator, composition, observation
schemas, and assessment as applicable. They are not open plugin keys. Arbitrary
event types, host closures, mid-run input edits, YAML parsing, grading policy,
and snapshot restoration are outside this package's public extension surface.

Existing validation tests live in
[`validate.test.ts`](../../packages/scenario/tests/validate.test.ts); scenario
composition, boundary assessment, and replay checks live in
[`scenario-engine.test.ts`](../../packages/scenario/tests/scenario-engine.test.ts).
[`dependency.test.ts`](../../packages/scenario/tests/dependency.test.ts) checks
dependency direction. The shared test fixtures are in
[`support.ts`](../../packages/scenario/tests/support.ts).
