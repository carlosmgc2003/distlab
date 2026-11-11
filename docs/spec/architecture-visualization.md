# Architecture Visualization Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready |
| Owner | DistLab core team |
| Last updated | 2026-11-06 |
| Related issues | None |

## Responsibility

The architecture graph is the primary teaching surface: a student must be able
to read the system's shape (who is a client, a service, an external party, a
message bus, and which component owns which database or key-value store)
without opening the inspector. Today every component renders as the same
215×90 box and only border color/radius differs, owned databases and KV stores
never appear as graph nodes, and message buses are indistinguishable from any
other infrastructure box. This specification defines a richer symbol language
for the graph while keeping it strictly presentation-only over published
projections and packaged metadata.

## Architectural alignment and decisions

| Requirement / source | Contract section | Acceptance criteria |
| --- | --- | --- |
| Presentation never mutates or commands the run | `docs/spec/application-boundary.md` | No new worker commands, observations, or virtual-time effects; resource nodes derive from packaged `ArchitectureDefinition` metadata only |
| Main-thread import boundary | `docs/spec/application-boundary.md` | `mapArchitecture` keeps importing `@distlab/contracts` types only; no runtime model factories |
| Architecture playback is presentation over records | `docs/spec/observability.md` | Flight tokens, emphasis, and roles apply to component links only; owned-resource nodes never receive movement |
| Playback direction and activity are read from records | `docs/spec/observability.md` | A token travels from the record's origin to its destination whatever the drawn link's direction; activity (idle, processing, waiting) is derived only from records at or before the cursor and never from records that were not written |
| Contract names are authoritative | `docs/spec/contracts.md` | Reuses `DatabaseDefinition`, `KeyValueDefinition`, `DestinationKind` (`"queue" | "topic"`); introduces no new contract aliases; new node types are UI-local presentation types |
| Layout is presentation state | `docs/spec/application-boundary.md` | ELK positions and edge routes are computed in a presentation worker from measured node sizes; they never enter projections, worker commands, `RunInputs`, or history (see "Phase 5 — Automatic layout with ELK") |

Resolved decisions (both settled by the Phase 2 design; rationale in
"Phase 2 — Owned-resource satellite nodes"):

- Owned-resource satellites are **always visible**; there is no "Show
  storage" toggle. The graph's stated responsibility is that a student reads
  the system's shape — including which component owns which database or
  key-value store — without opening the inspector, so a hidden default would
  hide the fact the graph exists to teach. Packaged graphs are small (at most
  five components and three satellites), and a toggle would be a new control
  that only restates an existing packaged fact, which
  `docs/spec/application-boundary.md` rules out as a presentation solution.
  Visibility is derived from packaged metadata, never stored UI state.
- Resource nodes are **selectable and open the inspector with static facts
  only** (owner, table names, initial keys). Selection is the app's single
  inspect gesture (mouse, or Tab plus Enter/Space with the same
  `ariaLabelConfig` description as components), the same facts already appear
  in the owning component's inspector disclosure, and a visible but dead
  node would break the rule that every focusable element is inspectable.
  Static facts only: no live rows, no runtime facts, no configuration.

## Symbol language

Each element kind gets one primary shape cue plus a glyph, so the graph is
readable without color (color is retained as a secondary cue).

| Element | Shape | Glyph | Color |
| --- | --- | --- | --- |
| Client | Pill (fully rounded card) | Monitor/person | `--category-client` (blue) |
| Internal service | Rectangle, UML-component style | Component notch icon | `--category-service` (green) |
| External service | Hexagon | Globe | `--category-external` (orange) |
| Message bus — topic | Message channel: a pipe along the flow, shaded outlet face on the east | Fan-out (one in, one to each subscriber) | `--category-infrastructure` (purple) |
| Message bus — queue | The same channel with a lane of waiting message cells along its floor | Queued cells, one arrow out | `--category-infrastructure` (purple) |
| Database (owned) | Cylinder | Database disc | neutral slate |
| KV store (owned) | Layered box / key | Key | neutral slate |

