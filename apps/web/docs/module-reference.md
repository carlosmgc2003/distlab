# Browser application module reference

This reference is for developers tracing the browser application's dependencies,
transport, and read-only teaching views. It covers all 29 TypeScript modules in
`apps/web/src/`, including the three worker modules, and the accompanying
stylesheet. Source links are relative to this document.

## Application boundaries

`src/worker/` is the sole browser runtime composition root.
`worker/adapter.ts` constructs scenario sessions; `worker/entry.ts` connects that
adapter to the worker message transport. The main thread receives detached
`RuntimeProjectionSet` values through `SimulationHost`.

Main-thread modules may import application types from `@distlab/contracts`, the
host client, local presentation modules, and these data-only catalog sources:

- `packages/catalogs/src/scenarios.ts`
- `packages/catalogs/src/commerce/scenarios.ts`

Main-thread imports of runtime model factories, `DeterministicScenarioEngine`
or other ScenarioEngine implementations, low-level mutation ports, worker
implementation modules, `@distlab/kernel`, `@distlab/scenario`, and the runtime
catalog barrel `@distlab/catalogs` are prohibited. The worker URL in
`browser-host.ts` starts a separate module worker; it does not import worker code
into the main-thread module graph. Shared protocol shapes come from
`@distlab/contracts`; local UI state types do not extend the simulation protocol.
The import checks in [boundaries.test.ts](../tests/boundaries.test.ts) traverse
the main-thread graph and restrict contract imports to application types.

Execution history is an immutable sequence of stored `Observation` values.
Readers use stored sequence, identifiers, virtual time, correlation fields, and
available payload fields. `records.ts` centralizes record interpretation.
Redacted or omitted payloads are never reconstructed. Simulation status is a
projection field, not a command. Pending events, processed events, and random
draws are explicit simulation counters; observation counts do not substitute
for any of them.

Architecture playback is presentation over observations the worker already
published. Browser timers may move its cursor or paint a movement token on a
measured link path. They must not advance virtual time, allocate an observation,
or send a worker command. Selecting a row in Recorded history is review
navigation and has its own selection state. Neither playback pace nor graph
distance measures simulated latency.

The governing context is [CONTEXT.md](../../../CONTEXT.md),
[architecture.md](../../../docs/architecture.md), and the shared contracts in
[docs/spec/](../../../docs/spec/).

## `main.tsx`

[Source](../src/main.tsx)

- **Responsibility:** mount the React application and own its browser lifetime.
- **Imports and boundaries:** `react-dom/client`, `App.tsx`, and
  `browser-host.ts`; runtime construction remains behind the worker URL.
- **State and protocol:** creates one host and React root. `pagehide` disposes
  the host; Vite hot-module disposal removes the listener, unmounts the root,
  and disposes the host.
- **Presentation/runtime separation:** starts the UI and transport lifetime;
  it contains no scenario engine or simulation control implementation.

## `browser-host.ts`

[Source](../src/browser-host.ts)

- **Responsibility:** supply the browser-specific worker factory.
- **Imports and boundaries:** imports only `SimulationHost` from `host.ts`.
  `new URL("./worker/entry.ts", import.meta.url)` identifies the separate worker
  bundle, created with `{ type: "module" }`.
- **State and protocol:** `createBrowserHost` returns a host whose factory
  creates a fresh `Worker` when a scenario is loaded.
- **Presentation/runtime separation:** exposes the host client without exposing
  runtime models or mutation ports to React.

## `host.ts`

[Source](../src/host.ts)

- **Responsibility:** `SimulationHost` owns worker lifetime, command promises,
  event correlation, and an observable `HostSnapshot`.
- **Imports and boundaries:** application types from `@distlab/contracts` and
  validation/cloning from `protocol.ts`. `WorkerPort` is a transport interface,
  allowing worker creation to be injected.
