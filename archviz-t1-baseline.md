# Architecture Visualization — T1 Verified Baseline

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Branch | `cmaceira/fix-component-visualization-differentiation` |
| HEAD at baseline | `52076a6` (Add architecture visualization specification draft) |
| Environment | Linux, Node v22.23.2 (toolchain requires >= 22.12), npm 12.1.0, `node_modules` present (no install needed) |
| Scope | Analysis only; no production or test code modified. This report is the only file created and stays untracked. |

## 1. Command results

All commands were run at the repo root on the unmodified working tree.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS (exit 0) | All five workspaces typecheck: contracts, kernel, scenario, catalogs, web (`tsc --noEmit` incl. test projects) |
| `npm test` | PASS (exit 0) | contracts 4/4, kernel 153/153, scenario 11/11, web 116/116 node tests, plus 66/66 Playwright browser tests (the web suite script runs `test:browser`); 0 fail, 0 skipped anywhere |
| `npm run test:boundaries` | PASS (exit 0) | 2/2 subtests: main-thread import graph; kernel/contracts no upward dependencies |
| `npm run golden:01` | PASS (exit 0) | sha256 below; byte-identical across two consecutive runs |
| `npm run golden:02` | PASS (exit 0) | sha256 below; byte-identical across two runs |
| `npm run golden:04` | PASS (exit 0) | sha256 below; byte-identical across two runs |
| `npm run golden:05` | PASS (exit 0) | sha256 below; byte-identical across two runs |
| `npm run golden:06` | PASS (exit 0) | sha256 below; byte-identical across two runs |
| `npm run golden:07` | PASS (exit 0) | sha256 below; byte-identical across two runs |
| `npm run build` | PASS (exit 0) | build:packages + `tsc --noEmit && vite build`; 215 modules, `dist/` bundles emitted (one pre-existing chunk-size warning and a `@xyflow/react` "use client" notice, both warnings only) |
| `npm run test:browser` | PASS (exit 0) | 66/66 Playwright tests against the production build (vite preview), ~1.2m |

Notes:

- There is **no `golden:03` script** in this repository (root `package.json` and
  `packages/kernel/package.json` define 01, 02, 04, 05, 06, 07 only, matching
  AGENTS.md). "golden:01 through golden:07" therefore means those six.
- Each golden was executed twice; `cmp` confirmed run 1 and run 2 stdout are
  byte-identical, so the checksums below are a stable determinism reference.
- Playwright/Chromium is already installed in this environment; no
  `browser:install` was needed.
- **Repo hygiene quirk:** every browser test run overwrites the six tracked
  evidence screenshots in `apps/web/e2e/evidence/issue-81/`
  (`architecture-flight.spec.ts:130,138,158,165,268` write fixed paths), so
  `npm test` / `npm run test:browser` leaves those PNGs modified with
  byte-level rendering churn. They were restored to HEAD after the baseline
  runs; the working tree is clean apart from this untracked report. Any
  symbol-system change will visibly alter these screenshots on the next run.

### Golden stdout checksums (sha256, stdout only, npm notices excluded)

| Golden | Bytes | sha256 |
| --- | --- | --- |
| `golden:01` | 11655 | `df96e23d6af3c120038f6c2ad0063b278ed0705b92bb63537f4a37002d9c3df3` |
| `golden:02` | 41608 | `491f223c42ced6fa5a62d7420c56ecda4e0afcf17be1f1c49027d2240b969cae` |
| `golden:04` | 29087 | `a0835df107955dcf5bbf50f012a3883ecd495941c38a740e89d342a8355686e9` |
| `golden:05` | 24228 | `6a8d3a460c0d91ed378c33f03366109e4b6c2fe6cd40ca1a77e4a875d1c3b757` |
| `golden:06` | 44935 | `aa7af3e959bfac0dce8553fa2d79ea01380e2bb36abba067732d6fe6850429bd` |
| `golden:07` | 14856 | `f19cf1fc92a95837a9fc23821267d8eeb897cfdd129d5d0cfbc874e2f245ae7b` |

## 2. Current rendering path inventory

The rendering path is: worker publishes `ArchitectureProjection` → shell pairs
it with packaged `ArchitectureDefinition` metadata → `mapArchitecture` builds
React Flow nodes/edges → `ArchitectureView` renders them → CSS styles
categories → `ComponentInspector` shows static metadata.

