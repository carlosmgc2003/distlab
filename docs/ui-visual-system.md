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

The shell has three levels, and each level owns its own information. A reader
should never have to reconcile two statements about the same fact.

| Level | Region | Carries |
| --- | --- | --- |
| Summary | `Committed simulation state` in the command toolbar | Run status, virtual time, processed events, pending events |
| Investigation | `Architecture` tab, `Recorded history` tab | System structure with component inspector, or recorded evidence with observation detail |
| Detail | The observation detail inside `Recorded history` | Summary, effect evidence, related evidence, and technical record for the selected observation |

DistLab is a desktop learning application. The supported desktop viewport
baseline is 1366×768 and 1534×897, covered by browser tests. Mobile screen
resolutions are explicitly unsupported: there is no mobile layout and no
mobile-resolution browser coverage. Desktop browser zoom, keyboard access,
screen-reader semantics, and reduced-motion behavior remain accessibility
requirements. The desktop tabbed layout remains usable at 200% browser zoom
(683×384 CSS pixels for the 1366 baseline) with vertical scrolling and no
horizontal overflow; zoom support is not mobile support.

Rules that keep the levels distinct:

- The committed run is stated once. Status, virtual time, and the two event
  counts share one region and one line; no second line restates completion,
  and no region repeats the run's virtual time. Engine counters such as random
  draws and the observation count stay under the **Advanced diagnostics**
  disclosure.
- Simulation commands and recorded-history navigation are two separate control
  groups that share the command row, kept apart by a vertical rule and their own
  visible labels. `Run`, `Pause`, `Step`, and `Reset` carry **Simulation
  execution**; `Play timeline`, `Pause timeline`, `Previous observation`, and
  `Next observation` carry **Recorded history navigation**. Each group is a
  `group` with its label as the accessible name, so the distinction survives
  without the styling, and only the simulation group's first command is painted
  as the primary action.
- Only the first group changes the run. The history group states its boundary
  in one sentence: reviewing history does not change the simulation or its
  virtual time.
- The loaded investigation workspace exposes exactly two top-level tabs:
  **Architecture** (architecture graph and Component inspector) and
  **Recorded history** (history navigation/filtering and Observation detail
  together). The former narrow/mobile Architecture, Timeline, and Inspection
  view switcher is removed.
- The tab set uses standard tab semantics (`tablist`, `tab`, `tabpanel`),
  has a clear active state (`aria-selected`), is keyboard operable (including
  Left/Right/Home/End within the tablist), and moves focus predictably:
  direct tab changes focus the activated panel, while evidence links activate
  the Recorded history tab, select the target record, and move focus to the
  selected row.
- Switching tabs preserves component selection, observation selection, history
  mode, filters, and other investigation state; both tab panels stay mounted
  and the inactive panel is hidden. Only a scenario load or reset clears the
  state that load/reset already resets.
- Simulation controls and committed simulation state stay outside the tabs.
  Selecting evidence, changing history views, or switching tabs sends no
  worker commands and does not change simulation state or virtual time.
- Observation detail is summary-first inside the Recorded history tab, in
  this order: **Event summary** (plain-language stored event label,
  sequence, virtual time, source, target, payload visibility), **Effect and
  evidence** (before/after changes when stored, otherwise an explicit
  statement that none were stored), **Related evidence** (causing
  observation, effects, current trace, event/entity filters), **Technical
  record** (canonical IDs, trace/span/event IDs, visibility statement, stored
  JSON). Headings for requests, commits, faults, dropped responses, timeouts,
  and external effects are pure presentation mappings over stored fields;
  redacted payloads are never reconstructed or summarized as if visible.

## Architecture playback and message flight

The Architecture tab can replay the movements a run has already recorded, so a
reader watches requests, responses, and messages travel between components at a
pace they choose. The transport is the **Recorded history** group on the command
row: `Play timeline`, `Pause timeline`, `Restart timeline`, `Previous
observation`, `Next observation`, and a **Speed** select. It shares the command
row with **Simulation execution** to keep the graph area tall, and is separated
from it by a vertical rule and its own label rather than by a second block of
chrome. It appears only while the Architecture tab is showing, because the graph
it animates is the graph it belongs to.

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
  ends with the last movement still painted and offers `Restart timeline`.

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
so a scrolling panel such as the timeline tools region never clips it, and it
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

Timeline quick views use the same categories: each toggle is labeled and shows
a count of the stored records it keeps, and the pressed state uses the shared
`--selection-*` tokens rather than a new color.

A milestone also carries its stored label text, and a recorded virtual-time
boundary is drawn as a dashed rule with a `t=` label. A rule marks a recorded
boundary only; its length and spacing never encode elapsed time, and the view
states that no duration is stored.

Run is the primary simulation command. Disabled commands remain visibly muted;
selected panels and observations use a strong blue boundary and background.
Focus uses a 3px outline with offset. Movement animation is removed when the
user requests reduced motion. Color is not the only carrier of category or
state information.
