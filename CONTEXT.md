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