- **State and protocol:** generation and sequence form request IDs; a pending
  map tracks commands. Loading releases the previous worker and rejects its
  pending promises. Generation checks ignore stale worker callbacks. `accepted`
  acknowledges transport acceptance without settling a control; `loaded`,
  `run.finished`, and appropriate `projection.updated` events settle commands.
  Invalid envelopes and transport failures release the worker. Successful reset
  increments the host-owned `attempt`, since deterministic `runId` can repeat.
  A projectionless `SIMULATION_FAILED` can still be reset.
- **Session overlays:** `load(scenario, overlay?)` sends the exact packaged
  document and, when present, the student's draft overlay in one `load`
  command. `session` in the snapshot is the `SessionIdentity` from the latest
  `loaded` event (lesson, seed, normalized overlay); it is present only with a
  projection and survives Reset, which takes no overlay.
- **Presentation/runtime separation:** frozen snapshots contain projection,
  error, loading, pending command types, attempt identity, and the applied session. Pending commands
  describe transport state; projected simulation status describes lifecycle.
  The host sends `load`, `run`, `pause`, `step`, and `reset`, never `status`.

## `protocol.ts`

[Source](../src/protocol.ts)

- **Responsibility:** validate version 1 command/event envelopes and detach
  canonical values at both sides of the transport.
- **Imports and boundaries:** shared application protocol types only, from
  `@distlab/contracts`; no kernel or scenario validation dependency.
- **State and protocol:** `isCanonical` rejects capabilities, accessors,
  unsupported object prototypes, cycles, non-finite numbers, negative zero,
  and malformed arrays. `detached` performs `structuredClone` and recursive
  freezing. Validators check permitted envelope keys (an optional `overlay` on
  `load` only, a required `session` on `loaded`), projection structure,
  lifecycle values, observation fields, and explicit counters. `requestIdOf`
  reads a data-property descriptor without invoking an accessor;
  `applicationError` creates a detached error.
- **Presentation/runtime separation:** transport shape validation does not
  normalize scenarios, construct runtime components, or authorize new inputs.

## `scenarios.ts`

[Source](../src/scenarios.ts)

- **Responsibility:** assemble the browser's packaged scenario picker and
  lesson descriptions.
- **Imports and boundaries:** `ScenarioDefinition` as a contract type,
  `detached` from `protocol.ts`, and the two permitted data-only catalog sources.
  Re-exports checkout lesson copy.
- **State and protocol:** `scenarios` contains two checkout documents and ten
  commerce lessons, with IDs, families, titles, descriptions, comparisons,
  detached documents, and each lesson's data-only overlay policy (the same value
  the worker enforces from its own catalog). `packagedMetadata` casts these complete packaged values
  for static display; `experimentLabel` supplies picker wording.
- **Presentation/runtime separation:** comparison choices and expected lesson
  behavior are teaching copy. Runtime validation belongs to the worker; the
  main thread neither normalizes untrusted scenarios nor chooses model factories.

## `App.tsx`

[Source](../src/App.tsx)

- **Responsibility:** compose scenario selection, execution controls,
  Architecture, Recorded history, lesson guidance, and evidence navigation.
- **Imports and boundaries:** React, the host type, scenario metadata, graph
  mapping, playback, timeline terminal formatting, checkout fault inspection,
  and local React presentation components. No runtime package imports.
- **State and protocol:** subscribes with `useSyncExternalStore`; owns selected
  and loaded choices, workspace tab, history-control visibility, graph emphasis,
  and evidence-focus tokens. Busy checks guard session replacement, which calls
  `host.load`. Loaded family chooses checkout or commerce facts. Session keys
  include host attempt identity so reset can remount review state even when the
  deterministic run fingerprint repeats. Owns the draft overlay, the overlay
  last submitted (to place `INVALID_OVERLAY` diagnostics), and graph picking.
  Apply and Compare call `host.load` with the packaged document and an overlay;
  choosing a lesson starts from an empty draft. Compare carries the applied
  overlay with `carryOverlay` and lists any dropped parameter overrides. The
  run identity line shows seed, student fault count, and a short `runId`.
