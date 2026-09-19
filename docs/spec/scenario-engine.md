# Scenario Engine Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`ScenarioEngine` validates and compiles a reproducible experiment into normalized
run inputs, runtime construction, and ordered initial events. It is an
application-layer adapter independent of the UI; the kernel does not interpret
scenario documents. Assessment evaluates properties through a separate read port.

## Architectural alignment and decisions

This refines [architecture §§28–30](../architecture.md#28-scenario-engine) and
[vision §19](../vision.md#19-scenarios). [ADR-002](adr/002-runtime-model-semantics.md)
fixes setup ordering and assertion boundaries. Runtime code follows
[ADR-001](adr/001-deterministic-execution.md). YAML parsing, UI editing, grading
rubrics, full snapshots, and mid-run input edits are outside this baseline.
There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §28: complete experiment | Public API | SCENARIO-AC-1, SCENARIO-AC-2 |
| Architecture §29: invariants/eventual properties | Operation semantics and errors | SCENARIO-AC-3 |
| Architecture §37: no UI dependency | Invariants | SCENARIO-AC-4 |

## Public API

`RunInputs`, `CanonicalValue`, and identifiers follow [contracts](contracts.md).
Time comes from [Virtual Clock](virtual-clock.md); Simulation comes from
[Simulation Core](simulation-core.md). Fault types come from [Fault Engine](fault-engine.md).

```ts
interface ComponentInstance {
  id: ComponentId;
  kind: "client" | "service" | "external";
  model: string;
  version: string;
  configuration: CanonicalValue;
}
interface ArchitectureDefinition {
  components: readonly ComponentInstance[];
  links: readonly { source: ComponentId; target: ComponentId;
    policy: NetworkPolicy }[];
  databases: readonly DatabaseDefinition[];
  stores: readonly KeyValueDefinition[];
  destinations: readonly DestinationDefinition[];
  subscriptions: readonly { destination: string; consumer: ComponentId }[];
}
type ScenarioAction =
  | { id: string; at: SimulationTime; kind: "client"; target: ComponentId;
      action: string; data: CanonicalValue }
  | { id: string; at: SimulationTime; kind: "service"; target: ComponentId;
      state: ServiceState }
  | { id: string; at: SimulationTime; kind: "external"; target: ComponentId;
      state: ExternalAvailability }
  | { id: string; at: SimulationTime; kind: "external-behavior"; target: ComponentId;
      operation: string; behavior: ExternalBehavior }
  | { id: string; at: SimulationTime; kind: "fault"; fault: ScheduledFault };
interface ScenarioAssertion {
  id: string;
  predicate: string;
  parameters: CanonicalValue;
  mode: "always" | "at" | "eventually";
  at?: SimulationTime;
  deadline?: SimulationTime;
}
interface ScenarioDefinition {
  version: 1;
  name: string;
  seed: string;
  architecture: ArchitectureDefinition;
  startTime: SimulationTime;
  external: readonly { target: ComponentId; operation: string;
    behavior: ExternalBehavior }[];
  faults: readonly FaultRule[];
  actions: readonly ScenarioAction[];
  assertions: readonly ScenarioAssertion[];
  configuration: RunInputs["configuration"];
}
interface ScenarioDiagnostic { path: string; code: string; }
interface AssertionResult {
  id: string;
  status: "PENDING" | "PASS" | "FAIL" | "INCOMPLETE";
  time: SimulationTime;
  evidence: CanonicalValue;
}
interface ScenarioSession {
  readonly simulation: Simulation;
  results(): readonly AssertionResult[];
}
interface ScenarioEngine {
  validate(input: CanonicalValue): readonly ScenarioDiagnostic[];
  create(input: CanonicalValue): ScenarioSession;
}
```

Referenced model definitions live in their respective component specs. The
composition root injects versioned catalogs, a composed `SimulationFactory`,
runtime factories, and an assessment port. Assessment predicates resolve by
stable ID/version, return a boolean plus canonical evidence, and receive only
detached authorized state/history projections. They cannot schedule or mutate.
No runtime/kernel package imports scenario types, catalogs, assessment, or UI.

### Operation semantics and errors

`validate` is pure: normalize and validate schema/cross-references without
creating models, allocating simulation identities, invoking behavior handlers,
or consuming randomness. Return diagnostics sorted by JSON-pointer path then
code. Normalization supplies startTime 0, empty optional lists, and shared
configuration defaults; if both startTime locations are supplied they must agree.
Model-specific defaults are documented by those model schemas. Unsupported
fields are rejected; arrays retain declared order, never sorted for convenience.
The TypeScript interfaces show the normalized form.

Check unique component/resource/destination/action/assertion/fault IDs, explicit
component categories, exact catalog versions, single DB/KV ownership per service,
link endpoints, subscription handlers, operation/action names, canonical data,
initial state constraints, and fault applicability. Reject actions before start,
unknown predicates, and invalid assertion timing. `at` mode requires only `at`;
eventually requires only deadline; always accepts neither. All supplied times
must be at or after start. Seed is a nonempty string; the conceptual numeric YAML
seed in the architecture must be explicitly converted by an import adapter.

`create` performs the same validation and throws `INVALID_SCENARIO` with ordered
diagnostics on failure, returning no partial session. Resolve trusted definitions
by version, build canonical `RunInputs` including normalized architecture,
scenario, configuration, seed, and every runtime/predicate version. Build all
handlers/schemas before scheduling. Register shared schemas such as runtime.log
once. Construct fresh models on each factory initialization/reset, apply initial
provider behaviors without runtime change events, and load DB/KV initial state.
Resources iterate architecture array order; initial KV expirations use key order.
After resource initialization events, schedule actions in declared array order,
then assertion markers in assertion order. Scheduler time determines dispatch;
array order breaks equal-time ties. Services begin STARTING and need explicit
RUNNING actions before client traffic. Validation checks state vocabulary;
illegal transitions discovered during execution are terminal model errors.

Actions delegate through trusted runtime controllers inside scheduled events.
User data cannot carry handler closures or arbitrary event types. Client actions
create their own roots; administrative actions may be untraced and use the
event-start observation as cause. An interactive fault edit must produce a new
scenario/run input, not mutate the current run outside its recorded action list.

Assessment runs once after initialization and after each complete kernel event
boundary, including synchronous controlled continuations. It does not subscribe
through host notification callbacks. An injected kernel boundary-read hook must
not import assessment code or expose mutation; [ADR-002](adr/002-runtime-model-semantics.md)
defines this addition. No boundary can be observed halfway through a local commit.

An always assertion fails on the first false predicate and otherwise remains
PENDING until normal completion, when it passes. An at assertion schedules a
marker and evaluates at that marker's boundary. An eventually assertion passes
on the first true boundary at or before its deadline; otherwise its deadline
marker fails it. Markers at equal times observe only preceding scheduler events
plus their own boundary, not future same-time events. Therefore deadline truth
must hold by the marker's sequence. This is an explicit bounded eventuality,
not a claim about all future time. Conditional eventual properties require a
versioned predicate that tracks obligations in assessment-owned state.

Assertion failure is a result, not a simulator failure, and does not stop
execution. Predicate exceptions/invalid results are terminal
`INVALID_ASSESSMENT_RESULT`. Event-limited or host-paused runs retain PENDING
results; terminal simulator failure converts unresolved results to INCOMPLETE.
Even prior PASS results cannot make a failed/incomplete history a passing run.
`results` returns detached snapshots and never runs predicates. No aggregate
grading score is computed here. Resuming execution keeps assessment state;
reset rebuilds it and the session facade resolves to the new generation.

## Owned state

Normalized scenario, catalog resolution metadata, session facade, action mapping,
and diagnostic results. The injected assessment component owns assertion status,
obligations, and evidence. Runtime resources own business state; core owns run
control. Reset reuses normalized inputs and recreates all models/assessment
state; old runtime ports are revoked. Definition/session serialization excludes
functions, ports, and suspended tasks and is not a snapshot API.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `scenario.action.dispatched` | Before delegated action | Action ID, kind, target when applicable |
| `scenario.assertion.evaluated` | Predicate evaluated | Assertion ID, verdict, evidence, boundary event when present |

Scenario/assessment adapters own their schemas and record at the boundary in
assertion order, after model observations. Evidence references observed state
and earlier observations, never recursively evaluates its own records. After
the boundary hook returns the kernel makes its normal completion decision.
Terminal failure finalizes INCOMPLETE results without appending to a failed
history sink. Visibility follows [Observability](observability.md); assessment
gets separately authorized state projections when history omits needed data.
Host validation errors, results reads, and playback controls are not canonical
events. Sink failure stops the run without recursive reporting or rollback.

## Invariants

- **SCENARIO-INV-1:** Identical normalized inputs/models yield identical initialization,
  action order, state, assertion results, and history across fresh runs/reset.
- **SCENARIO-INV-2:** Validation is atomic and cannot execute simulation behavior.
- **SCENARIO-INV-3:** Scenario/assessment orchestration never bypasses model ownership.
- **SCENARIO-INV-4:** Eventual claims have explicit finite deadlines and incomplete
  execution never masquerades as assessment success.

## Explicit non-responsibilities

- UI parsing/editing, live topology mutation, grading policy, or prescribed patterns.
- Kernel time advancement, random draws, or direct business-state mutation after setup.
- Snapshot restore, rewind, and real external infrastructure.

## Minimal examples

### Ordered scenario actions

```ts
const actions: readonly ScenarioAction[] = [
  { id: "start-orders", at: simulationTime(0), kind: "service",
    target: "orders", state: "RUNNING" },
  { id: "place-o1", at: simulationTime(0), kind: "client",
    target: "customer", action: "place-order", data: { orderId: "o1" } },
];
// Both are initial events; declared order starts the service before the action.
```

### Bounded eventual result

```text
Predicate order-refunded is false initially: PENDING.
Refund before the deadline marker: PASS.
False at the deadline marker: FAIL.
Simulator fails earlier: INCOMPLETE, never PASS from missing evidence.
```

## Acceptance criteria

- **SCENARIO-AC-1:** Validate normalization/defaults, schema errors, references,
  ownership, model versions, times, assertions, and stable diagnostic ordering;
  no invalid input runs handlers or consumes simulation IDs/randomness.
- **SCENARIO-AC-2:** Create a complete client → service → DB → bus → external
  scenario with initial state, provider behavior, timed faults, and explicit
  startup; verify registration sealing and equal-time declared ordering.
- **SCENARIO-AC-3:** Always/at/eventually assertions observe the stated boundaries;
  test exact-deadline ordering, pending pause, failure, completion, predicate error,
  and history failure with no false aggregate success.
- **SCENARIO-AC-4:** Run without UI; controllers respect ownership and versioned
  catalogs; assessment cannot mutate state or rely on host subscriber timing.
- **SCENARIO-AC-5:** Fresh/reset runs and different host stepping/yield settings
  yield equal state, history, and results; changed seed/input/version changes run
  fingerprint; old runtime handles fail while the session facade reads new results.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| SCENARIO-INV-1 | SCENARIO-AC-2, SCENARIO-AC-5 |
| SCENARIO-INV-2 | SCENARIO-AC-1 |
| SCENARIO-INV-3 | SCENARIO-AC-2, SCENARIO-AC-4 |
| SCENARIO-INV-4 | SCENARIO-AC-3 |
| Construction, validate, create | SCENARIO-AC-1, SCENARIO-AC-2, SCENARIO-AC-4 |
| results, session reset | SCENARIO-AC-3, SCENARIO-AC-5 |
| Action dispatch, boundary assessment | SCENARIO-AC-2–5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Client Runtime](client-runtime.md), [Service Runtime](service-runtime.md)
- [External Service Runtime](external-service-runtime.md), [Observability](observability.md)