### 2.1 Composition and data entry (shell)

- `apps/web/src/App.tsx:36` — `packagedMetadata(loadedChoice)` returns the
  packaged `ScenarioDefinition` (its `architecture` field is the
  `ArchitectureDefinition` metadata used below).
- `apps/web/src/App.tsx:39-41` — `mapArchitecture(projection.architecture,
  lesson.architecture, lesson.name)` and
  `movementEdges(graph.edges)`.
- `apps/web/src/App.tsx:48-49` — `movementEdges` output feeds
  `useFlightPlayback` (replay cursor over recorded observations).
- `apps/web/src/App.tsx:195-198` — `<ArchitectureView …>` receives
  `architecture`, `metadata` (`lesson.architecture`), `scenarioName`
  (`lesson.name`), `emphasis`, `inspectorFacts` (commerce `CommerceFacts` or
  checkout `ComponentRuntimeFacts`), `sessionKey`, `playback`.
- `apps/web/src/scenarios.ts:23-27` — the packaged list: 2 checkout lessons +
  10 commerce lessons; `scenarios.ts:35-37` `packagedMetadata` casts the
  detached catalog `CanonicalValue` to `ScenarioDefinition`.

### 2.2 Node building — `mapArchitecture`

`apps/web/src/architecture-view.ts:43-124` (pure; "copies presentation data
only"):

- `:46-49` — validation: duplicate component ids or links to missing
  components return `{ nodes: [], edges: [], error: … }`.
- `:50-51` — metadata maps: `instances` from `metadata.components`,
  `destinations` from `metadata.destinations`.
- `:52` — components sorted by id (deterministic, order-insensitive input).
- `:53` — commerce detection: any `component.model.startsWith("commerce.")`.
- `:54-61` — BFS depth from client nodes (layout depth map).
- `:63-92` — node construction: `type: "component"` (`:79`), data
  (`component`, `title`, `resources`, `configuration`), `className:
  "component-node category-${kind} nopan"` (`:90`), `ariaRole: "button"` +
  `ariaLabel` (`:89`), `draggable/connectable/deletable: false`,
  `focusable: true` (`:88`), `sourcePosition: Bottom`, `targetPosition: Top`
  (`:87`).
- `:75-77, :86` — positions: commerce grid `{ x: column * 310, y: row * 210 }`;
  checkout uses the hardcoded `checkoutPositions` map (`:34-40`), fallback
  `{ x: 930, y: index * 180 }`.
- `:64-68` — per node: `matches` requires metadata instance kind+model+version
  equality; infrastructure nodes look up the destination map; title becomes
  `MessageBus · <label>` for destinations.
- `:69-74` — **resources assembly** (the only place databases/stores surface
  today): `checkoutDisplay` copy resource + `metadata.databases` filtered by
  `owner` → string `Database owned by <owner>: <table names>` (`:71-72`) +
  `metadata.stores` filtered by `owner` → string `KeyValueStore owned by
  <owner>` (`:73`). These are strings in node data, not graph nodes.
- `:81-84` — configuration: matched instance `configuration`, else destination
  fields (`deliveryDelay`, `ackTimeout`, `retryDelay`, `maxAttempts`,
  `capacity`) for infrastructure nodes.
- `apps/web/src/checkout-display.ts:7-18` — version-gated supplemental copy
  for the two shipped checkout lessons only (titles/resources for
  customer-app, orders, payments, payment-processor).

### 2.3 ComponentNode rendering

`apps/web/src/ArchitectureView.tsx`:

- `:18-28` — `ComponentNode` (memoized): target Handles `top`/`left`, source
  Handles `right`/`bottom`; `<span class="category-label">` (`:22`), `<strong>`
  title (`:23`), optional role badge (`:24`).
- `:61-62` — `nodeTypes = { component: ComponentNode }`, `edgeTypes = { link:
  LinkEdge }`.
- `:130-241` — `ArchitectureView` component:
  - `:143-144` — `architectureKey` JSON + `useMemo(mapArchitecture…)`.
  - `:146-149` — painted emphasis: playback step (`flight`) overrides shell
    `emphasis`.
  - `:150-163` — nodes memo: `is-involved` class + movement pulse, sending /
    receiving `role` + `roleLabel`, `selected`, `aria-pressed`,
    `aria-controls="component-inspector"`.
  - `:164-168` — edges memo: `emphasize()` then attach `flight` step + `pace`.
  - `:170-182` — selection-only `onNodesChange`; Escape clears
    (`:200-206` keydown capture).
  - `:185-186` — explicit empty/error presentation states.
  - `:199-219` — canvas + `<ReactFlow>` (immutable structure, `minZoom
    0.15`, `fitViewOptions` padding 0.18), `FitToCanvas` (`:73-103`,
    ResizeObserver + requestAnimationFrame, refits on `sessionKey`),
    `PanControls` (`:116-128`), `Background`, `Controls`.
  - `:220-225` — side panel: `FlightNarration` + `ComponentInspector`.
  - `:227-235` — legend: three line samples (request/publication/subscription)
    + `FLIGHT_LEGEND` token samples (glyph + shape classes).
  - `:236-239` — `<details class="connections">` edge list.
- `:30-60` — `LinkEdge`: `getSmoothStepPath`, `BaseEdge`, and the flight token
  (`<g class="flight-token flight-<kind> shape-<shape>">` with halo/core/glyph
  circles, zoom-compensated scale `:40-41`).
- `:105-114` — `emphasize()`: movement stroke colors (request `#1d4ed8`,
  response `#0f766e`, message `#6d28d9`), `is-movement movement-<kind>`
  classes, pulse class.

### 2.4 Category styling

`apps/web/src/architecture.css`:

- `:12-13` — `:root` tokens: `--category-client: #1d4ed8`,
  `--category-service: #166534`, `--category-external: #9a3412`,
  `--category-infrastructure: #6b21a8`.
- `:171-173` — `.component-node` base box: width 215px, min-height 90px,
  padding 17px, 2px border.
- `:174-177` — the entire current shape vocabulary: client `border-radius:
  28px`; service `border-radius: 6px`; external `border-style: dashed` +
  6px; infrastructure `border: 4px double` + radius 15px. **No glyphs, no
  per-kind SVG shapes — this is what the symbol system replaces.**
- `:178-181` — category label colors.
- `:182-184` — selected (`aria-pressed`) and `:focus-visible` outlines;
  handles hidden (`opacity: 0`).
- `:212-219` — legend line samples (solid/dashed/dotted) and token samples
  (`shape-dashed`, `shape-dotted`).
- `:335` — `.react-flow__node.is-involved` box-shadow highlight.
- `:340-364` — flight token painting (`offset-path`/`offset-distance`
  animation, `flight-travel`/`flight-life` keyframes, drop/timeout rest
  opacity, `prefers-reduced-motion` fallback) and `:358-359` role badges.

### 2.5 Edge building

`apps/web/src/architecture-view.ts`:

- `:93-108` — edges from `projection.links`: relationship detection
  (`subscription` via `metadata.subscriptions` match or `link.label`;
  `publication` via `link.label`; else `request`) (`:94-97`); labels
  (`Subscribe · <topic>`, `Publish · <target>`, `Request[ · label]`) (`:98`);
  id `<relationship>:<source>:<target>:<index>` (`:100`); handles
  bottom/top for subscriptions, right/left otherwise (`:102`); marker + stroke
  (`#334155`, width 2; subscription `strokeDasharray: "7 5"`, publication
  `"2 5"`, request solid) (`:103-104`).
- `:109-122` — **hardcoded checkout publication edge** `orders → OrderCreated`
  (`id "publication:orders:OrderCreated"`), gated on `checkoutDisplay`
  matching the orders node, the `OrderCreated` destination being a topic, and
  the infrastructure node existing. (The worker projection adds publications
  only for commerce models — see §3 — so checkout's publication edge exists
  only through this presentation-side special case.)
- `:127-131` — `movementEdges()`: pure identity projection of presentation
  edges (`id`, `source`, `target`, `relationship`) consumed by playback and
  the timeline; relationship is `"request" | "subscription" | "publication"`.

### 2.6 Inspector

`apps/web/src/ComponentInspector.tsx:5-29` — static architecture metadata
only: component id, category label, model, version (`:16-21`), configuration
JSON (`:23`), and the resources list built by `mapArchitecture` (`:24-25`),
with explicit "Not declared in packaged metadata." / "No database or store
declared for this component." fallbacks. Business-state facts come separately
through the `inspectorFacts` children prop.

### 2.7 Tests that pin the current behavior

- `apps/web/tests/architecture.test.ts` (4 tests): checkout mapping (5 nodes,
  exact edge/relationship list, 3 distinct dash styles, inputs not mutated,
  metadata frozen); deterministic detached layout with exact positions;
  inspector metadata (DB resource strings, destination configuration, no
  `"authorizations"` business-state leakage, version mismatch → no
  configuration and no publication edge, foreign lesson name → no publication
  edge); empty/invalid explicit states.
- `apps/web/tests/commerce-worker.test.ts:40` — commerce lessons run through
  `mapArchitecture` (grid layout coverage).
- `apps/web/tests/flight.test.ts:156-157` — `mapArchitecture` +
  `movementEdges` feed the same routes as playback; legend test asserts every
  painted token glyph/shape is named in the legend.
- Browser: `e2e/architecture-fit.spec.ts` (fitted view at desktop baselines,
  refits on resize/tab/reset), `e2e/architecture-flight.spec.ts` (token walks
  measured path, pace, reduced motion, no worker commands),
  `e2e/smoke.spec.ts` (5 nodes / 4 edges counts, legend text, empty/invalid/
  error/private inputs), `e2e/checkout-lesson.spec.ts` (node counts,
  `.category-label` visibility), `e2e/accessibility.spec.ts` (axe on
  `.react-flow__node` at 100% and 200% zoom).

## 3. Databases, stores, and destinations: contracts → metadata → mapArchitecture

### 3.1 Contracts (`packages/contracts/src/`, read-only invariant)

- `scenario.ts:28-42` — `ArchitectureDefinition` declares `components`,
  `links` (with `NetworkPolicy`), `databases: readonly DatabaseDefinition[]`,
  `stores: readonly KeyValueDefinition[]`, `destinations: readonly
  DestinationDefinition[]`, `subscriptions`.
- `database.ts:22-26` — `DatabaseDefinition { owner: ComponentId, tables:
  TableDefinition[] (name/unique/checks), initial }`.
- `kv-store.ts:21-28` — `KeyValueDefinition { owner: ComponentId, initial:
  { key, value, ttl? }[] }`.
- `message-bus.ts:39-47` — `DestinationDefinition { id, kind: "queue" |
  "topic", deliveryDelay, ackTimeout, retryDelay, maxAttempts, capacity }`
  (normalized defaults: delay/retryDelay 0, ackTimeout 1000, maxAttempts 3,
  capacity 10000).
- `application.ts:7-22` — `ComponentNodeProjection` (kind adds
  `"infrastructure"` beyond the scenario `ComponentKind` client|service|
  external) and `ArchitectureProjection` (components + links only).
  **`ArchitectureProjection` has no databases/stores fields — resource data
  can never cross the worker boundary as graph nodes.**

### 3.2 Packaged lesson metadata (data-only catalog modules)

Worker-side validation/normalization: `packages/scenario/src/validate.ts`
(architecture keys at `:31`, destination reader `:463-489`, subscription
reader `:492+`), then `packages/scenario/src/engine.ts:130,138` instantiates
the bus from destinations.

Main-thread data modules (importable per the boundary rules):

- `packages/catalogs/src/scenarios.ts:10-28` — checkout architecture: 4
  components, 2 links, databases owned by `orders` (tables `orders`, `outbox`)
  and `payments` (tables `payments`, `inbox`), `stores: []`, destination
  `OrderCreated` (topic), subscription `OrderCreated → payments`.
- `packages/catalogs/src/commerce/scenarios.ts` — per-lesson resources (see
  §3.4).

`apps/web/src/scenarios.ts:4-6` imports both data-only modules;
`packagedMetadata` (`:35-37`) exposes the `ScenarioDefinition` (including
`architecture.databases/stores/destinations/subscriptions`) to the main
thread.

### 3.3 Worker projection and the map

- `apps/web/src/worker/adapter.ts:155-171` — `architectureProjection()`:
  declared components become nodes (label = id, kind/model/version copied);
  **each destination becomes a `kind: "infrastructure"` node** (`:159`);
  links = declared links + subscriptions (`label: "subscription"`) +
  publications derived from exact versioned models `commerce.outbox-payment →
  PaymentApproved` and `commerce.order-write → OrderUpdated` (`:165-168`).
  Databases and stores are **never** projected.
- `apps/web/src/App.tsx:36-41` pairs that projection with the packaged
  metadata; `mapArchitecture` reads `metadata.destinations` for the
  infrastructure configuration (`architecture-view.ts:66, 81-84`), and
  `metadata.databases` / `metadata.stores` **only** to build the inspector
  resource strings (`:71-73`). Subscriptions additionally drive edge
  relationship detection (`:94`).

So: databases/stores flow contracts → catalog documents → `packagedMetadata`
→ `mapArchitecture` resource strings → `ComponentInspector` list, entirely
host-side; destinations additionally flow into the worker projection as
infrastructure nodes and subscription/publication links.

### 3.4 Concrete lesson examples (databases vs KV stores)

| Lesson (`name`) | Databases (owner → tables) | KV stores (owner) | Destinations |
| --- | --- | --- | --- |
| `checkout-normal@1`, `checkout-processor-response-lost@1` | orders → orders, outbox; payments → payments, inbox | — | OrderCreated (topic), subscribed by payments |
| `retry-unsafe@1`, `retry-idempotent@1` | payments → payments, results | — | — |
| `saga-uncompensated@1`, `saga-compensated@1` | orders → orders; inventory → state; payments → state | — | — |
| `dual-write@1`, `outbox-unsafe-consumer@1`, `outbox-idempotent@1` | payments → payments, outbox; notifications → notifications, inbox | — | PaymentApproved (topic), subscribed by notifications |
| `cqrs-delayed@1` | orders → orders (initial rows); reporting → orders (initial rows) | — | OrderUpdated (topic), subscribed by reporting |
| `cascade-unprotected@1`, `cascade-breaker@1` | — | api, orders, payments (circuit-breaker state) | — |

The only lessons owning **KV stores** are the two cascade lessons
(`packages/catalogs/src/commerce/scenarios.ts:122`: `stores:
["api","orders","payments"].map(owner => ({ owner, initial: [] }))`,
`databases: []`). Every other lesson owns only databases. Inspector strings
today: `"Database owned by orders: orders, outbox"` vs
`"KeyValueStore owned by api"` (architecture-view.ts:71-73).

## 4. Risks and constraints for the symbol-system work

1. **Byte-identical goldens (hard invariant).** All six golden stdout
   checksums in §1 are the acceptance reference. Any change that touches
   `RunInputs`, seeds, scheduling, history, or worker output will break them;
   the symbol system must stay inside `apps/web/src/` presentation code.
2. **Import boundary (hard invariant).** `npm run test:boundaries` asserts the
   main thread imports application contracts and the two data-only catalog
   modules only — never runtime model factories or `ScenarioEngine`
   (`apps/web/tests/boundaries.test.ts`). New symbol code must not import
   from `packages/kernel`, `packages/scenario`, or worker modules.
3. **Read-only contracts (hard invariant).** `packages/contracts` must not
   change. The spec (`docs/spec/architecture-visualization.md:29`) requires
   reusing `DatabaseDefinition`, `KeyValueDefinition`, `DestinationKind` and
   introducing **no new contract aliases**; new node types are UI-local
   presentation types only.
4. **Worker protocol frozen (hard invariant).** `apps/web/src/protocol.ts`
   command shapes and `apps/web/src/worker/adapter.ts` command handling stay
   untouched; `architectureProjection` (adapter.ts:155-171) is explicitly
   unchanged by Phase 2 of the spec.
5. **Resource nodes are UI-local.** Per the spec (Phase 2,
   architecture-visualization.md:81-95) and the task invariants: resource
   nodes must never enter `ArchitectureProjection`, never join the BFS depth
   queue (architecture-view.ts:54-61 — joining it would reorder the commerce
   grid), never receive flight tokens, emphasis, roles, or movement edges, and
   expose no handles. `movementEdges` (architecture-view.ts:127-131) feeds
   `useFlightPlayback` and `TimelineView` (App.tsx:41-49, 203), so ownership
   edges must be excluded from it or playback routing and timeline emphasis
   break; `MovementEdge["relationship"]` is closed over
   request/subscription/publication (apps/web/src/records.ts).
6. **Test-count pins.** Unit tests pin exact outputs: 5 checkout nodes, the
   exact edge list, 3 dash styles, exact positions, resource strings
   (architecture.test.ts:25-31, 47-50, 61-64); commerce mapping
   (commerce-worker.test.ts:40); movement edges (flight.test.ts:156-157).
   Browser specs pin `.react-flow__node` counts of 5
   (checkout-lesson.spec.ts:46, 86, 150; architecture-fit.spec.ts:80;
   smoke.spec.ts:54), `.react-flow__edge` count 4 (smoke.spec.ts:55), legend
   sentences (smoke.spec.ts:56-58), `.category-label` visibility
   (checkout-lesson.spec.ts:89), and `.is-involved` counts of 2
   (timeline.spec.ts:91; story-timeline.spec.ts:185). Phase 2 satellite nodes
   change these counts; the spec (Phase 4, :112-113) already plans selector/
   aria updates, and the legend test rule ("the legend names every token
   glyph and shape the graph paints", flight.test.ts:28) extends to node
   symbols if a legend panel is added.
7. **Accessibility contract.** Nodes are `role="button"`, `aria-pressed`,
   keyboard-selectable with Space/Enter and Escape-clear
   (ArchitectureView.tsx:89, 161, 200-206); axe runs over `.react-flow__node`
   at 100% and 200% zoom (accessibility.spec.ts). Per-symbol SVG must keep
   accessible names (`aria-label` includes title + category;
   `categoryLabels` extension for infrastructure subkinds per spec :66-70).
   Non-interactive ownership edges must stay non-focusable (spec :57-58,
   :90), and resource nodes — if interactive — must follow the existing
   selection pattern or be excluded from the tab order.
8. **React Flow measurement stability.** `FitToCanvas`
   (ArchitectureView.tsx:73-103) refits on measured resizes and session
   changes; the spec (:73-75) requires keeping size tokens stable so
   measurement and the fitted-view browser baselines
   (architecture-fit.spec.ts) stay green. New shapes should preserve
   predictable node dimensions (today 215×90 minimum).
9. **Determinism rules.** No `Date.now`/`setTimeout`/`setInterval`-driven UI
   state. The only existing host timers are the playback cursor
   (`flight-playback.ts` pace polling, which must not advance virtual time or
   send commands) and the `requestAnimationFrame` in `FitToCanvas`; symbol
   code must not add timers.
10. **Lesson-gating precedent/risk.** `checkoutDisplay`
    (checkout-display.ts:14-18) is gated on exact scenario names
    (`checkout-normal@1`, `checkout-processor-response-lost@1`) and exact
    model+version, and the checkout publication edge
    (architecture-view.ts:109-122) repeats that gate. Symbol derivation
    should prefer the metadata-driven path (kind + destination `kind` from the
    `destinations` map, per spec :66-70) over name gates; the version-mismatch
    tests (architecture.test.ts:77-81) pin the strict-gating behavior for
    checkout copy.
11. **Inspector knowledge boundary.** `architecture.test.ts:76` asserts
    business-state values (`"authorizations"`) never appear in the graph, and
    commerce facts come only through `CommerceFacts`
    (App.tsx:198). Resource-node selection (spec Phase 2, unresolved decision
    :36-38) must show static metadata only (table names, initial keys, owner)
    — never committed rows or KV values, which are student-projection facts.
12. **Spec status and unresolved decisions.**
    `docs/spec/architecture-visualization.md` is a **Draft plan** (and
    AGENTS.md makes `docs/spec/` the source of truth). Two decisions are
    explicitly unresolved: always-visible vs toggled storage nodes
    (recommendation: always visible) and whether resource nodes open the
    inspector (recommendation: yes, static facts only). Phase 4 also requires
    a one-sentence update to `docs/spec/application-boundary.md` before the
    resource-node derivation is considered specified; per AGENTS.md, both
    design documents must be updated when a code change alters a stated
    architectural guarantee.
13. **Playback/movement exclusion is testable today.** Flight tests assert
    tokens follow measured link paths and stop where records say
    (flight.test.ts:29-30, e2e/architecture-flight.spec.ts); adding resource
    nodes that accidentally appear in `movementEdges` or as token endpoints
    would surface as route failures — keep the exclusion explicit in new unit
    tests (spec :109-111).

## 5. Baseline reproduction

```sh
npm run typecheck
npm test
npm run test:boundaries
for g in 01 02 04 05 06 07; do npm run --silent golden:$g | sha256sum; done
npm run build && npm run test:browser
```

Compare against the table in §1. The working tree at HEAD `52076a6` was clean
before this report; no source, test, contract, or worker file was modified.
