# MVP Implementation Readiness Review

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-21 |
| Related issues | #3 |

## Baseline decision

The MVP specification set is ratified for implementation. ADR-002 is accepted;
component specs are marked implementation-ready; deferred capabilities are
listed in their owning specs rather than left for implementers to infer.

## Remaining blockers

No implementation-blocking semantic gaps remain for the deterministic headless
MVP. Any later departure from these decisions requires either a versioned spec
change or a new ADR under the architecture change policy.

## Namespace decision

`database.*` is the authoritative observation namespace. The former informal
`db.*` shorthand is not a canonical namespace and must not be emitted by
implementations.

## Traceability to later MVP work

| Decision | Normative source | Unlocks |
| --- | --- | --- |
| ADR-002 runtime semantics accepted | `docs/spec/adr/002-runtime-model-semantics.md` | Kernel/runtime implementation issues #4 and #5 |
| Seeded random algorithm and reset behavior | `docs/spec/seeded-random.md` | Network, fault, reproducibility work |
| Database observation namespace is `database.*` | `docs/spec/database.md`, `docs/spec/observability.md`, `@distlab/contracts` | Observability and inspector work |
| Read-only projections and worker protocol | `docs/spec/application-boundary.md` | Headless host, browser worker, React UI |
| React + React Flow presentation stack | `docs/spec/application-boundary.md` | MVP UI implementation |
| Versioned four-component catalog | `docs/spec/mvp-catalog-scenario.md` | Catalog/scenario implementation |
| Response-lost checkout assertions | `docs/spec/mvp-catalog-scenario.md` | Reference lesson and reproducibility tests |
| Interactive faults record scenario inputs | `docs/spec/application-boundary.md` | UI fault selection and scenario loading |
| Public TypeScript contract reconciliation | `packages/contracts/src/*` | Cross-package compile-time compatibility |

## Deferred capabilities

Architecture editing, YAML authoring, save/load persistence, rewind, full
snapshots, additional commerce services, retries/remediation lessons, alternate
providers, and server execution are deferred. These are not required to satisfy
the MVP baseline and must not be partially introduced by runtime packages.
