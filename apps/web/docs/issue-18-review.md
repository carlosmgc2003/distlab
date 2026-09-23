# Issue 18 independent review

Reviewed the settled implementation at `06dda5d` on
`carlosmgc2003/issue-18-react-flow` for [issue #18](https://github.com/carlosmgc2003/distlab/issues/18)
and preserved [PR #40](https://github.com/carlosmgc2003/distlab/pull/40).

## Findings fixed

- `apps/web/src/ArchitectureView.tsx:28` — drag-only panning now has labeled,
  keyboard-operable arrow buttons; viewport updates stay inside React Flow.
- `apps/web/src/ArchitectureView.tsx:51` — node `aria-controls` now references
  the inspector panel instead of its heading.
- `apps/web/src/ArchitectureView.tsx:72` — an inspector skip link now gives
  keyboard users a direct route to metadata, with visible destination focus.
- `apps/web/src/ArchitectureView.tsx:81` — the graph application role now has
  an accessible name on the role-bearing element.
- `apps/web/src/architecture.css:9` — buttons now provide hover feedback;
  the new link and inspector destination have explicit focus styling.
- `README.md` — replaced the stale statement that all controls beyond the
  chooser were deferred; documented the read-only graph and metadata sources.

## Architecture and React review

The application boundary and MVP catalog specifications, architecture sections
2, 31, 34, and 36, and the repository guidance remain satisfied. Five nodes show
the client, two internal services, external provider, and MessageBus destination.
Two request edges and one subscription come from the projection; the documented
Orders publication is version-gated lesson copy. Category text, border shapes,
edge labels, and dash patterns provide cues independent of color.

Layout positions are deterministic and detached from simulation inputs.
Configuration and resource ownership come from matching frozen packaged
metadata, with undeclared infrastructure model/version shown explicitly. The
inspector receives no component-state projection. Empty, malformed, worker-error,
and private-state cases have regression coverage.

The React best-practices review found stable node types, memoized mapping and
node rendering, derived inspector selection, and local selection/viewport state.
The new pan controls read the current viewport in event handlers. No effects,
runtime imports, contracts, kernel, ScenarioEngine, or catalog changes were added.

The [current Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
were fetched on 2026-09-23 before the UI review. Relevant checks covered semantic
controls, keyboard alternatives, names, focus, hover, responsive content,
contrast-independent cues, and empty/error states.

## Validation

- Root build, typecheck, unit/worker tests, and package-boundary checks.
- Seven Chromium browser tests, including an axe scan before loading and for
  all five selected inspectors at desktop and mobile sizes.
- Both checkout variants exercise keyboard selection, viewport buttons,
  dragging, inspector focus navigation, and verify that UI interactions send
  only the initial load command; a test-only worker probe confirms unchanged
  canonical history and component state afterward.
- Manual desktop/mobile browser inspection and refreshed `architecture.png`.
- `git diff --check`.

No remaining in-scope blockers were found. Browser validation targets the
repository's Chromium baseline; automated accessibility checks do not substitute
for testing every assistive technology.
