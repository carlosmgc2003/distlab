# ADR-002: Explicit runtime delivery, storage, and lifecycle semantics

| Field | Value |
| --- | --- |
| Status | Accepted for the MVP implementation baseline |
| Date | 2026-09-19 |
| Scope | Runtime and scenario specifications; no implementation yet |

## Context

Architecture §§10–19 and 24–30 identify educational models but intentionally
leave their policy details open. Implementations need reproducible choices for
timeouts, delivery attempts, transaction conflicts, expiration, crashes, and
assessment. Architecture §40 requires those choices to be explicit rather than
implicitly changing fundamental semantics. ADR-001 already fixes controlled
generator tasks and canonical history; this decision builds on that protocol.

## Decision

- Network operations have separate request/response legs and a caller deadline.
  Timeout settles only the caller; it neither cancels target work nor proves
  target failure. Deadlines win exact-time ties because they are inserted first.
  Link jitter is nonnegative additive integer jitter; the request's directed
  policy governs both legs. Transport loss does not return an immediate error.
- Broker admission is a controlled operation independent of network transport.
  Queues compete deterministically; topics keep independent durable subscription
  records. One reservation per subscription, explicit ACK deadlines, bounded
  redelivery, and inspectable dead letters define the initial model. Delivery
  duplicates preserve message identity and never promise exactly-once effects.
- Database transactions use explicit handles with private snapshots and a
  database-wide optimistic revision. Commit is a zero-delay controlled operation.
  This replaces the conceptual asynchronous callback API. Unrelated writes may
  conflict; serializable local commits and simplicity take priority over fidelity
  to a production database isolation level. No cross-resource commit exists.
- KV operations are atomic per key. Positive TTL expires at `now >= expiresAt`,
  including before a same-time expiry handler runs. Generation-fenced expiry
  cannot remove replacements. KV and committed DB state survive service process
  crash; simulation reset restores initial resource state.
- Service PAUSED blocks admission but lets admitted tasks finish. CRASHED and
  STOPPED abandon local tasks without user cleanup, invalidate their waits, and
  discard uncommitted transactions. Remote work and unacknowledged bus delivery
  remain independent. Restart creates fresh process handlers and preserves owned
  resources; reset recreates the whole run. Clients have explicit independent
  actions and no automatic retry. External availability affects admission, while
  admitted effects and callbacks complete under captured behavior.
- Fault rules are immutable, ordered, bounded, and evaluated at explicit probe
  points with the seeded stream. Transport owners apply returned decisions.
  Commit faults reject the pending transaction before it changes durable state.
  Scheduled lifecycle faults use injected effect ports. No concrete dependency
  cycle between fault engine and runtimes is introduced.
- Scenarios resolve versioned catalogs into canonical inputs, register everything
  before scheduling, initialize resource timers, then enqueue actions in declared
  order and assertion markers last. Services require explicit startup actions.
  Assessment observes initialization and completed event boundaries, with finite
  deadlines for eventual properties. Host notifications cannot drive assessment.

## Kernel integration refinements

Two trusted ports refine ADR-001's kernel boundary without exposing new model
capabilities. They belong in the neutral contract layer when implemented:

```ts
interface TaskLifecycleController {
  // Dispatch-only; the kernel validates that tasks belong to this owner/process.
  abandon(owner: ComponentId, processGeneration: number): void;
}
interface BoundaryReadHook {
  afterInitialization(): void;
  afterEvent(event: Readonly<ScheduledEvent>): void;
  onCompletion(): void;
  onFailure(error: Readonly<SimulationError>): void;
}
```

`abandon` removes matching controlled tasks without resuming generators or
executing finally blocks, invalidates their owned pending operations, and cancels
local wake events. Trusted model cleanup discards transactions and local triggers;
it does not cancel independent remote requests or bus ACK timers. Late completions
of abandoned operations are inert, like late completions of settled operations.
Stale/foreign capability use is terminal. No application handler receives this port.

The composition root registers one boundary hook before setup is sealed. Hooks
are synchronous, versioned trusted adapters with detached read projections and
an observation sink, but no scheduling, control, or business mutation capability.
`afterEvent` runs after handler completion/suspension bookkeeping and before the
kernel's completion/deadlock/pause decision. `afterInitialization` runs after all
initial work is enqueued. `onCompletion` finalizes pending always assertions
before `simulation.completed`. Hook observations cannot trigger another hook.
`onFailure` updates assessment results without recording to the ordinary sink.
Unexpected hook errors are terminal; failure notification is called at most once
and cannot replace an already-latched terminal failure. Hooks must never depend
on host playback controls. Pausing or event limits do not finalize assertions.

These ports extend the shared/core baseline expressly for runtime termination
and assessment. Existing core dispatch rules otherwise remain authoritative.

## Alternatives and consequences

Automatically cancelling timed-out work conceals ambiguous outcomes. Exactly-once
broker effects hide the reason to build an inbox. Silent retries obscure caller
policy. These alternatives would undermine the stated educational scenarios.

Row-level conflict detection and vendor isolation levels permit more concurrency
but require substantially more storage machinery. A coarse revision is easy to
inspect and may cause conservative conflicts; the database spec makes this cost
explicit. Snapshotting live generators remains unsupported.

Freezing every task in a paused service requires separate suspended scheduling
and timeout rules. Admission-only pause is deliberately smaller. Abrupt crash
requires trusted kernel task cleanup because resuming user code with a catchable
error could let a dead process continue writing state.

Evaluating assertions from UI subscriptions would make results depend on host
yield settings. A deterministic read hook supports always properties without
turning assessment into a runtime dependency of the kernel. Finite marker
deadlines make eventual assertions executable but do not prove unbounded liveness.

## Verification and traceability

NET-AC-1–6, BUS-AC-1–6, DB-AC-1–6, KV-AC-1–5, SVC-AC-1–5,
CLIENT-AC-1–5, EXT-AC-1–6, FAULT-AC-1–5, and SCENARIO-AC-1–5 cover the
decisions and their integration. These remain draft contracts, not implemented
or tested guarantees. Architecture/vision goals are unchanged; this ADR records
the API refinements and previously unspecified policies explicitly.

## References

- [Architecture change policy](../../architecture.md#40-architectural-change-policy)
- [ADR-001](001-deterministic-execution.md), [Shared contracts](../contracts.md)
- [Virtual Network](../virtual-network.md), [Message Bus](../message-bus.md)
- [Database](../database.md), [KeyValueStore](../kv-store.md)
- [Service Runtime](../service-runtime.md), [Client Runtime](../client-runtime.md)
- [External Service Runtime](../external-service-runtime.md)
- [Fault Engine](../fault-engine.md), [Scenario Engine](../scenario-engine.md)
