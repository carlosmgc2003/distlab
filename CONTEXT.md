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

## Application composition root

- `apps/web/src/worker/` is the sole runtime composition root. Main-thread
  modules import contracts, the host client, and data-only catalog modules, never
  runtime model factories or mutation ports. `tests/boundaries.test.ts` enforces
  this.
- **Status** is a projection field, never a new command.

## Session overlays

- A **packaged lesson** is one of the exact packaged scenario documents the host
  accepts. A **session overlay** is the student's delta for one packaged lesson:
  fault rules, scheduled faults, and **parameter overrides**. It is applied at
  Load and replayed by Reset, never applied mid-run. See
  [ADR-004](docs/spec/adr/004-session-overlays.md).
- A **lesson overlay policy** is the lesson's data-only allow-list. The worker
  reads it from its own catalog and never from a command.
- Say *parameter*, not *configuration*. `configuration` means
  `RunInputs.configuration`, which an overlay cannot change.
- **Design choices** are the student-facing name for a lesson's parameters
  (#95). In the Experiment drawer (#143), the Design choices section edits
  parameter overrides and the Faults section edits fault entries. Both edit one
  draft overlay, and the drawer's one **Apply and restart** sends all of it in
  one `load`. A parameter's default is the packaged value, and a
  paired lesson's distinguishing switch is a declared parameter.

## Lesson checks

- A commerce lesson's packaged assertions are its **lesson checks**. Each is a
  **business invariant** or a **scenario expectation** (#96); the data-only
  classification is `commerceChecks` beside the documents.
- A business invariant is stated identically in every lesson of a family, so its
  verdict reads HOLDS (PASS) or VIOLATED (FAIL) for any design, including a
  student's design choices. An unsafe lesson's finding is a VIOLATED invariant.
- A scenario expectation confirms that the run reproduced the lesson's setup
  ("Lesson setup reproduced"). It may differ between the lessons of a pair.
- Students never see a bare PASS or FAIL. `apps/web/src/lesson-checks.ts` maps
  stored verdicts only; it never re-evaluates a predicate.

## Architecture editor

- Students compose catalog models; they never author handlers. See
  [ADR-005](docs/spec/adr/005-architecture-editor.md).
- A **model descriptor** is a catalog model's data-only interface. A **peer** is
  a component a model calls, bound through configuration with a default. Say
  *peer*, not *port*: a port is an injected kernel capability.
- A **slot** is a lesson-owned component whose model the student chooses. A
  **placeholder model** fills an empty slot and answers `NOT_IMPLEMENTED`.
- **Architecture edits** are part of the session overlay and record the
  resulting design, not the gestures. The lesson's **architecture allowance**
  says which edits are allowed. The worker is the only validator; the editor's
  draft **preview** is presentation and is never sent.

## Scenario documents

- A **scenario document** is an instructor's JSON file: a `ScenarioDefinition`
  inside an envelope with a **catalog reference**, plain-text presentation, and
  an optional overlay policy. See
  [ADR-006](docs/spec/adr/006-scenario-documents.md).
- The main thread sends the file text unparsed. The worker parses, bounds, and
  validates it, and resolves the catalog from its own registry. Invariants are
  catalog predicates referenced by ID, never code. An imported session's
  overlay policy comes from its validated document, not from a catalog.
- A **starter file** is a packaged lesson saved as a scenario document under a
  `-copy` name. The main thread builds it from data-only modules; opening it is
  an ordinary import.
- Say *imported* for a session from a scenario document and *packaged* for a
  lesson from the catalogs. The **document digest** identifies the file, and
  `runId` identifies the run.
- Student projections are chosen by the session's catalog reference and derived
  from the normalized architecture, so a checkout document with other component
  IDs shows the same facts. The checkout catalog's predicates still read fixed
  IDs, so its checks only judge the packaged IDs (#148).
- An imported session's checks are the document's assertions. Format version 1
  carries no business invariant/scenario expectation classification, so they are
  not lesson checks: `importedChecks` shows each stored verdict (PASS, FAIL)
  beside the author's plain-text label, under a note that the file's author wrote
  them and DistLab catalog predicates judged them.

## Naming

Import shared types from `@distlab/contracts` or `@distlab/contracts/kernel`.
`docs/spec/` is the source of truth for contract names and shapes. Where a
document and the code disagree, follow the document and record the deviation
rather than editing the code to match silently.