- **Presentation/runtime separation:** owns `useFlightPlayback` outside the tab
  panels so playback survives tab switches. Explicit history selection releases
  the playback cursor; automatic live cues do not. Evidence links activate
  Recorded history and request row focus, without executing simulation work.
  Overview text distinguishes expected lessons from observed business outcomes.

## `break-faults.ts`

[Source](../src/break-faults.ts)

- **Responsibility:** the Break panel's pure model (ADR-004): fault kinds a
  lesson policy allows, targets from the packaged architecture, mapping form
  text one-to-one to `FaultRule` or a scheduled `fault` action, chip text,
  draft/overlay conversion, placement of worker diagnostics on entries and
  fields, Compare carry rules, and graph fault marks.
- **Imports and boundaries:** contract types only. `STUDENT_PREFIX` mirrors the
  contract constant, checked by a unit test.
- **State and protocol:** form checks reject only text with no contract value
  (not a whole number, a probability outside 0 to 1, no target). Time windows,
  copy limits, overlapping duplicates, and the policy are left to the worker,
  whose `INVALID_OVERLAY` paths point into the submitted overlay. A response
  fault names the responder as `source`, because the response travels back
  along the link.
- **Presentation/runtime separation:** never validates or applies an overlay,
  and never sends a command.

## `BreakPanel.tsx`

[Source](../src/BreakPanel.tsx)

- **Responsibility:** render “Break the system”: student faults as chips
  (applied, not applied yet, or with inline diagnostics), the add/edit form,
  graph picking, and Apply.
- **Imports and boundaries:** React, contract types, `break-faults.ts`, and the
  `GraphPick` type from `ArchitectureView.tsx`.
- **State and protocol:** owns the form, field errors, and the entry being
  edited. The draft, open state, and picking state belong to `App.tsx`. Editing
  is available when no command is outstanding and the simulation is not
  running; otherwise the applied faults stay listed read-only. A draft that
  differs from the applied overlay says that applying it replaces the session.
- **Presentation/runtime separation:** Apply hands the draft overlay to the
  shell, which sends an ordinary `load`. Nothing here edits a running simulation.

## `SimulationControls.tsx`

[Source](../src/SimulationControls.tsx)

- **Responsibility:** present execution commands, committed simulation status,
  transport progress, and structured errors.
- **Imports and boundaries:** React's `ReactNode` type and host/snapshot types;
  controls invoke the injected host client.
- **State and protocol:** Run and Step require READY or PAUSED with no busy
  transport. Pause remains available while Run is pending or RUNNING, subject
  to competing commands. Reset is available outside a busy/RUNNING state,
  including recovery from `SIMULATION_FAILED`. Handlers guard `aria-disabled`
  buttons and call `run`, `pause`, `step`, or `reset`.
- **Presentation/runtime separation:** commands cross the worker boundary.
  Status, virtual time, processed events, and pending events come directly from
  the simulation projection. Child content can place playback controls beside
  execution controls without combining their semantics.

## `checkout-display.ts`

[Source](../src/checkout-display.ts)

- **Responsibility:** supply supplemental titles and model-owned resource copy
  for the two shipped checkout lessons.
- **Imports and boundaries:** `ComponentNodeProjection` as a shared type only.
- **State and protocol:** a frozen table is gated by exact scenario name,
  component ID, model, kind, and version `1.0.0`; unsupported combinations return
  `undefined`.
- **Presentation/runtime separation:** these labels describe packaged models;
  they are neither simulation inputs nor new architecture contract fields.

## `architecture-view.ts`

[Source](../src/architecture-view.ts)

- **Responsibility:** map architecture projections and matching static metadata
  into React Flow nodes, edges, link identities, and movement-token styles.
- **Imports and boundaries:** application contract types, React Flow values and
  types, `checkout-display.ts`, `flight.ts`, and `records.ts` movement-edge types.
