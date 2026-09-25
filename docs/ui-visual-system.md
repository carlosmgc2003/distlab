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

Meaning is carried by text and shape as well as color. Architecture nodes keep
their visible category names and use distinct silhouettes or border patterns:
rounded client, solid internal service, dashed external service, and double
border infrastructure. Fault and timeout observations use labeled timeline
types with semantic emphasis. Unknown local outcomes use a dashed uncertainty
badge and explanatory text; they do not imply denial. Authorization statuses
are labeled independently from the local client outcome.

Run is the primary simulation command. Disabled commands remain visibly muted;
selected panels and observations use a strong blue boundary and background.
Focus uses a 3px outline with offset. Movement animation is removed when the
user requests reduced motion. Color is not the only carrier of category or
state information.
