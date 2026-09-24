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
`packages/catalogs/src/scenarios.ts` module; they must not import runtime model
factories, ScenarioEngine, or low-level mutation ports. Protocol types come from
`@distlab/contracts`, and status is a projection field, not a new command.
The initial host accepts only the two packaged checkout documents; broader
scenario support requires an explicit counter read port rather than inferred
counts from arbitrary/redacted history.

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
