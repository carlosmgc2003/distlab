# [Component Name] Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | [Name or team] |
| Last updated | YYYY-MM-DD |
| Related issues | [Links or `None`] |

## Responsibility

[State the single responsibility of the component, why it exists, and its
boundary with adjacent components.]

## Architectural alignment and decisions

[Link specific architecture and vision sections. Name the educational scenario
or inspectable behavior this component enables. Distinguish a refinement from a
departure; an API sketch in the architecture is not automatically a final API.]

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| [Specific architecture guarantee or learning outcome] | [Section] | [AC IDs] |

[List unresolved decisions with their impact, or state `None`. Identify deferred
features explicitly. Any change to fundamental semantics listed in architecture
§40 requires an ADR with context, decision, alternatives, and consequences.
Link the ADR and explain any departure; do not silently rewrite architecture.]

## Public API

[Define the public types, operations, inputs, outputs, and errors. Prefer a
language-tagged contract followed by short semantic notes. Define every exposed
type here or link its authoritative definition in the shared contracts. Include
construction, registration, injected ports, and who receives each capability.]

```ts
interface Component {
  // Public operations.
}
```

### Operation semantics and errors

[For every operation specify valid states, validation, mutation/observation order,
return or rejection behavior, and effects of invalid input. Include concurrency,
reentrancy, completion, cancellation, and capacity exhaustion when applicable.
Distinguish modeled failures from terminal simulator errors. If tasks suspend,
define their ownership, resumption order, and exact execution boundary.]

## Owned state

[List only state for which this component is the source of truth. Describe its
initial value, reset behavior, and serialization requirements. State `None` if
the component is stateless.]

[Specify copying/aliasing and canonical serialization rules. Explain which IDs
reset, whether old capabilities are revoked, and how reset equals fresh creation.
Do not imply a complete snapshot from serialization of only this component.]

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `component.event` | [Emission condition] | [Deterministic fields] |

[State `None` when the component emits no events, and explain how callers
observe its results instead.]

[Classify canonical records versus host-only notifications. Define correlation
propagation, schema ownership, payload visibility, and state-change evidence.
Specify behavior when observation recording fails; failure reporting must not
recurse through a failed sink. Playback controls must not change canonical history.]

## Invariants

- **INV-1:** [Property that must always hold.]
- **INV-2:** [Determinism, ordering, ownership, or isolation rule.]

## Explicit non-responsibilities

- [Behavior this component deliberately does not implement.]
- [Responsibility owned by another named component.]

## Minimal examples

### [Example name]

```ts
// Smallest example that demonstrates normal behavior.
```

### [Boundary or failure example]

```ts
// Smallest example that demonstrates a boundary or error.
```

## Acceptance criteria

- **AC-1:** Given [state], when [action], then [observable result].
- **AC-2:** Given equal architecture, scenario, configuration, and seed inputs,
  two runs produce equal state and execution history.
- **AC-3:** [Invalid or boundary behavior is verified.]
- **AC-4:** [Dependency direction or forbidden API usage is verified.]

Each invariant and public operation must map to at least one acceptance
criterion. Implementation tests should use these identifiers.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| INV-1 | AC-1 |
| INV-2 | AC-2, AC-4 |
| [Every public operation, including construction/reset] | [AC IDs] |

[Replace the sample mapping with complete coverage. Include invalid inputs,
failure paths, and cross-component integration cases, not only happy paths.]

## References

- [DistLab vision](../vision.md)
- [DistLab architecture](../architecture.md)
- [DistLab glossary](../glossary.md)
- [Shared Simulation Contracts](contracts.md)
- [Related component specification, ADR, or issue]
