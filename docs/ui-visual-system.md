# UI visual system

The browser interface uses the tokens in `apps/web/src/architecture.css` for
shared surfaces, text, borders, actions, selection, focus, and semantic states.
Components should use these tokens rather than adding isolated color values.

| Token group | Purpose |
| --- | --- |
| `--surface-*`, `--text-*`, `--border-*` | Page and panel layers, readable text, and control boundaries |
| `--action-primary*` | The primary simulation action and its hover state |
| `--selection-*`, focus outline | Current panel, observation, graph path, and keyboard focus |
| `--status-error*`, `--status-warning*`, `--status-uncertain*`, `--status-approved*` | Errors, faults/timeouts, unknown outcomes, and committed approval |
| `--category-*` | Client, internal service, external service, and infrastructure labels |

## Workspace hierarchy

The workspace is a guided lesson: a student always knows what lesson they are
in, what to do next, and where the result is. The shell has four regions, and
each region owns its own information. A reader should never have to reconcile
two statements about the same fact.

This layout was approved in #137. The child issues of #136 deliver it one region
at a time, so until they land the shipped shell can still differ from it.

### Regions

| Region | Holds | Rules |
| --- | --- | --- |
| Top bar | The product name; a lesson trigger, `Lesson: ‹title›`, that opens the Lesson chooser; the **Simulation execution** group (`Run`, `Pause`, `Step`, `Reset`); the committed run summary (status · virtual time · processed · pending) | One row, at most 64 px, identical on both tabs. No drawer, no replay controls, no tagline. |
| Lesson panel | A guided flow in four numbered sections: ① **Goal** (title, question, one-sentence description); ② **Run** (what Run and Step do, and the run status in words); ③ **Investigate** (the outcome first, then evidence links, then the lesson's questions, then **Show service state**; an imported document's checks come first, as it has no outcome line, #160); ④ **Experiment** (what is applied: seed, design choices, student faults; **Compare with ‹pair›**; **Change the experiment…**; the **Advanced diagnostics** disclosure) | The left column, 300–340 px wide. It scrolls on its own, starts expanded, collapses to a rail with one toggle, and is visible on both tabs. The current-step marker is emphasis only: Run while nothing has been processed, Investigate after COMPLETED or FAILED. Nothing is gated. |
| Workspace | The tabs **Architecture** and **Recorded history** | The Architecture panel holds a one-row **Replay** toolbar above the architecture graph, and nothing below the graph. |
| Overlays | **Lesson chooser**: a modal dialog. **Service state**: a modal dialog. **Experiment drawer**: docked on the right and non-modal, so Pick on graph keeps working. It holds Design choices and Faults with one footer: `Apply and restart`, `Discard changes`, `Close`. While it is open, the movement detail and the Component inspector go under the graph instead of beside it, so the canvas keeps the panel's width (#166). | No other overlay is added. |

### Vocabulary

| Term | Use | Replaces |
| --- | --- | --- |
| Lesson | A packaged lesson, in all visible UI text | "Scenario" and "experiment" in visible labels |
| Replay | The Architecture tab's graph playback controls: `Play replay`, `Pause replay`, `Restart replay`, `Previous movement`, `Next movement`, **Speed** | The "Recorded history" group label, `Play timeline`, `Previous observation`, `Next observation` |
| Recorded history | Only the tab and its panel heading | — |
| Observation #n | One recorded record | "Step #n"; **Step** is a simulation command |
| Change the experiment / Apply and restart | The one path that sends the student's edited session overlay | "Apply faults and reload", "Apply choices and reload" |
| Component display name | How a packaged lesson names a component in every student-facing place: graph, narration, Recorded history, Service state, fault targets (#103). The ID stays in the inspector's `Component ID` row, Raw history, and payloads; imported documents and destinations show IDs | Raw component IDs such as `client`, `kv`, `worker-1` as visible labels |

### Layout budgets

| Measure | 1366×768 | 1534×897 |
| --- | --- | --- |
| Top bar height | ≤ 64 px | ≤ 64 px |
| Graph canvas height inside the viewport, lesson loaded, no overlay open | ≥ 440 px | ≥ 560 px |
| Smallest rendered component name on the graph, in every state (#166) | ≥ 10 px | ≥ 10 px |
| First business invariant verdict after a commerce run completes | Inside the viewport without user scrolling | Same |
| Disclosures to open before the lesson guide or evidence links are visible | 0 | 0 |
| Visible paragraphs of 8 or more words outside the lesson panel and graph area | ≤ 2 | ≤ 2 |

The layout budget browser test (`apps/web/e2e/layout-budget.ts`) enforces the
budgets. Each issue of #136 tightened its bounds toward this table; with the
single-row top bar and the Replay toolbar (#144), the top bar and canvas bounds
are this table's values.

DistLab is a desktop learning application. The supported desktop viewport
baseline is 1366×768 and 1534×897, covered by browser tests. Mobile screen
resolutions are explicitly unsupported: there is no mobile layout and no
mobile-resolution browser coverage. Desktop browser zoom, keyboard access,
screen-reader semantics, and reduced-motion behavior remain accessibility
requirements. The desktop tabbed layout remains usable at 200% browser zoom
(683×384 CSS pixels for the 1366 baseline) with vertical scrolling and no
horizontal overflow; zoom support is not mobile support.

### Rules

Rules that keep the regions distinct:

- The committed run is stated once, in the top bar's run summary. Status,
  virtual time, and the two event counts share one region and one line; no
  second line restates completion, and no region repeats the run's virtual time.
  Engine counters such as random draws and the observation count stay under the
  **Advanced diagnostics** disclosure in ④ Experiment.
- Simulation commands and replay are two separate control groups in two
  regions. `Run`, `Pause`, `Step`, and `Reset` carry **Simulation execution** in
  the top bar; the replay controls carry **Replay** in the Architecture tab. Each
  is a `group` with an accessible name (**Simulation execution**, and **Replay
  recorded movements** for the visible label **Replay**), so the distinction
  survives without the styling, and only `Run` is painted as the primary action.
  An error, or a terminal-history notice, takes its own row directly under the
  top bar only while it exists.
- Only Simulation execution changes the run. The Replay group states its
  boundary once: replaying does not change the simulation or its virtual time.
- The top bar and the lesson panel are identical on both tabs. No tab hides the
  simulation controls or the lesson guidance.
- ③ Investigate states the outcome in one line before anything else: for a
  commerce lesson, “‹n› of ‹m› business invariants violated”, “All ‹m›
  business invariants hold”, “Checks are pending: run the lesson”, or “Checks
  are incomplete”; for checkout, the Run overview's outcome sentence. The
  verdicts (commerce) or evidence links (checkout) follow, then the questions.
- When a run ends (COMPLETED or FAILED), the lesson panel scrolls ③ Investigate
  into view (`block: "nearest"`, no smooth scrolling under
  `prefers-reduced-motion: reduce`) and a polite live region announces the
  outcome once per run, not on every projection update. Focus does not move,
  and a collapsed panel stays collapsed.
- The loaded investigation workspace exposes exactly two top-level tabs:
  **Architecture** (the Replay toolbar, the architecture graph, and the
  Component inspector) and **Recorded history** (history navigation and
  filtering, and the docked Observation detail). Service state is a dialog, not
  a third tab.
- The tab set uses standard tab semantics (`tablist`, `tab`, `tabpanel`),
  has a clear active state (`aria-selected`), is keyboard operable (including
  Left/Right/Home/End within the tablist), and moves focus predictably:
  direct tab changes focus the activated panel, while evidence links activate
  the Recorded history tab, select the target record, and move focus to the
  selected row.
- Switching tabs preserves component selection, observation selection, history
  mode, filters, and other investigation state; both tab panels stay mounted
  and the inactive panel is hidden. Only a lesson load or reset clears the
  state that load/reset already resets.
- Selecting evidence, changing history views, switching tabs, or opening and
  closing the lesson panel, the Service state dialog, or the Experiment drawer
  sends no worker commands and does not change simulation state or virtual time.
- The Lesson chooser lists the packaged lessons as cards, one card per group of
  lessons linked by Compare, so a failing lesson sits beside its fix, in catalog
  order. Each lesson is one button, and the loaded lesson carries
  `aria-current="true"`. Choosing a lesson closes the dialog and loads it in one
  action, without an overlay; there is no separate Load button. When the draft
  overlay has unapplied changes, the dialog says once that choosing a lesson
  discards them, with no extra confirmation step. Escape and
  `Cancel` close it without changes, and focus returns to the control that
  opened it. The trigger reads **Choose a lesson** before any load and
  `Lesson: ‹title›` after one, and is unavailable while a command is outstanding
  or the simulation runs.
- **Show service state**, at the end of ③ Investigate, opens the Service state
  dialog, named "Service state at t=‹virtual time›": the commerce per-service
  facts or checkout's Distributed state. Escape and **Close** return focus to the
  button, and a Distributed state evidence button closes the dialog before
  Recorded history selects the record. Advanced diagnostics keeps only the
  engine counters.
- The Experiment drawer edits the draft overlay as UI state
  (`docs/spec/adr/004-session-overlays.md`). `Apply and restart` is the one path
  that sends the student's edits, inside an ordinary `load`; `Discard changes`
  returns the draft to the applied overlay. Compare carries the applied overlay
  to the paired lesson as ADR-004 states, and choosing another lesson in the
  Lesson chooser starts from an empty draft.
- The drawer opens from ④ Experiment's **Change the experiment…**, which carries
  an "unapplied changes" badge while the draft differs from the applied overlay.
  Opening it moves focus to its heading; **Close** and Escape keep the draft and
  return focus to that trigger. It is docked beside both tabs and narrows them,
  and starting **Pick on graph** shows the Architecture tab. A rejected overlay
  opens it with each diagnostic in its own section. While a command is
  outstanding or the simulation runs, it stays readable and its inputs,
  `Apply and restart`, and `Discard changes` are unavailable; `Close` stays
  available.

### Recorded history

- One view switch: **Story diagram** and **Story table**, two presentations of
  the same teaching milestones. Recorded history lists milestones only.
- One control per filter dimension: **Show** (quick views with counts),
  **Component**, and **More filters…**, a modal dialog for advanced filters.
- Active filters appear as chips only while a filter is active.
- Observation detail is docked as the right column of the tab, never floating.
- The selection is stated once, in the observation detail header
  ("Observation #‹sequence› · ‹label› · t=‹time›"). One polite live region,
  read and not shown, announces it; no banner or position line restates it.
- While a filter is active, the result count is shown once, beside the filter
  row ("22 of 267 shown").

Observation detail is summary-first, in this order: **Event summary**
(plain-language stored event label, sequence, virtual time, source, target,
payload visibility), **Effect and evidence** (before/after changes when stored,
otherwise an explicit statement that none were stored; for a
`scenario.assertion.evaluated` record, the check's label, whether its predicate
passed at that boundary, and its stored evidence as rows in the Service state
form, or a statement that the payload is redacted, omitted, or stored no
evidence), **Related evidence**
(causing observation, effects, current trace, event/entity filters),
**Technical record** (canonical IDs, trace/span/event IDs, visibility statement,
stored JSON). Headings for requests, commits, faults, dropped responses,
timeouts, and external effects are pure presentation mappings over stored
fields; redacted payloads are never reconstructed or summarized as if visible.

## Architecture playback and message flight

The Architecture tab can replay the movements a run has already recorded, so a
reader watches requests, responses, and messages travel between components at a
pace they choose. The transport is the **Replay** toolbar, one row at the top of
the Architecture tab panel, above the graph: `Play replay`, `Pause replay`,
`Restart replay`, `Previous movement`, `Next movement`, and a **Speed** select.
It lives inside the Architecture tab, never in the top bar, because the graph it
animates is the graph it belongs to; the top bar keeps only **Simulation
execution**.

- A *movement* is one stored observation that travels a link. A record that
  travels no link is not a movement and stays in Recorded history. Movements keep
  canonical sequence order; nothing is merged, reordered, or dropped.
- The transport states its own position in one region beside the graph: the
  movement number, the recorded virtual time, and the observation sequence. A
  second line states the recorded virtual-time boundaries of the movement list
  and says that no duration is stored. The panel's heading line carries the
  `Graph controls` and `Playback speed` explanations, so neither costs the graph
  a row.
- **Speed** offers Slow, Steady, and Fast. It changes only how long the browser
  paints each movement. It never changes virtual time, the recorded history, or
  the run, and the `Playback speed` hint says so.
- While the run is still recording, the cursor waits at the recorded end for the
  next movement instead of stopping. When the run has finished, the transport
  ends with the last movement still painted and offers `Restart replay`.

The narration beside the graph is a presentation mapping over stored fields:

| Line | Reads |
| --- | --- |
| Heading | The stored plain-language label for the record type |
| Route | Stored `source`, `target`, and the presentation relationship of the link |
| Stored fields | Stored endpoint, deadline, status, attempt, destination, consumer, fault rule, reason, recorded transitions, changed row names, and the stored external change |
| Stored body fields | Stored body field *names*; narration never restates payload values |
| What to look for | One question about the pattern the stored record belongs to |
| Trace | The stored trace id |

A redacted or omitted payload contributes one visibility statement and nothing
else. Pattern questions ask what to look for and never state an outcome, so a
dropped response is never described as a failed operation.

Meaning is carried by text, glyph, and shape. Each painted token has a glyph and
an outline that match the Story timeline legend: `→` request, `←` response,
`⇢` message, `⊘` dropped, `◷` timeout. A movement that arrived leaves the link
highlighted; a recorded drop or timeout leaves its token resting on the link and
states only that the record says the movement did not arrive. The sending and
receiving components carry a text badge on the graph, and the legend names every
token. The token is decorative: the narration, the playback position, and the
`Request and message movement` region carry the same movement as text.

Both ends of a painted movement stay on screen. When the sending or receiving
component is outside the canvas, the graph pans just enough to show both, at the
current zoom, and zooms out only when they cannot both fit (#190), never below the
legible name size. A reader's own
pan and zoom are kept while both components are already visible. Under
`prefers-reduced-motion: reduce` the view changes without animation.

Choosing a record in Recorded history takes the graph highlight back and the
replay cursor stands down. A live cue, which flashes by itself as a run records,
never takes the highlight back from playback. Both tab panels stay mounted, so
the cursor and the narration survive a tab switch.

### Non-inference rules

- The host timer moves a browser cursor over records the worker already
  published. It does not advance virtual time, allocate an observation, or send a
  worker command, and it does not change the run.
- A token paints the stored movement of one record. It encodes no latency,
  ordering, or duration, and it never implies that a component reacted.
- Narration values are stored values. Field names replace payload values, and a
  missing field is not reconstructed.
- Movement order and identity come only from `Observation.sequence` and
  observation ids, exactly as in the Recorded history views.

### Accessibility

The transport is a labelled button group with a `select`, and every control
reaches the next movement or the recorded boundary. The playback position is a
polite live region; the narration is a labelled article, and the graph's
`Request and message movement` region carries the movement sentence while the
narration is open, so no fact is stated twice. Token movement is removed under
`prefers-reduced-motion: reduce`: each token rests where the record says the
movement stopped and keeps its outline, and the narration and position text are
unchanged. The narration and the component inspector share one side column, so
the graph keeps its height at the supported desktop baselines.

## Explanations on demand

Explanatory prose is not part of the permanent layout. Every panel uses one
pattern, `HelpHint` in `apps/web/src/ui-hint.tsx`: a compact pill trigger with an
italic `i` glyph and a short subject, for example `Graph controls`,
`How matching works`, or `About this strip`. Pointer hover and keyboard focus
open the explanation, a click or Enter pins it, Escape and an outside click
close it, and the trigger carries `aria-expanded` with `aria-controls` pointing
at the body.

The body is positioned against the viewport rather than the trigger's ancestor,
so a scrolling panel or a modal dialog such as More filters never clips it, and it
flips above the trigger when there is no room below. The explanation text stays
in the DOM while collapsed, so it remains searchable and testable, and its
`bodyId` can back an existing `aria-describedby`.

Keep visible what a reader needs at a glance: status lines, live regions, counts,
legend keys, and the one-line contract of a control. Put the reasoning behind a
control behind a hint.

Meaning is carried by text and shape as well as color. Architecture nodes keep
their visible category names and use distinct silhouettes or border patterns:
rounded client, solid internal service, dashed external service, and double
border infrastructure. Fault and timeout observations use labeled timeline
types with semantic emphasis. Unknown local outcomes use a dashed uncertainty
badge and explanatory text; they do not imply denial. Authorization statuses
are labeled independently from the local client outcome.

The Story timeline strip gives each milestone category a glyph, a shape class,
and a text label, and the legend names all of them:

| Category | Shape | Outline |
| --- | --- | --- |
| Request | `→` | solid |
| Response | `←` | solid |
| Message | `⇢` | dashed |
| Retry | `↻` | double |
| Transaction commit | `✓` | solid |
| Transaction rollback | `↶` | double |
| External effect | `◆` | rounded |
| Fault | `⚠` | dotted |
| Dropped message | `⊘` | dotted |
| Timeout | `◷` | rounded |

Timeline quick views use the same categories. They are the options of the one
**Show** select in the Recorded history toolbar: each option names its category
and the count of stored records it keeps, and an active quick view appears as a
removable chip. No toggle button repeats them.

A milestone also carries its stored label text, and a recorded virtual-time
boundary is drawn as a dashed rule with a `t=` label. A rule marks a recorded
boundary only; its length and spacing never encode elapsed time, and the view
states that no duration is stored.

Run is the primary simulation command. Disabled commands remain visibly muted;
selected panels and observations use a strong blue boundary and background.
Focus uses a 3px outline with offset. Movement animation is removed when the
user requests reduced motion. Color is not the only carrier of category or
state information.
