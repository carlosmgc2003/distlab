# Workspace UX assessment, November 2026

This assessment covers the browser workspace around the architecture graph: the
command toolbar, lesson guidance, the editors that change a session (Compare,
Design choices, Break the system), commerce lesson state and checks, and the
Recorded history tab. The graph area itself, meaning everything
`ArchitectureView.tsx` renders, is left for a separate examination.

The production build was served with `vite preview` and driven by Playwright at
the supported desktop baselines, 1366×768 and 1534×897, using three lessons:
`response-lost` (checkout), `saga-uncompensated`, and `retry-unsafe` (commerce).

## Measurements

All values are CSS pixels at 1366×768, read with `getBoundingClientRect()`.

| State | Toolbar height | Graph canvas top | Canvas visible in viewport | Controls in viewport |
| --- | --- | --- | --- | --- |
| Checkout loaded | 202 | 465 | 267 | 29 |
| Checkout completed | 202 | 465 | 267 | 37 |
| Commerce loaded | 202 | 563 | 205 | 24 |
| Commerce, Design choices open | 202 | 684 | 84 | 26 |

- For commerce lessons, the **Business invariants** list starts at y≈1540–1640.
  That is 800–870 px below the bottom of the viewport, inside the Architecture
  panel's own scroll region, which is 256 px tall.
- In checkout lessons, the lesson guide and the evidence links ("Show dropped
  processor response" and others) sit two disclosures deep inside the toolbar
  drawer **Lesson guide & run insights**. That drawer scrolls inside regions
  capped at 12–20 rem.
- A loaded lesson can be restarted in five ways: the scenario select, which
  reloads immediately once a lesson is loaded but does nothing before that;
  **Load scenario**; **Compare**; **Apply choices and reload**; and **Apply
  faults and reload**.
- In Recorded history, you can narrow by category or component with five
  controls: the **Show** select, the quick-view toggles, the **Focus
  component** select, the component chips, and **Advanced filters**. View modes
  are nested three deep: Story/Learning/Raw, then Diagram/Table, then the filter
  drawer.
- A selected observation is stated four times: "Reviewing observation 114…",
  "Selected #114 message.published…", "Visible observation 115 of 267", and
  "Selected event details · #114". The detail panel calls it "Step #187", while
  **Step** is also a simulation command.

## Findings

1. **No flow.** Nothing tells the student what to do next or where the result
   is. The lesson's question, instructions, outcome, and evidence are spread
   over the toolbar drawer, the learning prompt bar, and the area below the
   graph.
2. **The outcome is hidden.** After **Run** completes, the commerce verdicts
   (VIOLATED/HOLDS) stay off-screen. The checkout Run overview is behind two
   disclosures.
3. **One toolbar holds four jobs.** It carries lesson selection, simulation
   execution, architecture replay, and lesson/run insights. "Recorded history"
   names both a toolbar group (graph replay) and a tab (review). These are two
   different things that `CONTEXT.md` says share no seam.
4. **The shell changes between tabs.** Recorded history hides the whole toolbar
   and the lesson prompt, and adds **Show simulation controls**. Run and Reset
   disappear.
5. **Changing a session has no single path.** Design choices sit inside the
   learning prompt, Break the system is a bar inside the Architecture tab that
   turns into a right column, and Compare is a button in the prompt. Each has
   its own pending note and Apply button.
6. **Recorded history duplicates controls.** Each filter dimension has two or
   three controls, and the selection is restated several times. The floating
   detail panel covers the story diagram and, once simulation controls are
   shown, the tab row ([screenshot 09](09-history-detail-overlap.png)).
7. **Explanatory prose is always visible.** Many permanent sentences state
   system guarantees ("These are recorded facts, not predictions", "Quick views
   narrow the recorded history; they never change the run") instead of helping
   the student act. Wording is tracked in #103. This assessment is about the
   number and placement of these sentences.

## Deferred to the graph examination

Everything `ArchitectureView.tsx` renders is deferred, including:

- the "Architecture" heading that repeats the tab name;
- the two readout lines above the canvas;
- the **Connections** disclosure overlapping the legend at 1366×768
  ([screenshot 02](02-lesson-guide-drawer.png));
- the pan buttons;
- the raw `AVAILABLE · {}` text in the component inspector.

## Screenshots

| File | State |
| --- | --- |
| [01](01-checkout-loaded.png) | Checkout lesson loaded |
| [02](02-lesson-guide-drawer.png) | Lesson guide drawer with Run overview and Lesson guide open |
| [03](03-commerce-completed.png) | Commerce lesson completed: no verdict visible |
| [04](04-commerce-checks-scrolled.png) | The verdicts after scrolling the Architecture panel |
| [05](05-design-choices-open.png) | Design choices open: the graph is pushed below the fold |
| [06](06-break-panel-open.png) | Break the system open as a right column |
| [07](07-history-story.png) | Recorded history: the toolbar is hidden |
| [08](08-history-filters-open.png) | Filter drawer: duplicated quick views and component filters |
| [09](09-history-detail-overlap.png) | Observation detail overlapping the tab row |
| [10](10-history-learning.png) | Learning view listing raw event types |
