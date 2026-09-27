# Learning Timeline

The timeline has three read-only views over the same canonical execution
history. Story is the initial teaching view; Learning and Raw keep every
record.

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
