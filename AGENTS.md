# Repository Guidelines

## Project Structure & Module Organization

DistLab is a documentation-first project that has started a TypeScript
workspace. Project documentation lives in `docs/`: `docs/vision.md` defines
the product goals and teaching use cases, `docs/architecture.md` specifies the
deterministic simulation model and runtime components, `docs/glossary.md`
defines shared terminology, and `docs/spec/` contains feature-specification
materials.

Shared TypeScript contracts live in `packages/contracts/` (`@distlab/contracts`).
They encode the public types from `docs/spec/` without implementing runtime
models. Kernel types are also exported as `@distlab/contracts/kernel`. Later
packages must import these contracts instead of redeclaring the same shapes.

Keep runtime code, tests, and browser assets in clearly separated directories
such as `packages/<name>/`, `apps/web/`, and `examples/`. Update both design
documents when a code change alters a stated architectural guarantee.

## Build, Test, and Development Commands

```sh
npm install                       # install workspace dependencies
npm run browser:install            # install Chromium once for browser tests
npm run dev                       # build packages and start the Vite browser app
npm run build                     # build packages and the static browser/worker bundles
npm run build:packages            # build contracts, kernel, scenario, and catalogs
npm run typecheck                 # typecheck all workspaces and tests
npm test                          # run all unit, worker, boundary, and browser tests
npm run test:browser               # browser smoke test against the production build
npm run test:boundaries            # verify app and package import boundaries
npm run golden:01                 # print UI-free golden scenario 01 state/history
npm run golden:02                 # print UI-free golden scenario 02 state/history
npm run golden:04                 # print UI-free golden scenario 04 state/history
npm run golden:05                 # print UI-free golden scenario 05 state/history
npm run golden:06                 # print UI-free golden scenario 06 state/history
npm run golden:07                 # print UI-free golden scenario 07 state/history
npm run lesson -- retry-unsafe    # run a commerce lesson with textual timeline
npm run lesson -- retry-idempotent --replay # verify deterministic reset/replay
npm run lesson -- saga-compensated --step  # interactive event stepping
npm run --silent lesson -- outbox-idempotent --json # full state/history export
npm run lesson -- outbox-notifications-gap --replay # empty design slot, replay check
npm run scenario -- check examples/scenarios/processor-response-lost.json # check an ADR-006 scenario document
node --experimental-strip-types apps/web/tests/i18n-scan.ts  # list user-visible English outside the catalogs
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts retry-unsafe # lesson copy beside its recorded run
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts retry-unsafe  # lesson screenshots from the production build
git diff --check                  # find whitespace and conflict-marker problems
rg '^#{1,6} ' AGENTS.md docs/     # review Markdown heading structure
git status --short                # confirm the intended files are included
```

Add new setup, build, run, and test commands here when introducing a toolchain;
they should also be documented in the project README.