Edge semantics are already partially encoded and become part of the same
legend: request = solid slate with arrowhead, subscription = long dash with
open arrowhead, publication = dotted with small filled arrowhead, ownership
(new) = short thin amber line (the data link color), no arrowhead,
non-focusable. Bus links (subscription and publication) take the
destinations' purple, and their labels name the relationship only
(`Publication`, `Subscription`) on a lilac chip: the destination already names
itself on the graph. The line pattern, not the color, carries the meaning. A
destination's node title is its id; the channel symbol and its `Message bus
topic` or `Message bus queue` caption say it belongs to the MessageBus, and
the name wraps instead of being cut off. At legend size the two channels
share one outline, so each legend sample carries its glyph.

## Plan

### Phase 1 — Shape and glyph system for existing nodes

Presentation-only change in `apps/web/src/`:

- `architecture-view.ts`: derive a `symbol` field on `ArchitectureNode.data`
  from `component.kind` plus, for infrastructure, the destination `kind`
  (`queue` vs `topic`) already available through the `destinations` map in
  `mapArchitecture`. Extend `categoryLabels` with infrastructure subkinds for
  aria labels.
- `ArchitectureView.tsx`: render per-symbol SVG or CSS clip-path shapes inside
  `ComponentNode`; keep the existing `Handle` set and selection/focus behavior.
- `architecture.css`: per-symbol shape rules replacing the single
  `.component-node` box; keep size tokens so React Flow measurement stays
  stable.
- Add one legend `Panel` covering node shapes, edge styles, and flight tokens
  (single legend, next to `FLIGHT_LEGEND` content).

### Phase 2 — Owned-resource satellite nodes

Databases and KV stores become graph nodes derived in the presentation layer.
This section is the concrete design: an implementer follows it without making
further decisions. All of it lives in `apps/web/src/` presentation state; the
satellites are **not** added to `ArchitectureProjection`, do not participate in
the depth/BFS layout queue, never receive flight tokens, emphasis, roles, or
movement edges, and send no worker commands.

#### Node types and data shape

Two UI-local presentation node types are added in
`apps/web/src/architecture-view.ts`. They reuse the contract names
`DatabaseDefinition` and `KeyValueDefinition` as-is and introduce no contract
aliases; `DestinationKind` is untouched (it classifies message-bus
infrastructure only, per Phase 1):

```ts
export type ResourceKind = "database" | "kvstore";

export const resourceLabels = {
  database: "Database",
  kvstore: "KeyValueStore",
} as const satisfies Record<ResourceKind, string>;

export interface ResourceNodeData {
  readonly kind: ResourceKind;
  readonly owner: ComponentId;
  /** Verbatim packaged definition, copied by reference and never mutated. */
  readonly definition: DatabaseDefinition | KeyValueDefinition;
}

export type ResourceNode = Node<ResourceNodeData, ResourceKind>;
```

- Node identity: `resource:db:<owner>` for a database, `resource:kv:<owner>`
  for a key-value store. The `resource:` namespace cannot collide with
  component ids or with the existing `relationship:source:target:index`
  edge ids; a unit test asserts no packaged component id starts with
  `resource:`.
- Node title, rendered and announced alike: `` `${resourceLabels[kind]} owned
  by ${owner}` `` — exactly the vocabulary of the existing inspector resource
  strings (`Database owned by orders…`, `KeyValueStore owned by payments`).
- Emission in `mapArchitecture`: group `metadata.databases` and
  `metadata.stores` by `owner`. One node per owner and kind; when two
  definitions of the same kind share an owner, the last in array order wins
  (the same last-wins idiom as the existing `components` and `destinations`
  maps). A definition is emitted only when its owner is a projected component
  whose projected kind, model, and version match the metadata instance (the
  same `matches` gate as the owner node's `resources` list); a dangling owner
  or a version-mismatched owner emits nothing and raises no error.
- Presentation flags: `draggable: false`, `connectable: false`, `deletable:
  false`, `selectable: true`, `focusable: true`, `ariaRole: "button"`,
  `ariaLabel` equal to the title, `className: "resource-node
  resource-<kind> nopan"`. No `Handle` component is rendered, so nothing
  visible or connectable is exposed; because React Flow cannot anchor an edge
  to a handle-less node, the node instead declares one invisible declarative
  handle (the `node.handles` API — anchor data only):
  `{ id: "north", type: "target", position: Position.Top, x: 57.5, y: 0 }`
  (the library adds the handle's 1-px default width, so the anchor lands a
  sub-pixel from top-center).
