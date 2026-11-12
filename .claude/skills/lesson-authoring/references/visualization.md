# What the screen shows for a lesson

How a lesson's configuration becomes the graph, the Story, Service state, and
evidence, and which levers an author has. Almost everything on screen is
*derived*: a lesson shapes its visualization through IDs, names, logs, and
stored fields far more than through presentation code. The specification is
`docs/spec/architecture-visualization.md`; Recorded history is specified in
`docs/learning-timeline.md`, and the look in `docs/ui-visual-system.md`.

Contents: [See it first](#see-it-first) · [The graph](#the-graph) ·
[The Story](#the-story) · [Service state and evidence](#service-state-and-evidence) ·
[Replay](#replay) · [What a student sees of your IDs](#what-a-student-sees-of-your-ids) ·
[When presentation code must change](#when-presentation-code-must-change) ·
[Review questions](#review-questions)

## See it first

```sh
npm run build
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts <lesson> --out <dir>
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts <lesson> --lang es --out <dir>
```

Nine images per run:

| Image | Shows |
| --- | --- |
| `1-chooser` | The lesson's card in the Lesson chooser, in its topic, beside its partner |
| `2-ready` | The lesson loaded: ① Goal and the graph |
| `3-completed` | After Run: the outcome line and verdicts in ③ Investigate |
| `4-graph` | The canvas alone |
| `5-service-state` | The Service state dialog |
| `6-history` | Recorded history, Story diagram: lanes and the first columns |
| `7-story-table` | Recorded history, Story table: the first rows |
| `8-evidence` | *Show evidence* on the first violated check (or the first check): the selected record and its evidence |
| `9-experiment` | The Experiment drawer: each design choice with its label, hint, and lesson default, and the faults the lesson allows |

The default viewport is 1366×768, the smaller of the two supported baselines
and the one where problems show; `--size 1534x897` is the other. Use `--scale
2` for an image that goes into a pull request. The Spanish run matters for
layout: Spanish strings are longer.

Open the images and look. The two history images show where the Story starts,
not the whole run: read the sheet's Story list, which is the Story table as
text, for the rest, and say in a review which claims come from it.

## The graph

The architecture graph is laid out automatically by ELK from the normalized
architecture. Nobody positions a node, and positions never enter projections,
commands, or history.

What is derived, and from what:

| On screen | Derived from |
| --- | --- |
| Node shape, glyph, caption (client pill, service rectangle, external hexagon, topic or queue channel) | The component `kind`, the destination `kind` |
| Left-to-right columns | Tiers: clients, then services and MessageBus destinations, then persistence, then external services |
| Request arrows | `architecture.links`, drawn caller → callee |
| Publication and subscription arrows | The models' declared `publishes`, and `architecture.subscriptions` |
| Database cylinder or key-value box under a service | `architecture.databases` and `architecture.stores`, as satellites of their owner |
| Shared key-value store node | A component whose model is `commerce.kv-server` |
| "Empty slot" badge and dashed outline | A component whose model descriptor has `placeholder: true` |
| Node title | The display name of the component ID, or the ID |

The author's levers:

- **How many nodes.** The strongest lever. Each component, destination, and
  owned resource is a node. Packaged lessons draw 2 to 6 component and
  destination nodes. Five columns is already as wide as the canvas shows whole
  at 1366×768; beyond that the view starts at the clients and the student pans.
- **Component IDs and display names.** An ID has one display name across every
  packaged lesson (`apps/web/src/i18n/{en,es}/components.ts`). Reuse the
  commerce cast so a student recognizes Orders from one lesson to the next.
  A new ID needs a name in both languages; without one the graph, the Story
  lanes, narration, and Service state show the raw ID. Two instances of one
  model get parallel names (`worker-1`, "Worker 1").
- **Link direction.** A link's `source` is the caller. Drawing follows it, and
  so does the reading order of the story, left to right.
- **Destination IDs.** A destination keeps its ID on screen, and the ID is the
  event's name: past tense, PascalCase, a business fact (`PaymentApproved`,
  `OrderPlaced`, `TitleChanged`).
- **Which resource a service owns.** A database or store appears only when the
  document declares it. A service drawn with a database it never writes is a
  false cue; one that writes state with no visible resource hides the story.

Things an author must not do: place nodes, special-case a lesson or a
component ID in presentation code, or add a decorative node the simulation does
not have.

Legibility is tested: `e2e/graph-legibility.spec.ts` loads every packaged
lesson at both baselines and requires each component name to render at 10 px
or more, and `e2e/layout-budget.spec.ts` bounds the workspace. A new lesson is
picked up by the first test automatically.

## The Story

Recorded history shows one teaching view, Story, as a swimlane diagram and a
table over the same milestones. A milestone is one stored observation of a
teaching type: requests and responses (sent, delivered, received, dropped),
messages (published, delivered, acknowledged, retried, NACKed, dead), committed
and rolled-back or rejected transactions, external effects, faults, key-value
changes and expiries, handler failures, **business logs**, and the first result
and each change of each check. Scheduler bookkeeping, staged writes, reads, and
handler starts are not listed. The full list is `docs/learning-timeline.md`.

Lanes are the stored `source` of each observation, in first-milestone order,
under the component's display name. Columns are canonical sequence. A rule
marks each change of virtual time; no duration is drawn or implied.

Labels state the stored type and stored fields only: "Request sent",
"Transaction committed", "Key-value entry expired: lock:report", "Log:
storage.fenced", "Check: writes-in-token-order did not pass". They never add
causation or outcome, and no lesson gets a custom label.

So a lesson shapes its Story through what its models *do and record*:

- **Business logs are the lesson's own milestones.** `ctx.log.write(level,
  "<noun>.<event>", data)` in a handler produces "Log: ‹message›" in the
  model's lane. It is the only milestone whose text the lesson author chooses.
  Put one at each decision the lesson is about, and none where a transport or
  storage record already says it. Observation detail shows the `data` fields,
  so include the values that explain the decision.
- **Key-value keys are shown.** `kv.changed` and `kv.expired` carry the stored
  key: name keys so they read as facts (`lock:report`, `price:sku-1`,
  `cart:cart-1`).
- **Rejections are milestones.** A rejected commit, a failed key-value
  condition, a failed handler, a NACK: when the lesson's fix works by refusing
  something, the refusal is visible without any extra log.
- **Volume is yours to control.** Every request is four milestones (sent,
  delivered, response sent, response received) and every commit one. A hop the
  story does not need costs four milestones per call.
- **Check IDs are shown.** "Check: ‹id› passed" uses the assertion ID, so an ID
  is a short readable phrase (`one-payment-per-order`), not a code.
- **Lane order follows first appearance.** The component that acts first is the
  top lane; the simulation lane appears when the first check is evaluated,
  which for an `always` invariant is t=0.

Read the sheet's Story list top to bottom as a student would, without the
guide. If the lesson's turning point is not a line you can point at, it needs a
log or a simpler run. If you have to scroll past dozens of identical lines to
reach it, it needs less workload.

Quick views (Faults & timeouts, Requests & responses, Messages, State changes,
Rejections & failures) filter the same milestones; a lesson needs nothing to
support them.

## Service state and evidence

**Service state** (③ Investigate → Show service state, and the Component
inspector) shows recorded facts only:

- each service's committed rows by table, its lifecycle, and its live
  key-value entries with `expires at t=…`;
- each client's stored outcomes, keyed by the request's label, which is the
  workload action's ID (`pay`, `checkout`, `job-worker-1`);
- each external service's availability and declared visible state;
- each destination's delivery records (message, state, attempt) and its
  dead-letter queue.

Runtime tasks, provider counters, and anything a handler holds in memory are
not shown. If the lesson's point lives in such a place, move it into a row, a
key-value entry, or a log field.

Design rows to be read: a `status` in business words, the fields that explain
the outcome (`source: "cache"`, `version`, `checkedOutAt`, `cartExpiresAt`),
and keys that identify the thing (`order-1`, `res-customer-app`). An
append-only table of attempts (`writes` with `seq`, `token`, `accepted`) lets a
student see what was refused as well as what was stored.

**Evidence.** Each settled check has *Show evidence*, which opens the stored
`scenario.assertion.evaluated` record with the check's label, verdict, and the
predicate's `evidence` value. That value is a design surface: return the rows
or facts that make the verdict obvious.

## Replay

After Run, Replay moves a cursor over the recorded movements and paints a token
along the link from the record's origin to its destination. It is presentation
over published records: it never advances virtual time or sends a command.

Narration and the "what to look for" question come from the observation type
(`apps/web/src/i18n/*/playback.ts`, `pattern`) and stored fields. They are the
same for every lesson, so a lesson cannot and should not customize them.
Changing one changes it everywhere; treat it as a product copy change, not a
lesson change.

A movement needs a link to travel on. Every call a model makes must have a
declared link (composition checks this), and a message travels publisher →
destination → subscriber.

## What a student sees of your IDs

Choose these as carefully as copy, because they are copy:

| Identifier | Where it shows |
| --- | --- |
| Component ID | The Component inspector's `Component ID` row, payloads, filters; elsewhere its display name |
| Destination ID | The graph node, Story lane, Service state |
| Workload action ID / request label | The client's stored outcomes; the Observation detail |
| Table names, row keys, field names, status codes | Service state, staged and committed writes, evidence |
| Key-value keys | Story labels, Service state |
| Log message names and data fields | Story labels, Observation detail, the guide |
| Check IDs | Story check milestones, the guide, tests |
| Design-choice keys | The run header (`idempotency=on · timeout=40`), the guide |
| Fault rule IDs | `fault.*` milestones and their detail |

All of them stay in English and are never translated, which is one more reason
to keep them short, lowercase, and made of business words.

## When presentation code must change

Rarely. Signs that it is justified: a new *kind* of thing the symbol language
cannot express (as the shared key-value store was), or a stored record type the
milestone set lacks.

Then it is a specification change, not a lesson detail:

1. Propose it and get agreement first; the project routes visual judgment to a
   human.
2. Update `docs/spec/architecture-visualization.md` (symbol language) or
   `docs/learning-timeline.md` (milestone set; `records.test.ts` reads that
   document and fails when code and document disagree).
3. Derive the treatment from the declared model, descriptor, or kind in
   `apps/web/src/architecture-view.ts`, never from a component ID or lesson
   name. Carry meaning by shape and text, with color as a second cue.
4. Put every new string in the message catalogs in both languages.
5. Add the unit test (`apps/web/tests/architecture.test.ts`) and check both
   themes and both baselines.

## Review questions

- At 1366×768, with the Lesson panel open, is the whole graph visible, and can
  you read every name? In Spanish too?
- Does the graph alone tell who calls whom and who owns which data? Is any node
  there that the story never touches?
- Do the display names read as roles, and are they the same names other lessons
  use for the same component?
- In the Story list, can you point at the line where the lesson turns? Is it a
  named log or a rejection, or does the student have to infer it?
- How many milestones before that line, and how many identical ones?
- After the run, does Service state show both sides of the disagreement as
  rows, entries, or outcomes?
- Does *Show evidence* on the violated invariant show the facts that prove it?
- Do the IDs a student meets (keys, tables, statuses, logs, checks) read as
  business words?