The browser toolchain requires Node.js 22.12 or newer. On Linux CI, install
Chromium system dependencies with
`npm exec -w @distlab/web -- playwright install --with-deps chromium` if needed.
`apps/web/src/worker/` is the browser runtime composition root. Main-thread
modules may import application contracts, the host client, and the data-only
`packages/catalogs/src/scenarios.ts`, `packages/catalogs/src/commerce/scenarios.ts`,
`packages/catalogs/src/descriptors.ts`, and `packages/catalogs/src/commerce/descriptors.ts`
modules; they must not import runtime model
factories, ScenarioEngine, or low-level mutation ports. Protocol types come from
`@distlab/contracts`, and status is a projection field, not a new command. The
only contract value the main thread imports is the `ScenarioDocumentLimits`
constant.
The host accepts the two packaged checkout documents, twenty-one packaged
commerce-catalog lessons, and the Reliable Checkout assessment's base lesson
(`packages/catalogs/src/commerce/reliable-checkout.ts`, a data-only module the
main thread may import), each optionally with a session overlay that the lesson's
data-only overlay policy allows (`docs/spec/adr/004-session-overlays.md`), and
imported scenario documents against a hosted catalog, each optionally with an
overlay that the document's own policy allows. The
main thread never sends an applied document. Reset replays the applied overlay.
Imported scenario documents follow `docs/spec/adr/006-scenario-documents.md`:
the main thread checks `File.size`, sends the file text unparsed, and never
imports the document parser, validator, or hosted catalog registry; only the
worker parses and validates it. Simulation exposes explicit pending-event, processed-event,
and random-draw counters; never infer these from arbitrary/redacted history.
Student projections are chosen by catalog reference and derived from the
normalized architecture, never from fixed component IDs.
Commerce student projections expose committed business rows, live KV entries with their expiry, client
outcomes, declared external-visible state, delivery facts, dead letters, and
assertion results; the checkout client projection carries assertion results
too. Runtime tasks and provider counters remain host-only. Architecture playback in
`apps/web/src/flight.ts` and `apps/web/src/flight-playback.ts` is presentation
over records the worker already published: a host timer may move the playback
cursor and paint a movement token on a measured link path, and it must not
advance virtual time, record observations, or send worker commands. Narration
reads stored observation fields only, and a redacted or omitted payload is never
reconstructed. A token travels from the record's origin to its destination even
when that runs against the drawn link. The Replay keys (`useReplayKeys`), the
hops in transit (`flightInTransit`), and the Replay background
(`flightBackground`) follow the same rule: a key moves the playback cursor only,
and the other two are read from records at or before the cursor. Component activity in
`apps/web/src/activity.ts` is pure: it reads records at or before the cursor and
nothing after it. The Experiment drawer (`apps/web/src/ExperimentDrawer.tsx`)
edits a draft overlay as UI state in up to three sections: Architecture
(`apps/web/src/ArchitectureSection.tsx`, `apps/web/src/design-edits.ts`), Design
choices (`apps/web/src/DesignChoicesSection.tsx`, `apps/web/src/design-choices.ts`),
and Faults (`apps/web/src/FaultsSection.tsx`, `apps/web/src/break-faults.ts`).
Only Apply and restart, Load, and Compare send it, inside an ordinary `load`. It
never validates or applies an overlay itself, and its inputs and Apply are
unavailable while a command is outstanding or the simulation runs. Design
choices offer only the parameters a lesson's policy declares and never edit the
seed or the lesson checks. The Architecture section offers only the edits a
lesson's architecture allowance declares, reads model descriptors from the
data-only descriptor modules, and builds `ArchitectureEdits` in the worker's
normalized form; it never imports `@distlab/scenario` or decides that a design
is valid.
Graph layout in `apps/web/src/layout/` is presentation: `elk-layout.ts` is a
pure, async ELK layered layout over measured node sizes, and ELK runs in its
own presentation worker, never in the simulation worker. Positions and edge
routes never enter projections, worker commands, or history
(`docs/spec/architecture-visualization.md`, Phase 5).
Interface text follows `docs/spec/adr/007-localization.md`. Every user-visible
string lives in the message catalogs in `apps/web/src/i18n/` (`en/` is the
source, every other locale is typed `typeof en`), one area per screen. Pure
modules that produce text take `m: Messages` as their last parameter; components
call `useMessages()`. Write one message per sentence, with `f.plural`, `f.list`,
`f.number`, and `f.date` for counts, joins, numbers, and calendar dates, and `<Rich>` for inline markup;
never splice fragments, and never compare or store display text where a code
will do. The worker never imports a catalog. Component IDs, endpoint names,
observation types, codes, business data, and `t=` are never translated. The
English Playwright suite runs with `locale: "en-US"`; `e2e/i18n.spec.ts` covers
other locales. The scanner budget in `apps/web/tests/i18n.test.ts` may only go
down.
Every packaged lesson has a lesson revision: a `revision` counter and an
`updated` date beside the documents in the data-only catalog modules, shown to
students as "Version". A change to a lesson's document, checks, policy, model
behavior, or copy raises the revision and the date in the same pull request;
`packages/catalogs/tests/revisions.test.ts` fails otherwise and says what to
record. The revision is not the document's `@1` name and never enters a
document, a projection, or history.
Review navigation in `apps/web/src/review-navigation.ts` decides
the review position in Recorded history and is pure: it reads records and link
identity, never a DOM node, virtual time, or a worker command, and it returns
scroll and focus as requests for the presentation to apply. Presentation playback
and review navigation share no seam; nothing in review navigation is a cursor.

