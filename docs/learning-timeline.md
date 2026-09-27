# Learning Timeline

The timeline has three read-only views over the same canonical execution
history. Story is the initial teaching view; Learning and Raw keep every
record. Explanations about how to read a view are shown on demand from a hint
pill rather than as permanent paragraphs.

## Story view

Story is a presentation projection over `RuntimeProjectionSet.history`. It
reduces a completed run to a small set of milestones and shows the reduction
explicitly, for example `22 teaching milestones from 267 recorded
observations.`

A milestone is one stored observation. The projection keeps only records that
explain the lesson:

- `network.request.sent`, `network.request.delivered`, `network.request.dropped`
- `network.response.sent`, `network.response.received`, `network.response.dropped`
- `message.published`, `message.delivered`, `message.acknowledged`, `message.ack.stale`
- `message.retry.scheduled`
- `database.transaction.committed`, `database.transaction.rolledback`
- `external.effect.committed`
- `fault.rule.matched`, `fault.effect.selected`, and any other `fault.*` record

Everything else — scheduler and clock bookkeeping, assertion evaluations,
transaction starts, staged writes, row reads, handler and lifecycle records,
component actions, and simulation lifecycle records — stays in Learning and
Raw. Story never adds, drops, reorders, or merges observations: a milestone
holds the same `Observation` object as Raw, and its column position is its
position in canonical `Observation.sequence` order.

The view has two representations of the same milestones:

- a component swimlane strip. Columns are canonical sequence, each column is one
  milestone, and the lane is the stored `source` of that observation, in
  first-recorded-milestone order;
- a table. Each row is one milestone and its row header is a button that selects
  that exact observation.

Selecting a milestone in the strip and selecting its row select the same
observation, so both produce the same Observation detail and the same
architecture emphasis and movement text.

### Non-inference rules

- Milestone order and identity come only from `Observation.sequence` and
  observation ids.
- Virtual time is labeled at recorded boundaries only. A boundary marker appears
  where a milestone is recorded at a different virtual time than the previous
  one, and the marker is a rule, not a length. No duration, latency, or elapsed
  time is implied between milestones, and none is stored.
- Labels describe the stored type and stored fields only, such as the stored
  `attempt` on a delivery. They do not add causation, ordering, or outcome.
- Story selection, filtering, and playback are UI state. They send no worker
  command, do not advance virtual time, and do not modify projections or
  history. Playback over the visible canonical list keeps its existing
  behaviour in Raw.
- When the current filters select records that are not milestones, Story says
  so and points to Learning and Raw instead of inventing a milestone.

### Accessibility

The strip is a visual summary; the table is the keyboard and screen-reader
alternative. The view states a text summary of the reduction, the lanes, and
the first and last recorded virtual times, plus a longer text description of the
recorded boundaries, the shapes, and the category counts. Category meaning is
carried by text and shape, not by color alone. Both representations are
announced by the same milestone label, and the shape legend names every shape
present in the current results.

## Quick views and advanced filters

Quick views are read-only UI predicates over the visible history snapshot. They
narrow which recorded observations the timeline displays; they are not
`ExecutionHistoryReader` filters, and they never send a worker command, advance
virtual time, or change randomness, component state, or history. Each label
names the stored records it keeps, and each view uses the same teaching
categories as the Story milestones:

- **Key events** — every Story milestone category.
- **Faults & timeouts** — `fault.*` records, dropped messages, and timeouts.
- **Requests & responses** — recorded network requests and responses, including
  dropped and timed out ones.
- **Messages** — published, delivered, acknowledged, and retried messages.
- **State changes** — committed and rolled back transactions and committed
  external effects.
- **Assertions** — `scenario.assertion.evaluated` records and their stored
  verdicts.

The recorded components and the selected trace are offered as the same kind of
chip. A component chip and a trace chip are canonical exact filters, so they
compose with the quick view and with the advanced fields instead of replacing
them.

A quick view is applied before the advanced fields, so the two compose by
intersection: the timeline shows records kept by the quick view that also match
every active canonical filter. The result count, the selected position, and the
empty-state explanation stay next to the rows they describe, and each quick
view states how many observations it shows out of the recorded total.

The canonical fields, their match modes, and their suggestions stay under the
**Advanced filters** disclosure with unchanged semantics. Active quick views
and active fields appear as removable chips, and **Clear all filters** removes
both. An empty result names the active quick view and the active fields and
offers the same reset. Revealing an observation from evidence, causation, or a
trace clears the quick view when that view would hide it, exactly as it clears
the fields that would hide it.

### Non-inference rules

- A quick view keeps or drops whole stored observations. It never merges,
  reorders, or rewrites a record, and it never reads redacted payload fields.
- The counts on a quick view are the number of stored records the predicate
  keeps in the current run, not a rate, a severity, or a health measure.
- Quick views are UI state owned by the browser, like the filter draft, the
  selected observation, and the playback cursor.

### Accessibility

Quick views are toggle buttons with `aria-pressed` in a labelled group. Each
button's accessible name repeats its record count over the recorded total and
the records it keeps; the count badge beside the label is decorative. The
summary line is plain text, so the shown-of-recorded counts are available
without relying on the badge. The advanced fields keep their own combobox and
select semantics. The row-order and matching-rules explanations are hint pills
rather than permanent paragraphs.

Panel space is bounded rather than allowed to overflow. The quick views and the
advanced form share one scrolling region that yields first when the active
filter chips grow, the chip row scrolls on its own once several filters are
active, and the rows keep a minimum height. Playback, the active filter chips,
the result count, and the rows stay outside that region, so the panel never
clips a control or the event list.

## Learning view

Learning view gives stored observation types short labels and collapses only
adjacent implementation bookkeeping:

- contiguous startup `scheduler.*` and `clock.*` records before the first simulation event form an engine queue-setup group; later scheduling records stay visible;
- adjacent `scenario.assertion.evaluated` records form a group only when their stored data is unchanged.

A group shows its member count and inclusive original sequence and virtual-time
bounds. Opening it exposes each original ID, sequence, virtual time, and type in
canonical order. Selecting a member through evidence also opens its group. No
business delivery, retry, external side effect, commit, rollback, fault, or
changed assertion is collapsed. In particular, delivery attempts stay as
distinct observations.

## Raw view

Raw view shows every filtered canonical observation in sequence order. All
three views use the same filters and selection; none of them modifies history,
exports, virtual time, scheduling, randomness, or causal data.

The labels, groups, and milestones state only what is stored. They do not infer
elapsed time or causal links.