- **State and protocol:** `mapArchitecture` rejects duplicate component IDs and
  links to absent nodes. It sorts nodes, uses fixed checkout positions or
  client-rooted commerce layout, and attaches configuration/resources only for
  matching metadata. Request, publication, and subscription links receive
  separate identities and styles. A gated checkout publication edge supplements
  packaged lesson display. `movementEdges` exports read-only drawn-link identity.
- **Presentation/runtime separation:** takes `ArchitectureProjection`, not a
  simulation mutation port. `flightTokenStyle` sets CSS path, stop position, and
  duration for a supplied recorded movement; it does not measure virtual latency.

## `ArchitectureView.tsx`

[Source](../src/ArchitectureView.tsx)

- **Responsibility:** render the read-only architecture graph, measured movement
  tokens, legend, narration, and component inspector.
- **Imports and boundaries:** React, React Flow, application architecture types,
  `architecture-view.ts`, playback presentation/types, `ComponentInspector`,
  `HelpHint`, timeline emphasis helpers, and React Flow/application CSS.
- **State and protocol:** owns selected component ID and viewport behavior.
  Selection changes are accepted; graph edits and reconnection are disabled.
  Playback's current movement takes painting precedence over history emphasis.
  Custom edges calculate one smooth-step path for both the drawn link and its
  token, adjusting token size against zoom. `ResizeObserver` and
  `requestAnimationFrame` refit the measured canvas; session changes restore fit.
- **Presentation/runtime separation:** receives architecture, metadata,
  playback, emphasis, and a supplied facts renderer. Pan, zoom, fit, selection,
  and token animation affect the browser view only. Component selection does
  not reconstruct historical runtime state at the playback cursor.

## `ComponentInspector.tsx`

[Source](../src/ComponentInspector.tsx)

- **Responsibility:** show a selected component's static architecture metadata
  and a slot for independently supplied runtime facts.
- **Imports and boundaries:** `ReactNode` and architecture-node types, plus
  category labels from `architecture-view.ts`.
- **State and protocol:** receives the selected node; displays ID, category,
  declared model/version, configuration, and resource ownership, with explicit
  absent-metadata messages.
- **Presentation/runtime separation:** does not fetch runtime state. Children
  supplied by the shell carry authorized projected facts separately from metadata.

## `records.ts`

[Source](../src/records.ts)

- **Responsibility:** centralize interpretation of stored observations:
  ordering, milestones, movement, correlation, visibility, and stored changes.
- **Imports and boundaries:** only `CanonicalValue`, `Observation`, and
  `SimulationTime` contract types. No React, graph layout, filters, or transport.
- **State and protocol:** `orderObservations` preserves an already sequence-sorted
  list or sorts stably by `Observation.sequence`; ties keep published order.
  `continuesHistory` checks an ID/sequence prefix. `milestoneKinds` and
  `recordKind` classify teaching milestones, including other `fault.*` records.
  `traceView` builds cycle-safe span trees and reports unresolved stored causes;
  `correlation` resolves stored causation and parent-span references. `movementOf`
  recognizes stored network and bus movement; `edgeFor` resolves it against
  presentation-supplied link identity.
- **Presentation/runtime separation:** readers expose available scalar/nested
  fields, delivery attempts, before/after changes, and external changes without
  manufacturing missing evidence. `payloadVisibility` distinguishes an absent
  `data` field from the `{ redacted: true }` marker and visible data. Presentations
  retain their own wording and styling; record readers do not create observations.

## `timeline.ts`

[Source](../src/timeline.ts)

- **Responsibility:** supply timeline wording, Learning reduction, graph emphasis,
  selection navigation, row-window geometry, and terminal-failure copy.
- **Imports and boundaries:** shared application types and `records.ts` readers
  and movement types; no host client or runtime package.
