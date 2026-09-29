# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root. Read it first; it names the seams and the
  vocabulary for the area you're about to touch.
- **`docs/spec/adr/`**: read the ADRs that bear on the area. That spec tree is
  the source of truth for contract names and shapes.
- **`docs/glossary.md`** for the shared terminology, and `docs/architecture.md`
  for the stated architectural guarantees a change must preserve.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo. There is no `CONTEXT-MAP.md`.

```
/
├── CONTEXT.md
├── docs/
│   ├── spec/adr/            ← architecture decisions
│   │   ├── 001-deterministic-execution.md
│   │   ├── 002-runtime-model-semantics.md
│   │   └── 003-boundary-counters.md
│   ├── glossary.md
│   └── architecture.md
├── packages/
│   ├── contracts/  kernel/  scenario/  catalogs/
└── apps/
    └── web/
```

`packages/*` are layers of one system — contracts → kernel → scenario → catalogs,
consumed by the single browser app — not separate bounded contexts. Don't invent
per-package vocabularies or per-package `CONTEXT.md` files; a term belongs to the
project or it does not.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-001 (`docs/spec/adr/001-deterministic-execution.md`), but worth reopening because…_
