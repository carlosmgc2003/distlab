# ADR-001: Explicit execution and history boundaries

| Field | Value |
| --- | --- |
| Status | Accepted for the draft specification baseline |
| Date | 2026-09-17 |
| Scope | Contracts in docs/spec; no implementation yet |

## Context

Architecture §§7–10 show conceptual executable events and promise-based sleep
and network requests.
Sections 5 and 37 place execution history in the kernel while Observability is
a dependent model. Sections 35 and 40 require deliberate decisions about state,
snapshots, scheduling, and dependency direction. These conceptual interfaces
need a concrete execution boundary to support reproducible educational runs.

## Decision

- Store serializable event records and resolve a stable type through a sealed
  handler registry. Executable handlers remain outside the queue. Initialization
  scheduling and owner-bound runtime capabilities refine the conceptual
  `Simulation.schedule`; UI lifecycle controls do not expose arbitrary scheduling.
- Use synchronous handlers or generator tasks yielding opaque controlled
  operations. This replaces the conceptual native `async`/`await` API for the
  initial contract, including network operations awaited by model handlers.
  Host promise/microtask scheduling does not execute modeled
  continuations. A later async authoring adapter must preserve this protocol and
  requires a separate decision; it is not implied by these specs.
- Keep the kernel dependent on observation ports. The application composition
  root injects an Observability implementation and fresh runtime models. Kernel
  lifecycle ownership does not create a dependency on concrete runtime packages.
- Canonical history describes the modeled execution. Playback notifications and
  reset-attempt identities are host-only. Reset reproduces initial inputs and
  canonical IDs, while revoking old capabilities through a private generation.
- An observation append failure terminates execution with a separate canonical
  terminal failure in the export. A full or invalid history sink is never called
  recursively to explain its own failure. Completed business changes are not
  rolled back globally.
- The scheduler owns ordering and dequeue; only the kernel executes handlers.
  This refines the glossary's combined description of scheduler execution.

## Alternatives and consequences

Native promises without an instrumented execution protocol leave suspension and
microtask quiescence ambiguous. Waiting on an entire async handler deadlocks a
virtual sleep; guessing a number of host microtask turns is not a contract.
Generator tasks expose suspension and completion synchronously, at the cost of
using `yield` in initial model authoring examples.

Putting playback transitions in canonical history makes stepping change the
export. Putting reset records in a fresh history prevents reset equivalence.
Host notifications preserve those UI affordances without affecting evaluation.

Reserving failure slots is another possible capacity policy, but requires
accounting for multiple failures during terminal transitions. A single separate
terminal record handles both capacity and observation validation failures.

Queued state is serializable, but suspended generators are not. Scheduler-only
serialization is not a complete simulation snapshot. Full snapshots, rewind,
and fast-forward remain future work, consistent with architecture §§8 and 35.

## Verification and traceability

CORE-AC-13–18, SCHED-AC-14, OBS-AC-17–19, and CONTRACT-AC-1–6 verify these
decisions. They support the vision's reproducibility (§15), fault recovery
(§16), inspectable timelines (§17), and small educational primitives (§22).

Architecture and vision remain unchanged. This ADR explicitly records the
refinements and the initial async API departure required by architecture §40.

## References

- [Architecture: kernel](../../architecture.md#7-simulation-kernel)
- [Architecture: change policy](../../architecture.md#40-architectural-change-policy)
- [Shared contracts](../contracts.md)
- [Simulation Core](../simulation-core.md)
- [Observability](../observability.md)
