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
| Investigation | `Architecture`, `Recorded history`, `Observation detail` | Graph and component state, recorded rows with their filters, one observation's stored detail |
| Detail | The observation detail inside `Recorded history` | Trace, causation, and stored data for the selected record |

Rules that keep the levels distinct:

- The committed run is stated once. Status, virtual time, and the two event
  counts share one region and one line; no second line restates completion,
  and no region repeats the run's virtual time. Engine counters such as random
  draws and the observation count stay under the **Advanced diagnostics**
  disclosure.
- Simulation commands and recorded-history navigation are never one group and
  never one row. `Run`, `Pause`, `Step`, and `Reset` carry the visible label
  **Simulation execution**; `Play timeline`, `Pause timeline`,
  `Previous observation`, and `Next observation` carry **Recorded history
  navigation**. Both labels are the accessible name of their group, so the
  distinction survives without the styling.
- Only the first group changes the run. The history group states its boundary
  in one sentence: reviewing history does not change the simulation or its
  virtual time.
- Panel navigation exists only where the layout shows one region at a time. On
  wide layouts all three regions are visible, so no switcher is rendered: a
  switcher there would imply a hidden panel. Where it is rendered it is a
  segmented control with a pressed state, it is operable from the keyboard, and
  it preserves each region's own selection.
- The three regions are siblings at one heading level, so `Recorded history` is
  never read as a child of `Architecture`.

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
