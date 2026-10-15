# CONTEXT

Domain model for DistLab. Architecture decisions live in
[docs/architecture.md](docs/architecture.md) and `docs/spec/adr/`; the full domain
glossary is [docs/glossary.md](docs/glossary.md). This file records the seams a
reader needs before changing code, and the vocabulary used when discussing them.

## Runtime model

- **VirtualClock**, **VirtualNetwork**, **MessageBus**, and **Database** are
  distinct concepts, not one "service" concept.
- A runtime **component** is exactly one of: client, internal service, external
  service, infrastructure primitive.
- Determinism is a guarantee, not a style: virtual clock, seeded randomness,
  scheduler-owned ordering. See [ADR-001](docs/spec/adr/001-deterministic-execution.md).

## Recorded history

- **Observation** is the only unit of recorded history. **Execution history** is
  the immutable sequence of them.
- **Record reading** (`apps/web/src/records.ts`) is the one place that decides
  what a stored record is: teaching milestone category, movement, delivery
  attempt, stored changes, payload visibility. It reads only stored fields.
  Presentations keep their own wording; link identity and layout stay in the
  presentation that draws them.
- The milestone set lives in
  [docs/learning-timeline.md](docs/learning-timeline.md) and is transcribed in
  `milestoneKinds`. `apps/web/tests/records.test.ts` reads the document and
  fails when the two disagree, so the document wins by construction.
- **Presentation playback** (`apps/web/src/flight.ts`, `flight-playback.ts`)
  moves a browser cursor over records the worker already published. It never
  advances virtual time, allocates an observation, or sends a worker command.
  The architecture-graph flight cursor is the only playback. Selecting a row in
  Recorded history is review navigation, not playback, and deliberately shares
  no cursor seam with the graph.
- **Review navigation** (`apps/web/src/review-navigation.ts`) is the one place
  that decides where the reader is in Recorded history: the **review position**
  (the stored record under review), the active constraints, and a focus request.
  It is pure — it reads records and link identity, never a DOM node, virtual
  time, or a worker command — and it returns scroll and focus as *requests* for
  the presentation to apply. `TimelineView.tsx` renders what it decides and
  adapts the DOM to it; it decides none of it. A record reached from a row, from
  a related-observation link, or from an evidence link arrives by the same
  transition, so the constraints hiding it are cleared in one place.
- The review position is **not** a cursor. Playback and review deliberately share
  no seam, so nothing in review navigation may be named a cursor.

## Experiment edits

- **Experiment edits** (`apps/web/src/experiment-edits.ts`) are the one place that
  turns a packaged scenario plus student changes (seed, link policy, boolean
  component configuration switches, added fault rules) into a new scenario
  definition. It is pure data: it never touches the worker, virtual time, or a
  runtime model, and it rejects invalid values before they reach the worker.
- Applying edits replaces the session through the existing `load` command; there
  is no edit command and nothing changes during a run. The worker accepts a
  scenario whose `name` matches a packaged lesson and lets the scenario engine
  validate the edited definition against that lesson's catalog.
- `ExperimentPanel.tsx` presents the edits in a modal dialog; the shell shows a
  **Modified** badge and **Restore original** while edits are applied.

## Application composition root

- `apps/web/src/worker/` is the sole runtime composition root. Main-thread
  modules import contracts, the host client, and data-only catalog modules, never
  runtime model factories or mutation ports. `tests/boundaries.test.ts` enforces
  this.
- **Status** is a projection field, never a new command.

## Naming

Import shared types from `@distlab/contracts` or `@distlab/contracts/kernel`.
`docs/spec/` is the source of truth for contract names and shapes. Where a
document and the code disagree, follow the document and record the deviation
rather than editing the code to match silently.