- `mapArchitecture` returns `{ nodes, edges, resourceNodes, resourceEdges,
  error }`. `nodes` and `edges` keep their exact current meaning (component
  nodes and component link edges); the two new arrays carry the satellites.
  The split is the boundary guarantee: `movementEdges` accepts
  `ArchitectureEdge[]` only, and `OwnershipEdge` is deliberately not
  assignable to `ArchitectureEdge`.

#### Ownership edges

```ts
export interface OwnershipEdgeData {
  readonly owner: ComponentId;
  readonly resource: ResourceKind;
}

export type OwnershipEdge = Edge<OwnershipEdgeData>;
```

- Edge identity: `ownership:<owner>:<resource node id>`, for example
  `ownership:orders:resource:db:orders`. No index suffix: owner plus kind is
  unique, so the id is stable across input reorderings.
- Style: a thin solid data line — `stroke: DATA_STROKE` (`#b45309`),
  `strokeWidth: 1.5`, no dash array, no `markerEnd`, no label — with
  `selectable: false`, `focusable: false`, `deletable: false`; `data.link:
  "data"`; `sourceHandle: "south"` (the owner component's south source
  handle) and `targetHandle: "north"` (the resource node's declarative north
  handle). Handle ids name the ELK port side they match (Phase 5).
- Exclusion from movement and playback is structural, not conventional.
  Ownership edges live only in `resourceEdges`, so `movementEdges(graph.edges)`
  never sees them; `MovementEdge["relationship"]` keeps exactly
  `"request" | "subscription" | "publication"` and no `"ownership"` value is
  added anywhere; `edgeFor` and `edgeBetween` match component links only,
  because observations name components only. Flight steps and graph emphasis
  are keyed by movement-edge identity, so an ownership edge or resource node
  can never be emphasized, roled, pulsed, or carry a flight token. In the
  view, `resourceEdges` pass through untouched, and `resourceNodes` are
  mapped through the selection flag only (`selected`, `aria-pressed`,
  `aria-controls`) — never roles, involvement, or flight data.

#### Seed placement

`mapArchitecture` still returns the coordinates below. Since Phase 5 they are
the seed placement: React Flow renders and measures the nodes there (hidden),
and the ELK layout replaces them before the graph is shown. They remain the
fallback when a layout fails. One uniform rule covers both layouts, because the checkout map, its fallback,
and the commerce grid all place component boxes on a 210-px vertical pitch
with 90-px-tall boxes (the 215×90 card): the satellite hangs in a reserved
sub-row of its owner's cell. Resource nodes are 115×56 px. The first
(database) satellite sits at the owner node's final computed position plus
`(50, 120)`; if the same owner also declares a key-value store — no packaged
lesson does — it sits beside it at plus `(173, 120)`. The x offset of 50
centers a 115-px node under the 215-px owner box; the y offset of 120 leaves
a 30-px ownership edge below the box and 34 px of clearance before the next
cell.

- Checkout, fixed positions: `resource:db:orders` at `(360, 120)` and
  `resource:db:payments` at `(360, 540)`. `OrderCreated` at y 210 stays clear
  of the orders satellite, which ends at y 176.
- Checkout fallback for an unknown component (`{ x: 930, y: index * 180 }`):
  the same plus `(50, 120)` offset; the sub-row ends at `index * 180 + 176`,
  above the next fallback row at `index * 180 + 180`.
- Commerce grid (`column * 310, row * 210`): every satellite at
  `(column * 310 + 50, row * 210 + 120)`. Packaged cases: retry and outbox
  `resource:db:payments` at `(360, 120)`; saga `orders` `(360, 120)`,
  `inventory` `(670, 330)`, `payments` `(670, 540)`; outbox
  `resource:db:notifications` at `(980, 120)`; cqrs `orders` `(360, 120)`
  and `reporting` `(360, 330)`; cascade `resource:kv:api` `(360, 120)`,
  `resource:kv:orders` `(670, 120)`, `resource:kv:payments` `(980, 120)`.
