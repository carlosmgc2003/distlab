# External Service Runtime Specification

| Field | Value |
| --- | --- |
| Status | Draft |
| Owner | DistLab core team |
| Last updated | 2026-09-19 |
| Related issues | None |

## Responsibility

`ExternalServiceRuntime` models a provider outside the simulated organization's
control. It exposes operations, availability, boundary effects, and callbacks
while keeping provider implementation/state inaccessible to service code.

## Architectural alignment and decisions

This refines [architecture §§13–15](../architecture.md#13-external-service-runtime)
and [vision §8](../vision.md#8-external-services). Provider response loss after a
successful effect teaches ambiguous timeouts. [ADR-002](adr/002-runtime-model-semantics.md)
records admission, persistence, and callback policies; no vendor API is implied.
Real providers, student-editable provider internals, and provider process crashes
are deferred. There are no unresolved baseline decisions.

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Architecture §13: scenario-controlled behavior | Public API | EXT-AC-1, EXT-AC-2 |
| Architecture §15: availability | Operation semantics and errors | EXT-AC-3 |
| Vision §11: timeout ambiguity | Invariants | EXT-AC-2, EXT-AC-4 |

## Public API

Shared values follow [contracts](contracts.md), time follows
[Virtual Clock](virtual-clock.md), and request/reply types follow
[Virtual Network](virtual-network.md).

```ts
type ExternalAvailability = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED";
interface CallbackPlan {
  after: Duration;
  request: NetworkRequest;
}
interface ProviderDecision {
  nextState: CanonicalValue;
  reply: NetworkReply;
  visibleChanges: CanonicalValue;
  callbacks: readonly CallbackPlan[];
}
interface ExternalOperation {
  apply(body: CanonicalValue, state: CanonicalValue,
    behavior: CanonicalValue): ProviderDecision;
}
interface ExternalDefinition {
  id: ComponentId;
  version: string;
  operations: Readonly<Record<string, ExternalOperation>>;
  initialState: CanonicalValue;
}
interface ExternalBehavior {
  latency: Duration;
  degradedExtraLatency: Duration;
  dropResponse: boolean;
  parameters: CanonicalValue;
}
interface ExternalRuntime {
  readonly availability: ExternalAvailability;
}
interface ExternalController {
  configure(operation: string, behavior: ExternalBehavior): void;
  setAvailability(state: ExternalAvailability): void;
}
```

The root resolves versioned provider definitions and validates initial state,
operation schemas, behavior, and declared callback links. It injects network
receiver/reply and sender ports, clock, trusted scheduling, observations, and
task ports. Operation `apply` is trusted synchronous catalog code: a pure
transition over detached state, request, and parameters. It receives no service
database, kernel, host I/O, or writable peer state. Provider randomness must be
resolved through fault decisions or explicit scenario parameters; `apply` cannot
draw hidden randomness. Initial behavior defaults to zero latencies, false
dropResponse, and null parameters if the operation schema permits null.

Only scenario/fault adapters receive the controller. Initial availability is
AVAILABLE; initialization may select another declared state. Configure is legal
during initialization or a scheduled scenario dispatch. Availability changes
are likewise scheduled after initialization. Invalid operation names, behavior,
state, or capability usage fail terminally with `INVALID_EXTERNAL_CONFIGURATION`
before mutation. Reapplying an identical value is a no-op.

### Operation semantics and errors

Network arrival checks availability first. UNAVAILABLE returns an error reply
`EXTERNAL_UNAVAILABLE`; RATE_LIMITED returns `EXTERNAL_RATE_LIMITED`, without
running `apply`. RATE_LIMITED is a scenario-controlled rejection mode, not an
implicit quota algorithm. AVAILABLE and DEGRADED admit work. Capture the current
behavior and schedule provider completion after latency plus degradedExtraLatency
only in DEGRADED. There is no additional provider queue/capacity in this baseline.

At completion, execute `apply` once against the then-current provider state,
validate the entire decision and checked callback times, atomically replace state,
and record its visible effect. Operations completing at the same time execute
in scheduler order. A later availability/configuration change affects new
admissions only, not already-admitted operations. A business rejection is an
ordinary decision with an error reply; unexpected code exceptions or invalid
decisions terminate the simulator.

After effect recording, enqueue callbacks in declared array order and send the
reply through the response leg. With dropResponse, record suppression and omit
the reply; the caller still reaches its network deadline. This setting is a
provider behavior, separate from network loss faults, and does not undo the
effect. Timed-out callers do not cancel provider completion.

Callbacks are independent provider-owned controlled tasks scheduled relative to
effect completion, creating network requests with the original operation's
correlation as parent. They are requests, not bus publications or direct handler
calls. A callback's timeout records failure locally without changing the original
effect. Callback retries require explicit additional plans. Repeated plans may
carry the same business event ID while producing distinct network request IDs.
Changing availability does not cancel queued callbacks.

Idempotency is an operation-specific catalog contract, never an automatic
runtime guarantee. An idempotent payment fixture may store a key and result in
private state; a non-idempotent fixture deliberately may charge twice. The
operation version and behavior inputs must make this difference reproducible.

## Owned state

Availability, normalized operation behaviors, private provider state, admitted
requests with captured behavior, and scheduled callback/completion handles.
State is independent of internal-service restarts. Trusted assessment may obtain
a read projection of boundary facts such as authorization count; student-facing
inspection receives only the provider's declared visible projection.

All state/decisions use detached canonical values. Reset restores initial state,
availability, behavior, and empty in-flight work and revokes old controllers.
Exporting boundary facts is not a complete snapshot of private state or tasks.

## Emitted events

| Event | When | Required data |
| --- | --- | --- |
| `external.availability.changed` | Availability transition | Before, after |
| `external.behavior.changed` | Effective configure | Operation, before/after public behavior |
| `external.operation.admitted` | Accepted arrival | Request ID, operation, completion time |
| `external.operation.rejected` | Admission refusal | Request ID, operation, code |
| `external.effect.committed` | Valid decision applied | Request ID, operation, visibleChanges |
| `external.response.suppressed` | Configured dropResponse | Request ID, reason |
| `external.callback.scheduled` | Callback plan accepted | Origin request ID, ordinal, due time, target |
| `external.callback.completed` | Callback reply or timeout | Origin request ID, ordinal, outcome |

Schemas belong to this runtime and expose boundary effects only, with explicit
change evidence in visibleChanges. They preserve incoming correlation, entity
references, and causal links; callbacks use child request spans. Private provider
state must not be placed in the observation payload and then merely hidden in
the UI. [Observability](observability.md) governs visibility and nonrecursive
terminal append failure; committed provider effects survive that failure.
Playback emits no provider observations.

## Invariants

- **EXT-INV-1:** Provider effects and replies are independent: response loss
  cannot revoke an already-applied effect.
- **EXT-INV-2:** Provider internals never become internal-service capabilities.
- **EXT-INV-3:** Admission captures behavior; effects/callbacks follow virtual order.

## Explicit non-responsibilities

- Real payments, carrier APIs, tokens, email, or production credentials.
- Service-owned transaction state, compensation, or universal idempotency.
- Provider implementation debugging in the student interface.

## Minimal examples

### Ambiguous authorization

```ts
// Trusted scenario initialization; authorize is a versioned provider operation.
external.configure("authorize", {
  latency: duration(50), degradedExtraLatency: duration(100),
  dropResponse: true, parameters: { result: "success" },
});
```

### Delayed duplicate callback

```text
authorize commits once and returns plans for callback event e1 at +100 and +200.
Both callbacks travel through VirtualNetwork with different request IDs.
A service must deduplicate e1 if repeating its effect would be unsafe.
```

## Acceptance criteria

- **EXT-AC-1:** Construct/configure operations; validate definitions and atomic
  decisions; normal/degraded latency and canonical replies match captured inputs.
- **EXT-AC-2:** Commit an authorization with response suppression and network
  response loss independently; caller timeout preserves the effect in both cases.
- **EXT-AC-3:** Change all availability states during in-flight work; new arrivals
  follow the new state, accepted operations finish under captured behavior.
- **EXT-AC-4:** Delayed/duplicate callbacks use the network and stable business
  IDs; callback timeouts do not roll back the original effect or retry implicitly.
- **EXT-AC-5:** Service code cannot inspect private state; observation visibility,
  invalid configuration/decision, sink failure, and stale ports obey the boundary.
- **EXT-AC-6:** Fresh/reset runs match state/history; internal-service restart
  retains provider effects; no native timers, randomness, or external I/O occurs.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| EXT-INV-1 | EXT-AC-2, EXT-AC-4 |
| EXT-INV-2 | EXT-AC-5 |
| EXT-INV-3 | EXT-AC-1, EXT-AC-3, EXT-AC-6 |
| Construction, configure, setAvailability, availability, reset | EXT-AC-1, EXT-AC-3, EXT-AC-5, EXT-AC-6 |
| Operation.apply and callback dispatch | EXT-AC-1, EXT-AC-2, EXT-AC-4–6 |

## References

- [Architecture](../architecture.md), [Vision](../vision.md), [Glossary](../glossary.md)
- [Client Runtime](client-runtime.md), [Scenario Engine](scenario-engine.md)
