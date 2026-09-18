# Repository Guidelines

## Project Structure & Module Organization

DistLab is currently a documentation-first project. Project documentation lives in `docs/`: `docs/vision.md` defines the product goals and teaching use cases, `docs/architecture.md` specifies the deterministic simulation model and runtime components, `docs/glossary.md` defines shared terminology, and `docs/spec/` contains feature-specification materials. The repository root contains project-level files such as `AGENTS.md` and `LICENSE`. No application source, test suite, generated assets, or dependency manifest exists yet.

When implementation begins, keep runtime code, tests, and browser assets in clearly separated top-level directories such as `src/`, `tests/`, and `public/`. Update both design documents when a code change alters a stated architectural guarantee.

## Build, Test, and Development Commands

There is currently no build or test toolchain. Useful checks for documentation changes are:

```sh
git diff --check                  # find whitespace and conflict-marker problems
rg '^#{1,6} ' AGENTS.md docs/     # review Markdown heading structure
git status --short                # confirm the intended files are included
```

Add new setup, build, run, and test commands here when introducing a toolchain; they should also be documented in the project README.

## Coding Style & Naming Conventions

Write concise Markdown with ATX headings (`# Heading`), blank lines around lists and code fences, and language-tagged examples such as ```` ```ts ````. Keep project documentation under `docs/`, use descriptive lowercase filenames (`docs/vision.md`, `docs/architecture.md`), and keep terminology consistent with the architecture: `VirtualClock`, `VirtualNetwork`, `MessageBus`, and runtime component categories are distinct concepts.

Future simulation code must preserve determinism: use the virtual clock instead of `Date.now()`, `setTimeout()`, or `setInterval()`, and use seeded randomness instead of `Math.random()`. Components must communicate through the modeled network or message bus.

## Testing Guidelines

No testing framework or coverage threshold is configured. For documentation-only changes, verify rendered Markdown, internal consistency, and clean output from `git diff --check`. New executable features should include tests in the same pull request, especially reproducibility tests that run identical architecture, scenario, configuration, and seed inputs twice and compare results.

## Commit & Pull Request Guidelines

History currently contains only `Initial commit`, so no established convention exists. Use short, imperative commit subjects, for example `Document virtual clock invariants`, and keep each commit focused. Pull requests should explain the motivation, summarize affected design guarantees, link relevant issues, list validation performed, and include screenshots for future browser UI changes.