- With the seed placement alone, edge routes may pass behind a satellite.
  The ELK layout (Phase 5) removes this: an owner and its satellites form one
  block that every route avoids.
- Placement reads owner positions only; no host timer, no measured reflow,
  and no `Date.now`/`setTimeout`-driven state is involved. The graph bounds
  grow (checkout now spans to y 596); `FitToCanvas` and the fit buttons adapt
  exactly as they do today.

#### Inspector behavior

Selecting a resource node opens the same inspector region
(`#component-inspector`) and renders the resource title plus static facts
only, sourced from the same packaged `ArchitectureDefinition`:

- Owner: the owner component id (for example, `orders`).
- Database: table names in declared order (`DatabaseDefinition.tables`), and
  the initial key names of each declared table (`Object.keys` of
  `DatabaseDefinition.initial[table]`), or `None declared` when no table has
  initial rows.
- Key-value store: the `key` of each `KeyValueDefinition.initial` entry in
  array order, or `None declared` when `initial` is empty.

There is no configuration, model, or version section (resources declare
none), no "Resource ownership" list (the node is the resource), and no live
committed rows or KV metrics — commerce student projections stay in the
commerce state panel. The `inspectorFacts` children (`CommerceFacts`,
`ComponentRuntimeFacts`) apply to component selection only; a resource id
matches no component, so resource selection shows static facts only. The
owning component's existing "Resource ownership" disclosure is unchanged: the
satellite presents the same facts at the node. The projection copy in the
worker (`adapter.ts`) is unchanged, as are all worker commands and events.

#### Acceptance tests

Unit tests extend `apps/web/tests/architecture.test.ts` (node:test, the
existing `mapArchitecture` style):

1. **Emission**: for every packaged lesson, one resource node and one
   ownership edge per declared owner — checkout two databases (orders,
   payments); retry one (payments); saga three (orders, inventory,
   payments); outbox two (payments, notifications); cqrs two (orders,
   reporting); cascade three key-value stores (api, orders, payments). Edge
   assertions: `source` is the owner, `target` is the resource id,
   `sourceHandle: "south"`, `targetHandle: "north"`, `strokeWidth: 1.5`,
   `stroke: DATA_STROKE`, no `markerEnd`, `selectable: false`,
   `focusable: false`.
2. **No metadata**: `mapArchitecture(architecture)` without metadata
   returns empty `resourceNodes` and `resourceEdges` with today's
   `nodes`/`edges`; the empty-graph assertion becomes `{ nodes: [], edges:
   [], resourceNodes: [], resourceEdges: [], error: null }`, and the
   duplicate/missing-component error paths return all four arrays empty.
