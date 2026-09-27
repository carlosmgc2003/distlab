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
