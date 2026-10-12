# Architecture Visualization Specification

| Field | Value |
| --- | --- |
| Status | Draft plan |
| Owner | DistLab core team |
| Last updated | 2026-10-24 |
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
| Contract names are authoritative | `docs/spec/contracts.md` | Reuses `DatabaseDefinition`, `KeyValueDefinition`, `DestinationKind` (`"queue" | "topic"`); introduces no new contract aliases; new node types are UI-local presentation types |

Unresolved decisions:

- Whether owned-resource nodes are always visible or behind a
  "Show storage" toggle (default recommendation: always visible; commerce
  graphs are small).
- Whether selecting a resource node opens the inspector with static metadata
  facts (tables, initial keys) or is non-interactive (recommendation: open the
  inspector, static facts only).

## Symbol language

Each element kind gets one primary shape cue plus a glyph, so the graph is
readable without color (color is retained as a secondary cue).

| Element | Shape | Glyph | Color |
| --- | --- | --- | --- |
| Client | Pill (fully rounded card) | Monitor/person | `--category-client` (blue) |
| Internal service | Rectangle, UML-component style | Component notch icon | `--category-service` (green) |
| External service | Hexagon (or dashed rounded rect kept) | Globe | `--category-external` (orange) |
| Message bus — topic | Wide bar with pronged rail | Broadcast/envelope stack | `--category-infrastructure` (purple) |
| Message bus — queue | Vertical rail/stack | FIFO arrow | `--category-infrastructure` (purple) |
| Database (owned) | Cylinder | Database disc | neutral slate |
| KV store (owned) | Layered box / key | Key | neutral slate |

Edge semantics are already partially encoded and become part of the same
legend: request = solid with arrowhead, subscription = long dash with
arrowhead, publication = dotted with arrowhead, ownership (new) = short thin
solid line, no arrowhead, non-focusable.

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

Databases and KV stores become graph nodes derived in the presentation layer:

- In `mapArchitecture`, group `metadata.databases` and `metadata.stores` by
  `owner` and emit UI-local nodes (new `type: "database"` / `type: "kvstore"`,
  ids namespaced like `resource:db:<owner>` to avoid collisions). These are
  presentation nodes: they are **not** added to `ArchitectureProjection`, do
  not participate in the depth/BFS layout queue, never receive flight tokens,
  emphasis, roles, or movement edges, and expose no handles.
- Attach each resource node to its owner with a thin solid "ownership" edge,
  non-selectable and non-focusable.
- Placement: fixed offset from the owner node (below/right) for checkout
  positions, and a reserved sub-row in the commerce grid column layout.
- Selection opens the inspector with static metadata facts only (table names,
  initial keys, `owner`), sourced from the same packaged `ArchitectureDefinition`.
  The projection copy in the worker (`adapter.ts`) is unchanged.

### Phase 3 — Edge semantics and legend unification

- Distinct markers per relationship (request/subscription/publication) in
  addition to the existing dash patterns.
- One legend component shared by the graph panel, listing shapes, edges, and
  movement tokens together.

### Phase 4 — Specification and tests

- This document becomes the spec of record; update
  `docs/spec/application-boundary.md` with one sentence allowing the main
  thread to derive presentation-only resource nodes from packaged metadata.
- Unit tests: `mapArchitecture` symbol derivation, resource node/edge
  emission, ownership grouping, and unchanged output when metadata lacks
  resources; assert `ArchitectureProjection` inputs are never mutated.
- Browser smoke test: update selectors/aria assertions for the new shapes and
  legend; verify resource nodes are visible for commerce lessons.
- `npm run test:boundaries` must keep passing (no new runtime imports).
- Reproducibility is unaffected: no `RunInputs`, clock, randomness, or history
  change; golden outputs must be byte-identical before and after.

## Guardrails

- No changes to `@distlab/contracts` types; no new worker commands; review
  navigation and playback seams untouched.
- All new graph elements are presentation state only and must never enter
  `RunInputs`, scheduling, assertions, or canonical history.
- Determinism rules apply as everywhere else in the UI (no `Date.now`,
  `setTimeout`-driven state).