3. **Grouping by owner**: a fixture with two same-kind definitions for one
   owner emits a single node whose `definition` is the last one; an owner
   with both a database and a key-value store emits two nodes at plus
   `(50, 120)` and `(173, 120)`; a companion assertion verifies that every
   packaged owner with both kinds (the cache lessons' Catalog) gets those two
   positions, and that no satellite of any packaged lesson overlaps another
   satellite or a component node.
4. **Id stability**: two calls on detached inputs deep-equal; reversing
   `projection.components` and the `metadata.databases`/`stores` arrays
   changes nothing; ids are exactly `resource:db:<owner>` /
   `resource:kv:<owner>` and `ownership:<owner>:<resource node id>` with no
   index suffix.
5. **Input non-mutation**: the existing `JSON.stringify` before/after
   assertion extends to the new arrays; packaged definitions stay frozen
   (`Object.isFrozen`), and no `resource:` id appears in the serialized
   inputs afterward.
6. **Exclusion from projection and playback**: `movementEdges(graph.edges)`
   returns no ownership entries and only the three relationship values;
   `graph.nodes` and `graph.edges` contain no `resource:` or `ownership:`
   id; `componentTitles` (the timeline label source) contains no resource
   entries; golden outputs stay byte-identical and
   `npm run test:boundaries` passes with no new imports.
7. **Gating**: the version-mismatched fixture (orders at 2.0.0) emits no
   `resource:db:orders`; a definition naming an owner absent from the
   projection emits nothing and leaves `error` null.
8. **Seed placement**: exact coordinates per the rule above — checkout
   `resource:db:orders` `(360, 120)` and `resource:db:payments` `(360, 540)`;
   saga `inventory` `(670, 330)`; cqrs `reporting` `(360, 330)`; cascade
   `resource:kv:payments` `(980, 120)`.

The Phase 4 browser smoke pass adds selector and aria assertions that
satellites are visible for commerce lessons and keyboard-inspectable, with
static facts only in the inspector.

### Phase 3 — Edge semantics and legend unification

- Distinct markers per relationship (request/subscription/publication) in
  addition to the existing dash patterns.
- One legend component shared by the graph panel, listing shapes, edges, and
  movement tokens together.

### Phase 4 — Specification and tests (complete)

- This document becomes the spec of record; update
  `docs/spec/application-boundary.md` with one sentence allowing the main
  thread to derive presentation-only resource nodes from packaged metadata.
- Unit tests: `mapArchitecture` symbol derivation, plus the Phase 2 acceptance
  list (resource node/edge emission, ownership grouping, id stability,
  placement coordinates, unchanged output when metadata lacks resources);
  assert `ArchitectureProjection` inputs are never mutated.
- Browser smoke test: update selectors/aria assertions for the new shapes and
  legend; verify resource nodes are visible for commerce lessons.
- `npm run test:boundaries` must keep passing (Phase 5 adds only the ELK
  API and its worker URL).
- Reproducibility is unaffected: no `RunInputs`, clock, randomness, or history
  change; golden outputs must be byte-identical before and after.

The external-service shape decision is resolved as a hexagon. Resource nodes
remain selectable, presentation-only satellites; their metadata eligibility,
placement, labels, and ownership-edge semantics are specified above and require
no further design decision.

### Phase 5 — Automatic layout with ELK

React Flow does not place nodes or route edges. The graph is laid out by
ELK's layered algorithm (`elkjs`) so that no two nodes overlap, edges are
orthogonal, no edge passes through a node other than its own ends, and edges
cross as little as ELK can manage.

- **Module.** `apps/web/src/layout/elk-layout.ts` exports
  `elkLayout(nodes, edges, options)`: pure and async, returns the same nodes
  with new positions and the same edges with `data.route`. The ELK engine is
  injected; the browser uses `layout/elk-engine.ts`, which runs ELK in its own
  presentation worker (`elk-worker.min.js`), apart from the simulation worker.
- **Options.** `elk.algorithm: layered`, `elk.direction: RIGHT`,
  `elk.edgeRouting: ORTHOGONAL`, `elk.layered.nodePlacement.strategy:
  NETWORK_SIMPLEX`, a fixed `elk.randomSeed`, and generous spacing (node to
  node, edge to node, edge to edge). Between layers the spacing is 12: edge
  labels already get layers of their own, and wider gaps pushed the default
  view below a legible scale (#166). Every option name was checked against
  `knownLayoutOptions()` of the pinned `elkjs` version.
- **Tiers.** `elk.partitioning.activate` with one partition per tier:
  0 ingress (client), 1 gateway, 2 services and MessageBus destinations,
  4 persistence, 5 external services. Destinations share the service band, so
  ELK layers each destination between the services that publish to it and the
  services subscribed to it, and a message reads left to right: publisher,
  destination, subscriber. The tier derives from the node type
  and symbol; an optional presentation field `data.tier` overrides it.
  Packaged lessons have no gateway kind, so tier 1 is used only through the
  override.
- **Ports.** One port per link end with `elk.portConstraints: FIXED_SIDE`:
  requests and bus links (publication and subscription) leave east and enter
  west, so a destination is entered on its inlet and left from its outlet;
  data links leave by the south. Component handles carry the same side names
  (`east`, `west`, `south`); resource nodes keep one declarative
  `north` handle.
- **Satellites.** A database or key-value store whose only link is its
  owner's data link hangs in a row under the owner (gap 30 px). ELK sees the
  owner and its row as one block, so every route avoids the row. A first
  FIXED_SIDE pass lets ELK order the block's ports; a second pass pins them,
  in that order, to the owner's part of each side (`FIXED_POS`). Data links
  drop straight from the owner's bottom side to each satellite.
- **Measured sizes.** Layout runs once React Flow has measured every node
  (`useNodesInitialized`, with the controlled nodes carrying the `measured`
  sizes React Flow reports), and again only when the graph's structure (node
  ids, edge ids and labels) changes. Badges that appear during playback grow a
  node but never move the graph. Edge labels are measured with the canvas
  font, and ELK reserves their space (`elk.edgeLabels.placement: CENTER`).
  The canvas is `aria-busy` and its nodes hidden until the laid-out graph is
  fitted.
- **Default view (#166).** `layout/legible-fit.ts` computes it from measured
  sizes: the plain fit, never below the zoom at which the smallest component
  name renders at 10 px (`MIN_NAME_PX`) and never above 1.25. When the whole
  graph does not fit at that zoom, the view starts at the graph's left and top
  edges, where the clients are, and the reader pans; when it fits, it is
  centered. The space kept clear is measured from the overlays: the zoom
  controls' column, the pan buttons' row, and the legend's header row, or its
  column when open. The legend starts collapsed. **Fit View** returns to this
  view; the zoom-out button still reaches the whole graph at any size. At
  1534×897 every packaged lesson loads whole, with 15–20 % of zoom to spare.
  At 1366×768 the widest lessons reach the legible floor (the checkout pair,
  whose topic sits between Orders and Payments, is five columns wide), so font
  metrics decide whether they are whole; either way the names are legible and
  the view starts at the clients. The viewport is presentation only and
  never enters projections, commands, or history.
- **Routes.** `ElkEdge` draws `startPoint → bendPoints → endPoint` with
  slightly rounded corners and puts the label where ELK placed it. ELK
  reports a section's points relative to the edge's container; `elkLayout`
  converts them to canvas coordinates, while child node positions stay
  relative to their parent, as `parentId` expects. Packaged graphs have no
  groups; the conversion is covered by a test with a compound node
  (`elk.hierarchyHandling: INCLUDE_CHILDREN`). Flight tokens follow the drawn
  route, and each recorded movement mounts its own token.
- **Bus links.** The MessageBus is already one node per destination.
  `asyncEdges: "layout"` (default) lets bus links take part in placement;
  `"route-after"` places nodes from request and data links only, then routes
  bus links in a second pass that keeps every node on its side and in its row
  order (one partition per first-pass column, interactive layering,
  semi-interactive crossing minimization). On the platform fixture the
  default leaves fewer crossings (1 against 5).
- **Not editable.** Nodes are not draggable, so there is no live re-routing
  and no "re-layout" control.

Acceptance (`apps/web/tests/elk-layout.test.ts`, `elk-path.test.ts`): for a
fixed graph, every packaged lesson under both bus strategies, and the
platform fixture (one client, one gateway, eight services, four bus
destinations, five databases, two externals), no two nodes overlap, no
segment enters a node other than its source or target, every route starts
and ends on its own node, and no two edges are drawn over each other. Tiers
appear left to right; ports sit on their sides; each satellite sits under its
owner; layout is deterministic and does not mutate its inputs. On the
platform fixture the seed placement with smooth-step edges has 0 overlaps,
4 crossings, 4 edges through nodes, and 24 pairs of edges drawn over each
other; the ELK layout has 0, 1, 0, and 0. With the default strategy, every
bus link in the platform fixture and in every packaged lesson runs from the
west to the east: its source ends left of its target.

## Guardrails

- No changes to `@distlab/contracts` types; no new worker commands; review
  navigation and playback seams untouched.
- All new graph elements are presentation state only and must never enter
  `RunInputs`, scheduling, assertions, or canonical history.
- Determinism rules apply as everywhere else in the UI (no `Date.now`,
  `setTimeout`-driven state). ELK runs with a fixed random seed, so the same
  graph and measured sizes always give the same layout.
