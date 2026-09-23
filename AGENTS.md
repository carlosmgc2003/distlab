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
npm run build                     # build contracts and kernel
npm run typecheck                 # typecheck both workspaces and tests
npm test                          # run contracts, kernel, and headless scenario tests
npm run golden:01                 # print UI-free golden scenario 01 state/history
npm run golden:04                 # print UI-free golden scenario 04 state/history
git diff --check                  # find whitespace and conflict-marker problems
rg '^#{1,6} ' AGENTS.md docs/     # review Markdown heading structure
git status --short                # confirm the intended files are included
```

Add new setup, build, run, and test commands here when introducing a toolchain;
they should also be documented in the project README.

## Coding Style & Naming Conventions

Write concise Markdown with ATX headings (`# Heading`), blank lines around lists and code fences, and language-tagged examples such as ```` ```ts ````. Keep project documentation under `docs/`, use descriptive lowercase filenames (`docs/vision.md`, `docs/architecture.md`), and keep terminology consistent with `@distlab/contracts` and the architecture: `VirtualClock`, `VirtualNetwork`, `MessageBus`, and runtime component categories are distinct concepts.

Import shared types from `@distlab/contracts` or `@distlab/contracts/kernel`. Do not copy those interfaces into other packages.

`docs/spec/` is the source of truth for contract names and shapes. Architecture
sketches, glossary terms, and informal names do not get TypeScript aliases.
Where a difference exists, follow the spec. If you cannot tell how to resolve
it — conflicting specs, a missing type, or an ambiguous refinement — ask
instead of inventing a name, alias, or shape.

Future simulation code must preserve determinism: use the virtual clock instead of `Date.now()`, `setTimeout()`, or `setInterval()`, and use seeded randomness instead of `Math.random()`. Components must communicate through the modeled network or message bus.

## Testing Guidelines

`@distlab/contracts` and `@distlab/kernel` are typechecked with `tsc`; tests cover constructors, deterministic kernel primitives, controls, and a headless replay scenario. For documentation-only changes, verify rendered Markdown, internal consistency, and clean output from `git diff --check`. New executable features should include tests in the same pull request, especially reproducibility tests that run identical architecture, scenario, configuration, and seed inputs twice and compare results.

## Commit & Pull Request Guidelines

History currently contains only `Initial commit`, so no established convention exists. Use short, imperative commit subjects, for example `Document virtual clock invariants`, and keep each commit focused. Pull requests should explain the motivation, summarize affected design guarantees, link relevant issues, list validation performed, and include screenshots for future browser UI changes.