- **State and protocol:** `recordLabel` names stored types and delivery attempts.
  `learningTimeline` collapses only adjacent startup scheduler/clock bookkeeping
  before the first event and adjacent assertion evaluations with unchanged stored
  data and correlation context. Group members retain original observations.
  `visibleRowRange` supports fixed-height Raw virtualization. `selectionStep`
  handles bounds and initially unselected lists. `terminalMark` distinguishes
  complete, incomplete, and unreported execution-history completeness.
- **Presentation/runtime separation:** `changeEvidence` reads stored changes;
  `emphasisFor` marks explicit selection and movement. Navigation and filter
  feedback describe UI actions. `movementPulseClass` creates a stable CSS token,
  not a random draw or new observation identifier.

## `timeline-query.ts`

[Source](../src/timeline-query.ts)

- **Responsibility:** define and evaluate UI-owned timeline queries, drafts,
  suggestions, active chips, validation, and evidence-reveal transformations.
- **Imports and boundaries:** shared observation/filter/entity/time types and
  `orderObservations` from `records.ts`; no execution-history reader instance.
- **State and protocol:** filters combine with AND; time bounds are inclusive
  nonnegative safe integers. Text modes are case-sensitive Exact, Prefix, and
  Contains. Component matches source or target; entity kind and ID must match
  the same stored entity reference. Suggestions use stored envelope fields,
  ignore payloads, and show at most eight choices by default. Choosing a
  suggestion applies Exact. `readerFilter` returns a compatible shared filter
  only when all text criteria are exact and entity kind/ID are paired.
- **Presentation/runtime separation:** queries project the available snapshot.
  `revealTimelineObservation` clears constraints that hide a stored observation;
  `narrowToTrace` replaces the draft with one exact trace criterion and reports
  cleared constraints. Neither operation reads hidden payloads or changes history.

## `timeline-quick-views.ts`

[Source](../src/timeline-quick-views.ts)

- **Responsibility:** declare quick-view predicates, their counts and feedback,
  and recorded-component chips.
- **Imports and boundaries:** `Observation`, record ordering/categories, and
  local component-title types from `timeline-query.ts`.
- **State and protocol:** six presets cover key events, faults/timeouts,
  requests/responses, messages, state changes, and assertions. Each keeps whole
  observations by stored type or milestone category. Counts use the full
  supplied snapshot; summaries state shown versus recorded observations.
  `revealQuickView` clears a preset only when it hides the target observation.
  Component chips use recorded sources/targets and omit the `simulation` source
  pseudo-component; advanced suggestions can still include it.
- **Presentation/runtime separation:** presets are UI predicates, not kernel
  filters. They preserve sequence and never merge observations, infer severity,
  or change simulation counters.

## `story-timeline.ts`

[Source](../src/story-timeline.ts)

- **Responsibility:** project teaching milestones and generate lane, shape,
  legend, count, and accessible summary data for Story.
- **Imports and boundaries:** `Observation` and milestone readers/types from
  `records.ts`; no host or graph-layout dependency.
- **State and protocol:** each milestone holds its exact original observation.
  Milestone columns follow sequence order, lanes are stored sources in
  first-milestone order, and time-boundary flags compare adjacent milestone
  virtual times. Labels use a typed milestone-wording table; delivery labels
  include only the stored attempt.
- **Presentation/runtime separation:** reduction affects the display only.
  Non-milestone observations remain available in Learning and Raw. Summary and
  detail text explicitly avoid inferred duration or causality beyond stored fields.

## `TimelineView.tsx`

[Source](../src/TimelineView.tsx)

- **Responsibility:** render Story diagram/table, Learning groups, virtualized
  Raw rows, filters, observation details, and stored correlation links.
- **Imports and boundaries:** React and `Observation`, plus `timeline-query.ts`,
  `timeline-quick-views.ts`, `records.ts`, `timeline.ts`, `story-timeline.ts`, and
  `HelpHint`. Receives observation snapshots, drawn-link identities, titles, and
  UI callbacks; has no host client.