## Coding Style & Naming Conventions

Write concise Markdown with ATX headings (`# Heading`), blank lines around lists and code fences, and language-tagged examples such as ```` ```ts ````. Keep project documentation under `docs/`, use descriptive lowercase filenames (`docs/vision.md`, `docs/architecture.md`), and keep terminology consistent with `@distlab/contracts` and the architecture: `VirtualClock`, `VirtualNetwork`, `MessageBus`, and runtime component categories are distinct concepts.

Import shared types from `@distlab/contracts` or `@distlab/contracts/kernel`. Do not copy those interfaces into other packages.

`docs/spec/` is the source of truth for contract names and shapes. Architecture
sketches, glossary terms, and informal names do not get TypeScript aliases.
Where a difference exists, follow the spec. If you cannot tell how to resolve
it — conflicting specs, a missing type, or an ambiguous refinement — ask
instead of inventing a name, alias, or shape.

Future simulation code must preserve determinism: use the virtual clock instead of `Date.now()`, `setTimeout()`, or `setInterval()`, and use seeded randomness instead of `Math.random()`. Components must communicate through the modeled network or message bus. Browser timeline playback may use a host timer to move its cursor and paint movement cues; that timer must not advance virtual time, record observations, or send worker commands.

## Testing Guidelines

`@distlab/contracts` and `@distlab/kernel` are typechecked with `tsc`; tests cover constructors, deterministic kernel primitives, controls, and a headless replay scenario. For documentation-only changes, verify rendered Markdown, internal consistency, and clean output from `git diff --check`. New executable features should include tests in the same pull request, especially reproducibility tests that run identical architecture, scenario, configuration, and seed inputs twice and compare results.

## Commit & Pull Request Guidelines

History currently contains only `Initial commit`, so no established convention exists. Use short, imperative commit subjects, for example `Document virtual clock invariants`, and keep each commit focused. Pull requests should explain the motivation, summarize affected design guarantees, link relevant issues, list validation performed, and include screenshots for future browser UI changes.

## Agent skills

### Unattended workflow

Agent sessions that implement an issue without supervision follow
`docs/agents/workflow.md`: how to pick and claim work, when to stop and ask in
the issue, what to verify, and what the pull request must contain
(`.github/pull_request_template.md`). Agents never merge.

Cloud sessions install dependencies through the SessionStart hook in
`.claude/hooks/session-start.sh`, which runs `npm ci` only when a manifest changes.

### Lesson authoring

Reviewing, adjusting, or creating a lesson (its teaching content, its
configuration, and what the screen shows) follows the `lesson-authoring` skill
in `.claude/skills/lesson-authoring/`. Claude Code loads it by itself; any other
agent reads its `SKILL.md` first. Its two read-only scripts print a lesson's
copy in both languages beside what the run recorded (`lesson-sheet.ts`, after
`npm run build:packages`) and capture the lesson on screen (`lesson-shot.ts`,
after `npm run build`).

### Issue tracker

Issues live in GitHub Issues for `carlosmgc2003/distlab`; use the `gh` CLI, or
the GitHub MCP tools in Claude cloud sessions. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their own names: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus ADRs in `docs/spec/adr/`.
See `docs/agents/domain.md`.
