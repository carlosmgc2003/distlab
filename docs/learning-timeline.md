# Learning Timeline

Recorded history is one read-only teaching view, Story, over the canonical
execution history. Story has two presentations of the same milestones: the
Story diagram, shown first, and the Story table. Explanations about how to read
the view are shown on demand from a hint pill rather than as permanent
paragraphs.

Recorded history does not list every record. Records that are not teaching
milestones, such as scheduler bookkeeping, stay in the history the worker
published and are read in Observation detail when an evidence link, a causation
link, or a trace leads to them.

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
- `database.transaction.rejected`, `kv.condition.failed`, `service.handler.failed`
- `message.nacked`, `message.dead`
- `kv.changed`, `kv.expired`
- `runtime.log`, the business logs a lesson's models write, such as a saga's
  compensation or a lease check
- `scenario.assertion.evaluated`, only the first result of each check and each
  change of that result

A check is evaluated at every boundary, so an evaluation that repeats the
previous stored verdict of the same check is not a milestone. A check
evaluation without a stored check id or verdict is always a milestone.

Everything else — scheduler and clock bookkeeping, transaction starts, staged
writes, row reads, key-value reads, handler starts and completions, lifecycle
records, component actions, and simulation lifecycle records — is not listed.
Story never adds, reorders, or merges observations: a milestone holds the same
stored `Observation` object the worker published, and its column position is
its position in canonical `Observation.sequence` order.

The view has two representations of the same milestones:

- a component swimlane strip. Columns are canonical sequence, each column is one
  milestone, and the lane is the stored `source` of that observation, in
  first-recorded-milestone order;
- a table. Each row is one milestone and its row header is a button that selects
  that exact observation. When the selected observation is not a milestone,
  for example a check evaluation opened from an evidence link, the table also
  lists it at its sequence position as an "Other record" row named by its
  stored type. The row is there only while that observation is selected.

Revealing an observation, from an evidence link, a causation link, or a trace,
shows the Story table so the revealed observation always has a row to focus.

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
- Labels describe the stored type and stored fields only: the stored `attempt`
  on a delivery, the stored `message` of a business log, the stored `key` of a
  key-value record, the stored `code` or `reason` of a rejection, and the
  stored check id and verdict of a check. A redacted or omitted payload adds
  nothing to the label. Labels do not add causation, ordering, or outcome.
- Story selection, filtering, and playback are UI state. They send no worker
  command, do not advance virtual time, and do not modify projections or
  history.
- When the current filters select records that are not milestones, Story says
  so and asks to remove a filter instead of inventing a milestone.

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

- **Faults & timeouts** — `fault.*` records, dropped messages, and timeouts.
- **Requests & responses** — recorded network requests and responses, including
  dropped and timed out ones.
- **Messages** — published, delivered, acknowledged, and retried messages.
- **State changes** — committed and rolled back transactions, committed
  external effects, and key-value changes and expiries.
- **Rejections & failures** — rejected transactions and key-value conditions,
  failed handlers, and rejected and dead-lettered messages.

Every quick view is a set of milestone categories, because Recorded history
lists milestones only.

Each filter dimension has one control (#145). **Show** chooses the quick view
and lists each one with its count. **Component** chooses one recorded component
as a canonical exact filter, so it composes with the quick view and with the
other fields instead of replacing them. Everything else, the virtual-time range
and the Type, Trace, Event, Entity kind, and Entity id fields, is in the **More
filters…** dialog. A trace is also reachable from the selected observation with
**Show this trace**.

A quick view is applied before the advanced fields, so the two compose by
intersection: the timeline shows records kept by the quick view that also match
every active canonical filter. The result count, the selected position, and the
empty-state explanation stay next to the rows they describe, and each quick
view states how many observations it shows out of the recorded total.

The canonical fields, their match modes, and their suggestions keep their
semantics inside **More filters…**, a modal dialog. It edits a copy of the
active filters: **Apply** applies the copy as one change, **Clear** empties the
dialog's fields, and Escape or **Cancel** discards every edit made since it
opened. A draft that does not parse, such as a reversed virtual-time range,
stays in the dialog with its error and changes nothing. Active quick views and
active fields appear as removable chips only while one is active, chips only
remove, and **Clear all filters** removes both. An empty result names the active quick view and the active fields and
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

**Show** and **Component** are native selects with visible labels; each Show
option names its quick view and the count of records it keeps, and a
screen-reader description says that quick views narrow the display rather than
the run. The summary line is plain text, so the shown-of-recorded counts are
available without opening the select. **More filters…** opens a modal dialog
(`aria-modal="true"`, named "More filters"); focus moves to its first field and
returns to the trigger when it closes. The fields keep their own combobox and
select semantics, and Escape first closes an open suggestion list or hint
before it closes the dialog. The row-order and matching-rules explanations are
hint pills rather than permanent paragraphs.

Panel space is bounded rather than allowed to overflow. The toolbar is two
short rows, the view switch and the filter row, with no disclosure. The chip row
appears only while a filter is active and scrolls on its own once several are
active, and the rows keep a minimum height. Observation detail is docked as the
panel's right column in every view (#146), so it never covers the rows, the
toolbar, or the tabs; with nothing selected it reads "Select an observation to
see its detail." While a filter is active, one count beside the filter row says
how many milestones are shown out of the run's milestones ("4 of 22 milestones
shown").

The selection is stated once on screen, in the detail header: "Observation
#‹sequence› · ‹label› · t=‹time›", then source → target. Recorded history has
one polite live region, read and not shown, that announces each selection
("Selected Observation #114: …"), filter changes, and quick views.

None of the presentations modifies history, exports, virtual time, scheduling,
randomness, or causal data. The labels and milestones state only what is
stored. They do not infer elapsed time or causal links.