- **State and protocol:** owns filter draft and last valid query, quick view,
  display mode, expanded groups, selected observation ID, feedback, live cue,
  scroll window, and focus requests. Quick views apply before advanced filters.
  Invalid drafts keep the last valid query. Evidence reveal switches to Raw,
  removes only hiding constraints, selects the exact ID, and focuses its row.
  Raw keeps the selected row in the DOM even outside the virtualized window.
  History replacement clears review/filter state; appended history may produce
  a newest-recorded-movement cue. Detail links resolve stored causes, spans,
  traces, events, entities, and before/after evidence.
- **Presentation/runtime separation:** explicit selection emits emphasis with
  origin `selection`; automatic movement cues use `live`. Review selection is
  independent of the architecture playback cursor. Timers dismiss a visual cue
  or clipboard feedback only. Suggestions, clipboard fallback, scroll/focus,
  filters, and all three views leave worker execution and published history intact.

## `flight.ts`

[Source](../src/flight.ts)

- **Responsibility:** convert recorded movement into graph playback steps,
  narration facts, token appearance, position text, and transport transitions.
- **Imports and boundaries:** observation/value/time contract types, `records.ts`
  readers and movement types, and timeline labeling/selection helpers.
- **State and protocol:** `flightSteps` keeps one step per movement in stored
  sequence order; observations that travel no link remain in Recorded history.
  Steps retain observation ID, sequence, time, endpoints, and available trace ID.
  `flightFacts` names stored fields and changes; redacted/omitted data contributes
  a visibility statement only. Pace options set browser delays of 1800, 900,
  and 350 ms. `flightAdvance` waits at the recorded tail while execution is
  recording, then ends when no more recording is underway. Drops/timeouts use
  interrupted glyphs and presentation stop positions on the link.
- **Presentation/runtime separation:** pattern prompts are teaching questions,
  not assertions about component conclusions. Position and boundaries describe
  recorded movements and virtual times; token stops and pace are visual choices.
  Restart rewinds the browser cursor, not the simulation.

## `flight-playback.ts`

[Source](../src/flight-playback.ts)

- **Responsibility:** `useFlightPlayback` own the architecture cursor, phase,
  pace, current movement, and play/pause/restart/step callbacks.
- **Imports and boundaries:** React hooks, `flight.ts`, `selectionStep` from
  `timeline.ts`, local movement-edge types, and the shared observation type.
- **State and protocol:** stores index and phase together; memoizes steps from
  observations and drawn edges. Shorter histories clamp the cursor, while an
  explicit review-release identity resets it to idle. Manual previous/next
  pause active playback. A host timeout advances at the selected pace or polls
  every 200 ms while waiting at a recording tail, with cleanup on dependency
  changes and unmount.
- **Presentation/runtime separation:** timers read published observations and
  move local state only. They never advance virtual time, allocate an
  observation, or send a worker command. The recording flag controls waiting;
  it is not a request to execute more work.

## `ArchitecturePlayback.tsx`

[Source](../src/ArchitecturePlayback.tsx)

- **Responsibility:** render graph playback controls, cursor readout, and the
  currently painted movement's narration.
- **Imports and boundaries:** pace data from `flight.ts` and local playback,
  position, and step types; no host or runtime dependency.
- **State and protocol:** `FlightControls` calls supplied cursor callbacks and
  chooses play/restart/pause labels and previous/next availability from the
  transport model. `FlightReadout` announces cursor position.
  `FlightNarration` displays route, stored facts, trace, interruption text,
  glyph/shape, and a pattern question.
- **Presentation/runtime separation:** help text states that navigation sends
  no simulation command. Narration uses the already-built `FlightStep`; it does
  not infer business results from a token reaching or stopping on a link.

## `fault-inspection.ts`

[Source](../src/fault-inspection.ts)

- **Responsibility:** build the checkout `FaultReport` from projected facts,
  stored observations, and packaged scenario metadata.
- **Imports and boundaries:** application contract types and checkout lesson
  copy from local `scenarios.ts`; no runtime model dependency.
