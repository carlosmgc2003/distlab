# Learning Timeline

The timeline has two read-only views over the same canonical execution history.

## Learning view

Learning view is the default. It gives stored observation types short labels and collapses only adjacent implementation bookkeeping:

- contiguous startup `scheduler.*` and `clock.*` records before the first simulation event form an engine queue-setup group; later scheduling records stay visible;
- adjacent `scenario.assertion.evaluated` records form a group only when their stored data is unchanged.

A group shows its member count and inclusive original sequence and virtual-time bounds. Opening it exposes each original ID, sequence, virtual time, and type in canonical order. Selecting a member through evidence also opens its group. No business delivery, retry, external side effect, commit, rollback, fault, or changed assertion is collapsed. In particular, delivery attempts stay as distinct observations.

## Raw view

Raw view shows every filtered canonical observation in sequence order. Both views use the same filters and selection; neither modifies history, exports, virtual time, scheduling, randomness, or causal data.

The labels and groups state only what is stored. They do not infer elapsed time or causal links.
