# Fault Engine Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`FaultEngine` deterministically selects configured faults at explicit model
boundaries. It returns decisions to transport owners and applies scheduled
lifecycle faults through injected ports; it never edits another model's state.

## Architectural alignment and decisions

This refines [architecture §§23–24](../architecture.md#23-fault-engine) and
[vision §16](../vision.md#16-failure-injection). Matching, composition, and bounded
duplication are fixed by [ADR-002](adr/002-runtime-model-semantics.md).
Arbitrary user predicates, data corruption, Byzantine behavior, and host-driven
unrecorded faults are deferred. There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Vision §16: configurable faults | Public API | FAULT-AC-1, FAULT-AC-3 |
| Architecture §38: seeded outcomes | Operation semantics and errors | FAULT-AC-2, FAULT-AC-5 |
| Architecture §37: dependency direction | Invariants | FAULT-AC-4 |

## Public API

Identity/value types follow [contracts](contracts.md) and time follows
[Virtual Clock](virtual-clock.md). These port types belong to the neutral runtime
contract layer; consumers do not import the concrete fault engine.

```ts
type FaultPoint = "network.request" | "network.response" | "message.delivery"
  | "database.commit";
interface FaultProbe {
  point: FaultPoint;
  subjectId: string;
  source: ComponentId;
  target: ComponentId;
  name: string; // Endpoint, destination, or database owner ID.
}
type FaultEffect =
  | { kind: "delay"; duration: Duration }
  | { kind: "drop" }
  | { kind: "fail" }
  | { kind: "duplicate"; additionalCopies: number; spacing: Duration }
  | { kind: "disconnect" };
interface FaultRule {
  id: string;
  point: FaultPoint;
  source?: ComponentId;
  target?: ComponentId;
  name?: string;
  from: SimulationTime;
  until?: SimulationTime;
  occurrence?: number;
  probability: number;
  maxApplications: number;
  effect: FaultEffect;
}
interface FaultDecision {
  ruleIds: readonly string[];
  extraDelay: Duration;
  drop: boolean;
  additionalCopies: number;
  copySpacing: Duration;
  fail: boolean;
}
interface FaultDecisionPort {
  evaluate(probe: FaultProbe): FaultDecision;
}
type ScheduledFault =
  | { id: string; kind: "crash"; target: ComponentId }
  | { id: string; kind: "external-availability"; target: ComponentId;
      state: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" };
interface FaultController {
  apply(fault: ScheduledFault): void;
}
```

The root constructs immutable ordered rules with clock, seeded random,
observations, and injected lifecycle effect ports. It validates references,
nonempty unique IDs, time windows, probability in `[0,1]`, positive safe-integer
occurrence/maxApplications, and supported point/effect combinations. Scenario
normalization defaults probability to 1 and maxApplications to 1. `until` must
exceed `from`; absent until is unbounded. Duplicate is message-only, with
additionalCopies in `[1,16]`; disconnect is network-request-only. Fail is
database-commit-only, and is the only effect accepted at that point. Delay and
spacing are nonnegative and all composed arithmetic is checked.

### Operation semantics and errors

`evaluate` is called once per original transport leg, bus reservation, or commit,
inside trusted event dispatch. It validates the probe before examining rules. Each
matching rule is considered in declaration order: point/source/target/name
must match exactly and time must lie in `[from, until)`. No payload predicates
or substring matching exist. Increment that rule's candidate counter for each
structural/time match, then test occurrence (one-based, if supplied), remaining
applications, and probability. Draw exactly once only when those tests pass
and probability is strictly between zero and one. Probability 0/1 consumes no
draw. A failed draw does not consume application budget. With an occurrence
filter, failure at that occurrence does not try later candidates.

Successful rules consume one application and compose in declaration order.
The neutral decision has zero delays/copies, empty rule IDs, and false drop/fail.
Delays add; drop/disconnect set drop=true; fail sets fail=true. The first
successful duplicate rule sets count/spacing and later duplicate rules are rejected at configuration if
their selectors/time windows could overlap. A conservative overlap check may
reject configurations whose optional selectors do not prove disjointness.
Drop wins over copies, but all matching rules are still evaluated and observed.
Duplicates inherit the original decision and are not evaluated recursively.
The returned decision is detached and immutable. No caching or second evaluation
of the same leg/reservation is permitted; adapter misuse is terminal
`FAULT_PROBE_REUSED`. Decision IDs are the caller-supplied subject ID plus point.

Database commit uses its transaction ID as subject, its owner as source, target,
and name, and evaluates before conflict/constraint checks. A selected fail closes
the transaction with modeled `COMMIT_FAILED`, leaving committed state untouched.
Transport adapters apply delay/drop/duplication at their documented scheduling
boundaries. A disconnect is a scoped request-leg drop during the rule window;
it does not cancel already-scheduled requests. Delays can reorder deliveries;
there is no privileged queue reorder. Timeouts are caused by absent/late replies,
not by making a false claim about target failure. Rate limiting uses scheduled
provider availability. Client-request and callback faults use their network
legs. Separate arbitrary transaction-body failures are deferred. Default link
randomness is sampled before fault evaluation, as specified by VirtualNetwork.

`apply` validates and invokes an injected service-crash or provider-availability
port in a scheduled scenario event. It records applied only after the target
transition succeeds; repeated fault IDs are no-ops. Restoration is an explicit
later lifecycle/availability action, never an implicit rollback. Invalid targets,
rules, probes, transitions, or unsupported effects are terminal
`INVALID_FAULT` (or the target's more specific terminal error), before mutation
where validation is possible. Counter/time overflow is terminal. There are no
asynchronous operations, public cancellation, or dynamic rule edits.

## Owned state

Ordered rule definitions, candidate/application counters starting at zero,
evaluated probe identities, and applied scheduled-fault IDs. It does not own
transport state, component availability, time, or RNG state. Canonical state
excludes effect callbacks. There is no extra capacity limit beyond finite input
rules and application limits. Reset clears counters/identities, restores rule
inputs, and revokes old ports; serializing the engine is not a full snapshot.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `fault.rule.matched` | Rule reaches probability test | Rule ID, probe, candidate ordinal, selected |
| `fault.effect.selected` | Rule selected | Rule ID, subject ID, effect, application ordinal |
| `fault.applied` | Scheduled lifecycle effect succeeds | Fault ID, target, kind, requested state |

The engine owns schemas and records correlation/causation from the triggering
transport or scenario event. Selection records explain decisions; transport and
lifecycle owners record actual delivery/state transitions and before/after
evidence. Values follow visibility policy. Sink failure terminates via
[Observability](observability.md) without trying to emit another fault record.
No playback-dependent observations or UI hooks affect matching.

## Invariants

- **FAULT-INV-1:** Equal inputs and probe order consume equal draws and select equal effects.
- **FAULT-INV-2:** Every selected effect is bounded, attributable, and applied by its owner.
- **FAULT-INV-3:** Faults cannot bypass scheduler order or directly mutate peer state.

## Explicit non-responsibilities

- Transport delivery, message retry, crash cleanup, and provider business effects.
- Business recovery strategies and assessment verdicts.
- Direct real-time UI mutation, arbitrary code injection, or uncontrolled randomness.

## Minimal examples

### Drop one processor reply

```ts
const rule: FaultRule = {
  id: "lose-first-reply", point: "network.response",
  source: "processor", target: "payments", name: "authorize",
  from: simulationTime(0), occurrence: 1, probability: 1,
  maxApplications: 1, effect: { kind: "drop" },
};
```

### Bounded duplication

```text
A message.delivery rule selects additionalCopies=1, spacing=10.
The original and extra copy share one message ID and have distinct delivery IDs.
The extra copy cannot match the same rule recursively.
```

## Acceptance criteria

- **FAULT-AC-1:** Validate/construct rules; exact selectors, window edges,
  one-based occurrence, budgets, and empty rule sets produce specified decisions.
- **FAULT-AC-2:** Verify draw counts for probability 0/1/intermediate, exhausted
  rules, failed occurrence draws, and multiple composed rules in declaration order.
- **FAULT-AC-3:** Delay/drop/disconnect/duplicate, commit failure, and scheduled crash/availability
  produce owner observations; overlapping duplicates are rejected and no recursion occurs.
- **FAULT-AC-4:** Invalid probes, repeated probes, overflow, and foreign capabilities
  terminate safely; effect ports cannot expose peer internals; sink failure seals execution.
- **FAULT-AC-5:** Equal fresh/reset runs match decisions/state/history and old
  ports fail. Rules use no wall-clock, real network, or UI state.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| FAULT-INV-1 | FAULT-AC-1, FAULT-AC-2, FAULT-AC-5 |
| FAULT-INV-2 | FAULT-AC-1, FAULT-AC-3 |
| FAULT-INV-3 | FAULT-AC-3, FAULT-AC-4 |
| Construction, reset | FAULT-AC-1, FAULT-AC-3–5 |
| evaluate | FAULT-AC-1–5 |
| apply | FAULT-AC-3–5 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Virtual Network](virtual-network.md), [Message Bus](message-bus.md)
- [Service Runtime](service-runtime.md), [External Service Runtime](external-service-runtime.md)