- **State and protocol:** uses only `visibility: "student"` component states.
  Extracts committed service rows/revisions, lifecycle/process generation,
  payment outcomes, declared processor authorizations, client request/outcome,
  and bus delivery facts. Declared fault rules remain `recorded` unless a stored
  `fault.effect.selected` names the rule. Evidence links carry original
  observation IDs, sequences, types, and virtual times.
- **Presentation/runtime separation:** compares local payment knowledge with
  separately declared processor facts. Timeout means a missing response and
  does not prove denial or rollback. No staged transaction, provider counter,
  host-only state, or inferred operation duration enters the report.

## `FaultInspectionView.tsx`

[Source](../src/FaultInspectionView.tsx)

- **Responsibility:** render checkout distributed-state comparisons and
  component-specific authorized runtime facts.
- **Imports and boundaries:** React, `HelpHint`, and report/fact types from
  `fault-inspection.ts`; no host or runtime imports.
- **State and protocol:** `DistributedState` displays scenario/seed, fault
  selection, Payments' local state beside processor-visible facts, client
  outcome, committed service rows, bus attempts, and linked observations.
  `ComponentRuntimeFacts` routes the selected component to its report fields.
  Semantic CSS classes format existing strings without changing their meaning.
- **Presentation/runtime separation:** supplied evidence callbacks navigate to
  stored observations only. Expected scenario outcomes and projected facts are
  distinguished; missing student-visible state is reported explicitly.

## `CommerceLesson.tsx`

[Source](../src/CommerceLesson.tsx)

- **Responsibility:** render commerce component facts and lesson assertion results.
- **Imports and boundaries:** only shared canonical-value and runtime-projection
  types; no runtime model, host, or catalog dependency.
- **State and protocol:** `CommerceFacts` selects the named student-visible state
  and formats lifecycle, committed tables, KV entries, client-observed fields,
  declared external availability/visible state, and delivery records.
  `CommerceState` lists student components and reads assertions from the
  `commerce-client` projection, displaying stored status, ID, and optional time.
- **Presentation/runtime separation:** host state and tasks are never rendered.
  Passing an unsafe lesson verifies the expected failure assertion; it does not
  imply a safe business outcome. These facts are the current published projection,
  not state reconstructed for a selected historical observation.

## `ui-hint.tsx`

[Source](../src/ui-hint.tsx)

- **Responsibility:** provide the reusable `HelpHint` explanation popover.
- **Imports and boundaries:** React hooks and `ReactNode` only.
- **State and protocol:** owns hover, focus, pinning, and measured viewport box.
  Hover/focus opens; click pins; Escape and outside pointer interaction dismiss.
  Layout measurement places the fixed popover above or below its trigger and
  tracks resize/scroll. Generated or supplied IDs connect trigger and body;
  the explanation remains in the DOM while hidden.
- **Presentation/runtime separation:** all state is local interaction/layout.
  The body contains explanatory content rather than simulation controls.

## `worker/entry.ts`

[Source](../src/worker/entry.ts)

- **Responsibility:** connect the module worker's global message channel to
  `WorkerAdapter`.
- **Imports and boundaries:** imports only `WorkerAdapter` from `adapter.ts`;
  this entry is reached through the browser worker URL.
- **State and protocol:** creates one adapter, posts its outgoing events with
  `globalThis.postMessage`, and forwards incoming unknown data to `receive`.
- **Presentation/runtime separation:** executes in the worker context and
  exposes serialized messages, never live runtime objects or UI components.

## `worker/adapter.ts`

[Source](../src/worker/adapter.ts)

- **Responsibility:** serve as the runtime composition root, construct packaged
  scenario sessions, delegate controls to Simulation, and publish projections.
