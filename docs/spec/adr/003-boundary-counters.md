# ADR-003: Read-only simulation counters

## Context

The browser's initial checkout-only adapter reconstructs queue counts from visible
history and assumes zero random draws. Commerce scenarios require an explicit
read port; history can be filtered, redacted, or incomplete.

## Decision

Expose `pendingEvents`, `processedEvents`, and `randomDrawCount` as read-only
properties on `Simulation`. Pending events come from scheduler size (excluding
cancelled work). Processed events count successfully dequeued events, including a
handler that fails; successful random draws count all uses of the simulation's
seeded random port. Reset clears the latter two counters and rebuilds the queue.
Reads do not schedule work, draw randomness, or record observations. Hosts sample
only at event boundaries. Existing `RunResult.totalEvents` semantics are unchanged.

## Consequences

The browser no longer infers engine state from history. This adds no scheduling,
randomness, or execution-history semantics and preserves existing golden digests.
The worker still accepts only exact packaged documents; broader arbitrary scenario
loading and visibility policy authorization remain outside this change.
