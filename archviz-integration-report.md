# Architecture Visualization Integration Report

## Integration

- Target branch: `cmaceira/fix-component-visualization-differentiation`.
- Integrated approved branch `cmaceira/archviz-t6` at `77fe52c5f2073026104fa3daaf5b979e872f01b4` with merge commit `5bc05d8` (`Merge branch 'cmaceira/archviz-t6' into cmaceira/fix-component-visualization-differentiation`).
- The integrated branch history includes prior merges `5d1fcfe` and `c29e0f4`.
- No conflicts occurred. No push, pull request, or primary-branch merge was made.
- Final feature-branch HEAD: `5bc05d8`.

## Full effort file-change list

Compared with base `52076a6`, the integrated source changes are:

- `apps/web/e2e/accessibility.spec.ts`
- `apps/web/e2e/architecture-fit.spec.ts`
- `apps/web/e2e/architecture-flight.spec.ts`
- `apps/web/e2e/checkout-lesson.spec.ts`
- `apps/web/e2e/smoke.spec.ts`
- `apps/web/src/ArchitectureView.tsx`
- `apps/web/src/ComponentInspector.tsx`
- `apps/web/src/architecture-view.ts`
- `apps/web/src/architecture.css`
- `apps/web/tests/architecture.test.ts`
- `apps/web/tests/boundaries.test.ts`
- `docs/spec/application-boundary.md`
- `docs/spec/architecture-visualization.md`

This report is an additional untracked file and is not committed. No files under `packages/contracts`, `apps/web/src/worker/`, or `apps/web/src/protocol.ts` changed. Browser-generated evidence screenshot churn was restored after validation; golden fixtures were not modified.

## Validation results

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS (exit 0) |
| `npm test` | PASS (exit 0): 373 tests passed across contracts (16), kernel (4), scenario (11), web Node tests (122), and browser tests (67); 0 failed or skipped |
| `npm run test:boundaries` | PASS (exit 0): 2/2 tests |
| `npm run build` | PASS (exit 0): packages and web production build completed; 215 modules transformed |
| `npm run test:browser` | PASS (exit 0): 67/67 Playwright tests |

The production builds emitted existing non-fatal warnings: `@xyflow/react`'s `use client` directive was ignored by bundling, and the main JavaScript chunk exceeds 500 kB.

## Golden output comparisons

Each command's stdout was captured without npm notices; byte counts and SHA-256 match the T1 baseline in `archviz-t1-baseline.md` exactly:

| Command | Bytes | SHA-256 | Comparison |
| --- | ---: | --- | --- |
| `npm run --silent golden:01` | 11655 | `df96e23d6af3c120038f6c2ad0063b278ed0705b92bb63537f4a37002d9c3df3` | PASS, byte-identical |
| `npm run --silent golden:02` | 41608 | `491f223c42ced6fa5a62d7420c56ecda4e0afcf17be1f1c49027d2240b969cae` | PASS, byte-identical |
| `npm run --silent golden:04` | 29087 | `a0835df107955dcf5bbf50f012a3883ecd495941c38a740e89d342a8355686e9` | PASS, byte-identical |
| `npm run --silent golden:05` | 24228 | `6a8d3a460c0d91ed378c33f03366109e4b6c2fe6cd40ca1a77e4a875d1c3b757` | PASS, byte-identical |
| `npm run --silent golden:06` | 44935 | `aa7af3e959bfac0dce8553fa2d79ea01380e2bb36abba067732d6fe6850429bd` | PASS, byte-identical |
| `npm run --silent golden:07` | 14856 | `f19cf1fc92a95837a9fc23821267d8eeb897cfdd129d5d0cfbc874e2f245ae7b` | PASS, byte-identical |

There is no `golden:03` script in the repository, as also noted in the baseline.

## Invariants, residual risks, and follow-ups

- The integration preserves UI-local resource presentation: the existing `ArchitectureProjection` and worker command surfaces were not changed, and `test:boundaries` passes.
- No UI timer changes were introduced in the integration diff; the visualization remains presentation-only.
- No unresolved merge conflicts or known blocking issues remain.
- Follow up separately on the non-fatal bundle-size warning if chunk optimization is desired; it did not affect build or browser test results.