- **Imports and boundaries:** shared application types; checkout/commerce
  catalogs, assessments, and packaged documents from `@distlab/catalogs`;
  `canonicalEncode` from `@distlab/kernel`; engine/normalization/session from
  `@distlab/scenario`; shared transport helpers and worker student-projection
  helpers. Runtime dependencies are permitted here because it is worker-owned.
- **State and protocol:** owns the session, normalized definition, architecture
  projection, family flag, active control promise, and outgoing callback. Load
  accepts only canonical-equal copies of the two checkout documents or ten
  packaged commerce lessons, then takes that lesson's overlay policy from its
  own catalog and calls `composeOverlay` (ADR-004 stages 3 and 4) before
  creating the session from the applied document. A rejected overlay returns
  `INVALID_OVERLAY` with `{ diagnostics }`; `loaded` carries the applied
  `SessionIdentity`. Load failure
  exposes no old session. Concurrent non-pause controls get `CONTROL_BUSY`;
  Pause delegates immediately and waits for the active control to settle.
  Run uses a host yield cadence of 16 events and optional event limit; Step and
  Reset delegate directly. Errors report structured failure context and publish
  a failed projection when execution history is complete enough to do so.
- **Presentation/runtime separation:** `MessageChannel` samples read models
  between synchronous event boundaries, coalescing by `processedEvents` without
  advancing or pausing execution. Projection status/time and all three counters
  come from Simulation, not observation inference. Detached output includes
  observations, host component entries, and authorized student entries.
  Architecture links come from normalized declarations, including explicit
  versioned commerce publication mappings, not reconstruction from history.
  Subscriber or projection-stream errors cannot control the run.

## `worker/student-projection.ts`

[Source](../src/worker/student-projection.ts)

- **Responsibility:** form authorized student read models from assessment data.
- **Imports and boundaries:** shared architecture, canonical-value, and
  component-projection types only; used by the worker adapter.
- **State and protocol:** `studentComponents` exposes checkout client
  request/outcome, service lifecycle/process generation and committed
  revision/tables, selected processor authorization fields, and bus delivery
  facts. `commerceComponents` exposes service committed rows and declared KV
  entries/metrics, client-observed state plus assertion results, declared
  external availability/visible state, and destination-scoped delivery records.
  Helpers validate the expected record shapes and use explicit absent-state
  defaults.
- **Presentation/runtime separation:** runtime tasks, provider handles/counters,
  and arbitrary internal component state are excluded from student entries.
  The adapter preserves its separate host entries without rendering them.
  These are authorized current read models, not browser-generated observations.

## `architecture.css`

[Source](../src/architecture.css)

- **Responsibility:** style the shell, graph, inspectors, timeline views,
  commerce facts, help hints, and responsive layouts.
- **Imports and boundaries:** loaded by `ArchitectureView.tsx` alongside React
  Flow's stylesheet; no JavaScript or runtime package import.
- **State and protocol:** selectors consume UI attributes/classes for tabs,
  selection, semantic states, milestone categories, and playback tokens. Token
  animation consumes the measured `--flight-path`, visual stop, and browser
  duration supplied by the graph. Media rules accommodate narrow/short viewports
  and reduced motion.
- **Presentation/runtime separation:** CSS animation changes paint only.
  Shape, glyph, border pattern, and text supplement color; animation duration
  never represents virtual execution time or a network latency measurement.

## Existing documentation discrepancies

Three differences are relevant when reading these modules; this reference does
not change their source or the existing design documents:

- `records.ts` includes `network.request.timedout` in `milestoneKinds`, while
  [learning-timeline.md](../../../docs/learning-timeline.md) does not list it
  among Story milestones. The source explicitly records this pending discrepancy
  and states that its document-consistency test fails until resolved.
- [learning-timeline.md](../../../docs/learning-timeline.md) still describes
  playback in Raw. The current application and root context put playback on the
  architecture graph only; Recorded history row selection is independent review
  navigation.
- The introductory ordering comment in `records.ts` mentions virtual time
  first, while its implementation orders by stored sequence. This
  reference describes that implementation and the root context's separation.
