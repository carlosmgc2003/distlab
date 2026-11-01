# ADR-005: Scope of the student architecture editor

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-11-01 |
| Scope | Catalog model interfaces, scenario validation, session overlay, browser editor; contracts and implementation follow in #108, #109, #110, #111, #112 |
| Related issues | #93, #94, #98, #99, #100, #104, #108, #109, #110, #111, #112 |
| Amends | [ADR-004](004-session-overlays.md): an overlay may now carry architecture edits |

## Context

The first verb of the vision's activity loop is DESIGN: "build a system
visually · connect components" ([vision §1](../../vision.md#1-vision),
[§12](../../vision.md#12-product-experience),
[§13](../../vision.md#13-visual-architecture)). Today the architecture graph is
read-only, and the [application boundary](../application-boundary.md#deferred-capabilities)
defers "a general architecture editor". [ADR-004](004-session-overlays.md) gave
students a sanctioned way to change faults and declared parameters. It
explicitly kept topology out of the overlay.

The current code sets four constraints on any editor:

- **Models name their peers in code.** `commerce.saga` calls `"inventory"`,
  `"payments"`, and `"carrier"`. `distlab.payments` calls `"payment-processor"`.
  `distlab.orders` publishes to `"OrderCreated"`. Only `commerce.dependency`
  reads its peer from configuration (`target`). Drawing a new link cannot make
  such a model call a different component.
- **Models declare only part of their interface.** `ScenarioModel` lists
  `actions`, `endpoints`, `consumers`, and `operations`. It does not list the
  components it calls, the destinations it publishes to, or the tables it
  writes.
- **Wiring mistakes end the run.** A request over a missing link fails with a
  terminal `INVALID_NETWORK_REQUEST` ([virtual network](../virtual-network.md)).
  A request for an endpoint the target does not register fails with
  `INVALID_REGISTRATION` ([service runtime](../service-runtime.md)).
  `ScenarioEngine.validate` checks link existence and uniqueness, ownership,
  and subscriptions. It cannot see that a link a model needs is missing.
- **Lessons refer to components by ID.** Workload actions, assertions,
  external behavior, packaged faults, and ADR-004 parameter targets all name
  component IDs. An editor that renames or removes those components breaks the
  lesson.

An editor changes state ownership, component boundaries, and the inputs the
host accepts. Architecture §40 therefore requires an ADR.

## Decision

### Editing level: compose catalog models, never author handlers

A student builds an architecture from **prefabricated catalog models** and
chooses among the **behavior options** each model declares. A student never
writes handler code, expressions, or scripts. Every behavior that can run is
trusted, versioned catalog code, as [ADR-001](001-deterministic-execution.md)
and vision §23 ("execute arbitrary backend applications" is a non-goal)
require.

The editor offers this closed set of operations:

| Operation | Effect | First increment |
| --- | --- | --- |
| **Fill a slot** | Choose the model (and its behavior options) of a component the lesson declares as a slot | Yes |
| **Connect** | Bind a model's declared peer to a component; the link follows | Yes |
| **Attach / detach a resource** | Give a service its own database or key-value store, or take it away | Yes |
| **Subscribe / unsubscribe** | Subscribe a service to a destination, or remove the subscription | Yes |
| **Add / remove a component** | Place a new catalog component, or remove one | No: sandbox increment |

Link policies of packaged links stay ADR-004 parameters. Behavior options of
packaged components that are not slots stay ADR-004 parameters. Each location
therefore has exactly one editing mechanism.

### Model descriptors and peers

Every catalog model gets a data-only **model descriptor**. It states the
model's whole interface, so the editor can offer valid choices and the worker
can validate a design before it runs:

- the existing `kind`, `actions`, `endpoints`, `consumers`, and `operations`
- **publishes**: the destination IDs the model publishes to
- **peers**: the outbound calls the model makes, described below
- **storage**: the database tables it needs, and whether it needs a
  key-value store
- **options**: its behavior options, each with a typed domain and default

A **peer** is a named outbound dependency of a model. It declares:

- `name`, which is also the `ComponentInstance.configuration` field that holds
  the bound component ID
- the component kinds it may bind to (`service` or `external`)
- the endpoints (for a service) or operations (for an external service) the
  model calls on it
- a `default` component ID, used when the configuration omits the field

Models stop hardcoding peer IDs. They read each peer from configuration and
fall back to the descriptor default. `commerce.dependency` already works this
way. Because the defaults equal today's hardcoded IDs and omitted fields stay
omitted, **no packaged document changes and no golden digest changes**.

A behavior option is also a configuration field with a typed domain. It
reuses `LessonParameterDomain` from ADR-004 (`boolean`, `integer`, `choice`).
Peer names and option keys of one model are disjoint.

The term is *peer*, not *port*: the kernel already uses "port" for injected
capabilities such as the fault decision port and mutation ports.

The descriptors live in data-only catalog modules beside the packaged
documents. The main thread may import them; the worker builds each
`ScenarioModel` from its descriptor plus `checks` and `instantiate`. A catalog
test proves that the two agree.

### Slots and placeholder models: "fill the gap" exercises

A **slot** is a component the lesson owns: its ID is fixed by the lesson, and
the lesson's workload, assertions, external behavior, and faults may refer to
it. The student chooses which allowed model fills it. Because the ID never
changes, every reference in the packaged document stays valid whatever the
student picks. This is the reason the first increment edits slots instead of
adding components with student-chosen IDs.

A slot's packaged model is either a real model (for example a consumer
without deduplication) or a **placeholder model**. The catalog provides one
placeholder per component kind (`service` and `external`). A placeholder:

- exposes the endpoints or operations listed in its configuration field
  `interface`, so the packaged document is valid and runnable
- answers every request with an error reply (`status: "error"`) whose body
  carries the code `NOT_IMPLEMENTED`
- consumes nothing, publishes nothing, needs no storage, and holds no state

The packaged gap lesson therefore runs, and its assertions can show what is
missing. That makes the empty overlay a meaningful first run, and it keeps the
ADR-004 rule that the empty overlay reproduces the packaged lesson exactly.

### Which edits each lesson allows

Edits are governed by the lesson overlay policy, as faults and parameters are.
There is **one mechanism, not two modes**. A constrained exercise is a lesson
with a narrow architecture allowance. A free sandbox is a lesson with a broad
one.

The policy gains an optional **architecture allowance**. A lesson without one
accepts no architecture edits. It declares:

- **Slots**: for each slot component, the models (with versions) that may
  fill it.
- **Bindings**: for each (component, peer name) pair the student may bind, the
  candidate components. A candidate may deliberately be incompatible: the
  resulting diagnostic is then part of the exercise.
- **Resources**: the (owner, `database` | `store`) pairs the student may
  attach or detach.
- **Subscriptions**: the (consumer, destination) pairs the student may add or
  remove.
- **A link policy** for links created by a binding.
- **An edit limit**: the maximum number of architecture edits, separate from
  the fault entry limit.

The first increment ships constrained "fill the gap" exercises only. A free
sandbox needs components with student-chosen IDs, and a workload that does
not depend on them, so it comes later (see "Sandbox increment").

### Validation rules

Composition rules are properties of **any** valid scenario document, not only
of overlaid ones. They join `ScenarioEngine.validate` and use the descriptors
through `ScenarioCatalog`. Every packaged lesson must pass them.

| Rule | Code |
| --- | --- |
| Each peer of each component resolves (configuration or default) to an existing component of an allowed kind | `PEER` (new) |
| The bound component exposes every endpoint or operation the peer declares. A placeholder exposes its configured `interface` | `INTERFACE` (new) |
| A link exists from the component to each bound peer | `LINK` (existing code, new rule) |
| Every destination a model publishes to exists | `PUBLISH` (new) |
| A service whose model needs storage owns a database with each required table, or a key-value store | `STORAGE` (new) |
| Only services own resources | `OWNERSHIP` (existing) |
| One database and one store per owner. A database has exactly one owner by construction | `DUPLICATE` (existing) |
| Every declared consumer is subscribed, and only declared consumers are | `SUBSCRIPTION` (existing) |

Together these rules mean **every endpoint a component calls is reachable**:
the peer exists, a link carries the call, and the target registers the
endpoint. The run can no longer fail with `INVALID_NETWORK_REQUEST` or
`INVALID_REGISTRATION` because of wiring. Reachability of a component *from a
client* is not required. An unreached component is legal and simply idle.

Validation keeps the order and atomicity of ADR-004:

1. Command shape (`INVALID_WORKER_COMMAND`).
2. Packaged document (`INVALID_SCENARIO`).
3. Overlay against the policy (`INVALID_OVERLAY`). New checks: each edit names
   an allowed slot, model, binding, candidate, resource, or subscription; option
   values lie in their domain; no two edits touch the same element; the edit
   limit holds. Disallowed edits use `OVERLAY_NOT_ALLOWED`, option values use
   `PARAMETER_VALUE`, conflicting edits use `DUPLICATE`, and the limit uses
   `OVERLAY_LIMIT`.
4. Applied document, through the unchanged `ScenarioEngine.validate`, now
   with the composition rules.

**This refines ADR-004's translation rule for stage 4.** An edit can make a
packaged location invalid. For example, rebinding a peer away from the only
component that offers an endpoint makes another component's packaged peer
fail. Stage 4 therefore attributes a diagnostic as follows:

- A diagnostic that also occurs when the packaged document is validated
  alone is a catalog defect: `INVALID_SCENARIO`.
- Otherwise the overlay caused it. It is returned as `INVALID_OVERLAY` at the
  path of the overlay entry that produced the location. If no entry produced
  it, the path is that of the edit that changed a component, binding, resource,
  or subscription the location names, and the first such edit in normalized
  order wins. If nothing matches, the path is `/architecture`.

Example paths: `/architecture/slots/0/model`, `/architecture/bindings/1/target`,
`/architecture/resources/0`, `/architecture/subscriptions/2`.

### Error presentation

The worker is the only validator. Load is the validation, as in ADR-004. No
dry-run command is added. A rejected load exposes no session, and the main
thread keeps the draft.

The editor prevents most mistakes by construction: it offers only the slots,
models, candidates, resources, and subscriptions the policy allows. Offering
choices from data is affordance, not validation. The editor never decides that
a design is valid.

After `INVALID_OVERLAY`, a pure main-thread function maps each diagnostic path
to the graph element it concerns:

| Path | Element |
| --- | --- |
| `/architecture/slots/i…` | the slot's component node |
| `/architecture/bindings/i…` | the drafted connection edge |
| `/architecture/resources/i` | the resource satellite |
| `/architecture/subscriptions/i` | the subscription edge |
| anything else | the editor panel only |

Each mapped element shows an error badge and an accessible description. The
editor panel lists every diagnostic. Choosing one selects and focuses its
element. The message is plain language keyed by code and built from the
diagnostic plus the draft entry it points to, for example "Payments calls
POST /authorize on Risk, but Risk does not offer it." It never claims more
than the diagnostic says.

### Draft, preview, and layout

The Design editor and the Break panel edit **one** draft session overlay. Apply
sends one `load` that carries both. Editing is available exactly when the
Break panel is, as the [shell action matrix](../application-boundary.md#shell-action-matrix)
states: never while the simulation runs or a command is outstanding.

The graph shows the draft as a **preview**: the published
`ArchitectureProjection` plus draft marks (a slot relabeled with its chosen
model, a dashed connection, an outlined satellite). The preview is a
presentation type built from the projection, the data-only descriptors, and
the draft. It is never an `ArchitectureDefinition`, never sent to the worker,
and never validated. After Apply the graph again shows only the projection.

Node positions, including those of slot nodes and new edges, are UI state.
They never enter the overlay, `RunInputs`, or `runId`. A filled slot keeps its
slot's position.

### Serialized format

Architecture edits are a new optional part of the session overlay. The format
records the **result**, not the gestures: two drafts that reach the same design
in a different order produce the same normalized overlay.

```ts
interface SessionOverlay {
  readonly version: 1;
  readonly faults: readonly FaultRule[];
  readonly scheduledFaults: readonly OverlayScheduledFault[];
  readonly parameters: readonly ParameterOverride[];
  /** Absent when empty, so every ADR-004 overlay keeps its identity. */
  readonly architecture?: ArchitectureEdits;
}
```

Overlay version 1 is kept. An absent `architecture` and an empty one normalize
to absent. Every existing overlay, export, and `SessionIdentity` is therefore
unchanged.

**Normalization.** Each list is sorted by its stable key: slots by component,
bindings by (component, peer), resources by (owner, resource), subscriptions by
(consumer, destination). Option values are sorted by key, and values equal to
the model default are removed. An entry that leaves the document unchanged is
removed:

- a slot entry that gives the packaged model and the packaged configuration
- a binding to the component the peer already resolves to

Two entries for the same element are rejected, not merged.

**Application** is a pure function of the packaged document, the policy, and the
normalized overlay. It runs in the worker in this fixed order:

1. **Slots.** Replace the slot component's `model` and `version` in place,
   keeping its array position. Replace its configuration with the non-default
   options.
2. **Resources.** Remove detached resources in place. Append attached ones in
   normalized order. An attached database has the descriptor's tables and empty
   initial rows; an attached store is empty.
3. **Subscriptions.** Remove in place. Append additions in normalized order.
4. **Bindings.** Write each peer field into the component's configuration.
   Append a link from the component to the bound peer, with the allowance's
   link policy, when no link exists. Links are never removed. An unused link is
   harmless, and a packaged link may carry an ADR-004 parameter target.
5. **ADR-004 composition**, unchanged: parameters, then appended faults and
   scheduled faults.

A round trip holds: comparing the applied document with the packaged one
gives back exactly the normalized architecture edits.

### Deterministic identity

ADR-004's rule is unchanged. The session identity is (packaged lesson name,
normalized overlay). The applied document is a pure function of that pair, and
it enters `RunInputs.scenario`. The input-derived `runId` therefore
distinguishes every design. It stays unchanged when there are no architecture
edits.

No observation type is added. Slot component IDs are lesson-owned, so history
names the same components whatever fills them. The model behind each component
is already visible in `ComponentNodeProjection.model` and `version`. The run
header adds the number of design edits and names each filled slot, for example
`notifications = commerce.inbox-notifications`. Equal `runId` values still
mean equal inputs.

Reset replays the applied overlay, architecture edits included. Compare carries
an architecture edit only when the paired lesson's allowance permits the same
edit. It drops and lists the others, as it does for parameters. Assessment
(#97) runs each suite row with the student's architecture edits. Different
designs can then pass the same requirements, as vision §21 expects.

### Sandbox increment (decided, not in the first increment)

A later increment adds **add component** and **remove component** under these
rules, so that no later ADR has to revisit them:

- An added component's ID starts with `student-` and its model comes from the
  allowance's palette. The palette is a list of models and a component limit.
- A component can be removed only when the allowance lists it as removable. A
  catalog test proves that no packaged action, assertion, external behavior,
  fault, parameter target, or binding default names a removable component.
- Removing a component also removes its links, subscriptions, and owned
  resources. A peer elsewhere that still resolves to it fails with `PEER` at
  the removal's path.
- The format gains `added` and `removed` lists in `ArchitectureEdits`. Both are
  absent when empty, so first-increment overlays keep their identity.

A sandbox lesson ships a fixed client and workload that call lesson-owned
entry components. Client-workload editing remains out of scope. It belongs
with the instructor scenario documents of #99.

## Contract types

The follow-up work adds these shapes to `@distlab/contracts`. Model
descriptors go in a new module `packages/contracts/src/model.ts`. The edits and
the allowance extend `packages/contracts/src/overlay.ts`. The shapes reuse
existing types instead of redeclaring them.

```ts
interface ModelPeer {
  /** Also the configuration field that holds the bound component ID. */
  readonly name: string;
  readonly kinds: readonly ("service" | "external")[];
  /** Endpoints for a service peer, operations for an external peer. */
  readonly calls: readonly string[];
  readonly default: ComponentId;
}

interface ModelOption {
  /** Also the configuration field that holds the value. */
  readonly key: string;
  readonly domain: LessonParameterDomain;
}

interface ModelStorage {
  readonly database?: { readonly tables: DatabaseDefinition["tables"] };
  readonly store?: true;
}

interface ModelDescriptor {
  readonly model: string;
  readonly version: string;
  readonly kind: ComponentKind;
  readonly actions: readonly string[];
  readonly endpoints: readonly string[];
  readonly consumers: readonly string[];
  readonly operations: readonly string[];
  readonly publishes: readonly string[];
  readonly peers: readonly ModelPeer[];
  readonly storage: ModelStorage;
  readonly options: readonly ModelOption[];
  /** Placeholder models read their endpoints or operations from `configuration.interface`. */
  readonly placeholder?: true;
}

interface SlotEdit {
  readonly component: ComponentId;
  readonly model: string;
  readonly version: string;
  readonly options: readonly ParameterOverride[];
}

interface BindingEdit {
  readonly component: ComponentId;
  readonly peer: string;
  readonly target: ComponentId;
}

interface ResourceEdit {
  readonly owner: ComponentId;
  readonly resource: "database" | "store";
  readonly change: "attach" | "detach";
}

interface SubscriptionEdit {
  readonly consumer: ComponentId;
  readonly destination: string;
  readonly change: "subscribe" | "unsubscribe";
}

interface ArchitectureEdits {
  readonly slots: readonly SlotEdit[];
  readonly bindings: readonly BindingEdit[];
  readonly resources: readonly ResourceEdit[];
  readonly subscriptions: readonly SubscriptionEdit[];
}

interface LessonArchitectureAllowance {
  readonly slots: readonly {
    readonly component: ComponentId;
    readonly models: readonly { readonly model: string; readonly version: string }[];
  }[];
  readonly bindings: readonly {
    readonly component: ComponentId;
    readonly peer: string;
    readonly candidates: readonly ComponentId[];
  }[];
  readonly resources: readonly { readonly owner: ComponentId; readonly resource: "database" | "store" }[];
  readonly subscriptions: readonly { readonly consumer: ComponentId; readonly destination: string }[];
  readonly linkPolicy: NetworkPolicy;
  readonly maxEdits: number;
}

interface LessonOverlayPolicy {
  readonly version: 1;
  readonly lesson: string;
  readonly faults: LessonFaultAllowance;
  readonly parameters: readonly LessonParameter[];
  /** Absent: the lesson accepts no architecture edits. */
  readonly architecture?: LessonArchitectureAllowance;
}
```

`ScenarioModel` in `@distlab/scenario` becomes `ModelDescriptor` plus `checks`
and `instantiate`. The new diagnostic codes `PEER`, `INTERFACE`, `PUBLISH`,
and `STORAGE` join `DiagnosticCodes`. The placeholder error code
`NOT_IMPLEMENTED` is exported beside the descriptor types. Presentation copy,
such as slot labels, model display names, and option labels, is UI data keyed
by lesson and model. It is not part of the contract.

## Required tests

- **ARCH-AC-1 Unchanged lessons.** Every packaged document passes the
  composition rules. Every packaged lesson gives the same applied document,
  `runId`, and export with no overlay, with an overlay without `architecture`,
  and with an empty `architecture`. Golden digests do not change. OVL-AC-1
  still passes.
- **ARCH-AC-2 Normalized round trip.** For each fixture design,
  `diff(packaged, apply(overlay))` equals the normalized edits. Drafts that
  reach the same design through edits in a different order normalize to the
  same overlay and the same `runId`.
- **ARCH-AC-3 Design replay.** Two fresh loads of the same lesson and design
  give canonically equal exports and `runId`. Reset gives an equal export.
  Changing any single edit changes `runId`.
- **ARCH-AC-4 Composition diagnostics.** Each composition code (`PEER`,
  `INTERFACE`, `LINK`, `PUBLISH`, `STORAGE`, `OWNERSHIP`, `DUPLICATE`,
  `SUBSCRIPTION`) has a rejection test reached through an architecture edit.
  The rejection returns overlay-relative paths sorted by path, then code. A
  diagnostic on a packaged location caused by an edit is attributed to that
  edit. A rejected load creates no session and draws no randomness.
- **ARCH-AC-5 Descriptor truth.** Each `ScenarioModel` equals its data-only
  descriptor. Across every packaged lesson and fixture design, each recorded
  `network.request.sent` goes to a bound peer with a declared call, each
  publication goes to a declared destination, and each committed table is a
  declared table.
- **ARCH-AC-6 Allowance integrity.** For each slot, every allowed model
  substituted alone gives a document that passes `ScenarioEngine.validate`.
  Every binding candidate exists. No ADR-004 parameter targets a slot
  component. Peer names and option keys of each model are disjoint.
- **ARCH-AC-7 Boundary.** The main thread imports descriptors and policies only
  from data-only modules, never imports composition or overlay application
  code, and never sends an applied document or preview. Node positions never
  enter a worker message.

## Alternatives considered

- **Authoring handlers (code or block programming).** Rejected. It means
  executing arbitrary code, which is a vision non-goal. It puts determinism in
  the student's hands, and it moves the lesson from distributed-system
  semantics to programming.
- **The main thread sends a whole edited `ArchitectureDefinition`.** Rejected
  for the same reasons ADR-004 rejected applied documents. The host would accept
  arbitrary topologies, and the main thread would need composition code.
- **A gesture log as the serialized format.** Rejected. The same design reached
  in a different order would have a different identity. Replay would depend on
  the editor's history instead of the design.
- **A new `wiring` field in `ScenarioDefinition`.** Rejected. It changes the
  contract and every packaged document and golden digest. Peers as declared
  configuration fields with defaults change neither.
- **Links as free student edits, separate from peers.** Rejected for the first
  increment. A link that no model uses changes nothing observable. A model that
  calls a peer without a link fails the run. Deriving links from bindings
  removes both cases.
- **Implicit subscriptions and resources.** Rejected. Attaching a database
  automatically whenever a model needs one would hide database ownership and
  subscription, which vision §14 and architecture §17 teach. The
  editor may offer a one-click fix that adds the explicit edit to the draft.
- **Student-chosen component IDs in the first increment.** Deferred to the
  sandbox increment. The lesson's workload, assertions, and faults could not
  refer to them, so a constrained exercise could not assess them.
- **Main-thread validation with shared pure code, or a dry-run command.**
  Rejected for now. It creates a second validator or a second construction-like
  path beside `load`. Affordances from data catch most mistakes before Apply,
  and the worker's diagnostics catch the rest.
- **A separate sandbox mode.** Rejected. A sandbox is a lesson with a broad
  allowance, so one validator and one identity rule cover both.
- **Calling the peer concept a "port".** Rejected. The kernel already uses
  "port" for injected capabilities.

## Consequences

- Students can design within a lesson: fill a gap, rewire a dependency, give a
  service its own database, and subscribe a consumer. Every design is still a
  reproducible experiment with its own `runId`.
- Catalog models gain descriptors and stop hardcoding peers. This is a
  behavior-preserving refactor of `packages/catalogs`. Packaged documents and
  golden digests are unchanged.
- `ScenarioEngine.validate` becomes stricter for every document. Wiring
  mistakes that used to end a run are now caught before construction. This
  also helps the instructor documents of #99.
- The host rule stays "an exact packaged document plus an overlay that the
  lesson's policy allows". Kernel and runtime models are unaware of the
  editor. The dependency direction is unchanged.
- The ADR-004 limit that an overlay cannot edit topology is lifted for edits
  that a lesson's architecture allowance permits. Workload, assertions, seed,
  start time, external behavior, and `RunInputs.configuration` remain
  out of reach.
- A rejected design load destroys the current session, as any rejected load
  does under ADR-004. The draft survives. If students iterate on designs
  often, a later ADR may revisit keeping the old session.
- Packaged assertions may FAIL for a student's design. Under #96 that is the
  intended feedback, not a broken simulator.

## Follow-up work

| Issue | Outcome | Depends on |
| --- | --- | --- |
| #108 | Model descriptors and peers in catalogs; models read peers from configuration | None |
| #109 | Composition rules in `ScenarioEngine.validate` | #108 |
| #110 | Architecture edits in session overlays: contracts, validation, application, attribution | #109, #94 |
| #111 | Placeholder models and a first "fill the gap" lesson | #110 |
| #112 | Design editor in the browser: preview, gestures, diagnostics | #110, #111 |

The sandbox increment is not ticketed yet. It follows #112 and the instructor
scenario documents of #99.

## Verification and traceability

ARCH-AC-1 to ARCH-AC-7, together with the existing OVL-AC-1 to OVL-AC-6 and
APP-AC-5 to APP-AC-7, verify this decision. It serves the vision's DESIGN step
(§1, §12, §13), progressive complexity (§22), reproducibility (§15), and
assessment of different valid solutions (§21). It adds no simulation semantics.
It refines the application boundary and scenario validation, as architecture
§40 requires.

## References

- [ADR-004: Session overlays](004-session-overlays.md)
- [Application boundary](../application-boundary.md)
- [Architecture visualization](../architecture-visualization.md)
- [Scenario Engine](../scenario-engine.md), [Service runtime](../service-runtime.md),
  [Virtual network](../virtual-network.md)
- [Architecture: database ownership](../../architecture.md#17-database-ownership),
  [UI architecture](../../architecture.md#36-ui-architecture),
  [change policy](../../architecture.md#40-architectural-change-policy)
- [Vision](../../vision.md)
