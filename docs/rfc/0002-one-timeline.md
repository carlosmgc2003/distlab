# RFC 0002: One timeline — a run the student can watch

| Field | Value |
| --- | --- |
| Status | Proposed. The direction is set (see [Decisions already taken](#decisions-already-taken)); the details are not decided. |
| Date | 2026-11-11 |
| Evidence | [Student evaluation, ITBA 73.40](../evaluations/2026-11-itba-73-40/README.md), F5 and F6; measurements in [Problem](#problem) |
| Refines | [RFC 0001](0001-course-ready-design-module.md), P2 "One timeline". It answers that RFC's decision 3. |
| Related issues | #136, #103, #189, #190, #191, #192, #193 |
| Decides | How a student runs and watches a lesson. It changes no contract and no worker command. |
| Amended | 2026-11-13, [Amendment 1: time to read](#amendment-1-time-to-read). It changes P3, adds P8 and P9, and adds decisions 8 to 10. Not yet reviewed. |

## Summary

Today a student meets two control groups. **Simulation execution** (`Run`,
`Pause`, `Step`, `Reset`) executes the run and shows almost nothing. **Replay**
(`Play replay`, `Previous movement`, `Next movement`, **Speed**) shows the
animation, one click after the run is already `COMPLETED`. A third position,
the selected row in Recorded history, is unrelated to both.

This RFC proposes one control group and one position. The student presses
`Run` and watches the run on the graph. `Step` and `Back` move through it one
teaching milestone at a time. An **Animation** toggle decides whether `Run` is
shown as an animation or executes without one and shows the result. Replay, as
a separate concept, goes away.

## Decisions already taken

The maintainer set these on 2026-11-11. The rest of this RFC follows from them.

1. **No run on load.** Loading a lesson leaves it `READY`. The student decides
   when to run.
2. **One position, not three.** There is no separate replay cursor and review
   position. Executing the simulation and showing the animation are one action
   for the student.
3. **An Animation toggle.** It chooses between a run that is animated and a run
   that executes without animation.

## Problem

Measured on `main` at `bb3f96f`, development build, Chromium at 1440×900. Each
lesson was stepped from start to end, then reset and run.

| Lesson | `Step` clicks to finish | Clicks with no new movement on the graph | Clicks before the first movement | `Run` duration | Graph updates during `Run` |
| --- | --- | --- | --- | --- | --- |
| `response-lost` | 25 | 14 | 5 | 169 ms | 2 |
| `retry-unsafe` | 13 | 5 | 3 | 77 ms | 1 |
| `saga-compensated` | 38 | 19 | 7 | 115 ms | 3 |
| `outbox-idempotent` | 36 | 25 (12 in a row) | 5 | 216 ms | 3 |
| `cascade-unprotected` | 261 | 40 | 7 | 1.6 s | 17 |

What the student sees:

- **`Run` tells no story.** It ends in about 0.1 to 0.2 seconds. The graph
  highlights the newest link of each published projection, so one to three
  unrelated links flash, and the last one stays highlighted with no token and
  no narration.
- **`Step` is in the wrong unit.** It processes one scheduler event. About half
  the clicks change only a counter in the top bar. When a movement is recorded,
  `Step` highlights its link and nothing else. After a whole run is stepped,
  the Replay readout still says "0 of 13 recorded movements. Nothing selected."
- **`Pause` cannot be used.** Nobody can click it within 200 ms.
- **The story is only in Replay**, a second toolbar with its own play and pause.

The cause is three positions that do not know about each other:

| Position | Moved by | Read by |
| --- | --- | --- |
| Simulation boundary (worker) | `Run`, `Pause`, `Step`, `Reset` | Top-bar counters, Service state, checks, the lesson step marker |
| Playback cursor (`flight-playback.ts`) | `Play replay`, `Previous movement`, `Next movement` | Token, narration, component activity |
| Review position (`review-navigation.ts`) | Selecting a row in Recorded history | Observation detail, graph highlight |

Effects on screen:

- The top bar says virtual time 1030 while the Replay readout says virtual
  time 25.
- Component activity shows the cursor's moment. Service state and the checks
  show the end of the run.
- Selecting a row in Recorded history resets Replay to "Nothing selected".
- The same record is drawn two ways: a highlight when it is recorded, a token
  with narration when it is replayed.

The separation is written down as a rule in `CONTEXT.md` ("Playback and review
deliberately share no seam") and in `docs/ui-visual-system.md` ("Simulation
commands and replay are two separate control groups in two regions"). It
protects a real guarantee: a host timer must never advance virtual time. The
mistake was to make the student learn that guarantee.

## Proposal

### P1. One position: the playhead

The shell keeps one position, the **playhead**: one recorded observation of the
current run, or "before the first record". It replaces the playback cursor and
the review position. Every region reads it.

The worker's own boundary still exists, because the worker executes at engine
speed. The student never sees it as a second position:

- The first `Run` or `Step` after a load or a reset sends `run` once. The worker
  executes the whole run, as it does today.
- From then on the controls move the playhead over the recorded history. They
  send nothing to the worker.

So the student decides when the run executes, and what they watch is that run.

### P2. One control group

**Simulation execution** stays in the top bar. The **Replay** toolbar is
removed from the Architecture tab.

| Control | Before the first `Run` or `Step` | Playing | Paused | At the end |
| --- | --- | --- | --- | --- |
| `Run` | Execute the run, then play from the first milestone | Unavailable; `Pause` is the control | Continue from the playhead | Unavailable; `Reset` starts again |
| `Pause` | Unavailable | Stop the playhead | Unavailable | Unavailable |
| `Step` | Execute the run, then move to the first milestone | Stop, then move one milestone forward | Move one milestone forward | Unavailable |
| `Back` | Unavailable | Stop, then move one milestone back | Move one milestone back | Move one milestone back |
| `Reset` | Reconstruct the loaded scenario | Reconstruct it; the playhead returns to the start | The same | The same |

`Reset` keeps its meaning and still sends `reset`, so it still replays the
applied overlay.

The run summary in the top bar states the playhead: its milestone number, the
milestone count, and the virtual time of the record under it. The processed and
pending event counts move to **Advanced diagnostics**, beside the other engine
counters. No region shows a second virtual time.

### P3. The Animation toggle

One toggle, **Animation**, next to **Speed**. It is UI state and survives
lesson loads.

- **On** (the default): `Run` plays the run. The playhead advances one
  milestone at a time at the chosen speed, and the graph paints each one.
  Amendment 1 proposes that it also stops at each key moment (P8).
- **Off**: `Run` executes and places the playhead at the end. The graph shows
  the end state and the outcome appears at once. **Speed** is unavailable.

`Step` and `Back` work the same in both settings: each shows one milestone.
`prefers-reduced-motion: reduce` keeps its present rule. Token travel is
removed and the token rests where the record says the movement stopped.

### P4. A step is a teaching milestone

`Step` and `Back` move to the next or previous **milestone**: the set that
`docs/learning-timeline.md` defines for the Story view. One click is one thing
a student can name.

Today Replay shows only records that travel a link. In `response-lost` that is
13 movements out of 22 milestones. The 9 it skips include the processor's
authorization, the commits, and the fault. They are the point of the lesson.
A milestone that travels no link is painted on its component: a badge with the
milestone's stored label, and the same narration as a movement.

Stepping one scheduler event leaves the student interface. The `step` and
`pause` commands stay in the protocol, and `npm run lesson -- <name> --step`
keeps stepping events from the command line.

### P5. Every region reads the playhead

- **Architecture graph.** Token, narration, roles, and component activity are
  those of the record under the playhead, as Replay paints them today. The live
  cue that flashes while a run records is removed.
- **Recorded history.** The selected row is the playhead. Selecting a row, a
  related-observation link, or an evidence link moves the playhead to that
  record, and the graph shows that moment. Records after the playhead are
  styled as not reached yet. Filters and views keep their behavior.
- **③ Investigate.** The outcome is revealed, and announced once, when the
  playhead first reaches the end of the run. With **Animation** off that is
  immediately. Moving back afterwards does not hide it again.
- **Lesson step marker.** ② Run is current until the playhead leaves the
  start; ③ Investigate is current once it has reached the end.

### P6. State at the playhead

Service state and the Component inspector facts come from the worker's final
projection, so they describe the end of the run. With the playhead on an
earlier record that is a contradiction.

First step, presentation only: when the playhead is not at the end, these
regions say that they show the end of the run, and at which virtual time.

A real answer needs a decision, because no projection holds earlier component
state. Three options:

| Option | How | Cost |
| --- | --- | --- |
| A. Read it from records | Rebuild rows and outcomes from stored commit records | No contract change. Limited to what records store, and close to the inference the non-inference rules forbid |
| B. A second session | The host loads the same document and overlay in a second worker and runs it with `run { maxEvents }` to the boundary of the record under the playhead | No protocol change, and exact because runs are deterministic. Needs a stated way to map a record to an event boundary; costs one re-run per position |
| C. Worker frames | The worker publishes component state per event boundary | Exact and immediate. A new projection field, so an ADR |

Recommendation: B, on demand, when the student opens Service state or selects a
component with the playhead before the end.

### P7. Long runs

Later, and only after P1 to P5. `cascade-unprotected` has 269 movements, which
is 7.5 minutes at **Slow** (evaluation F6).

- A scrubber over the milestones, with marks for faults, timeouts, and failed
  checks, and "next fault" and "next failed check" jumps.
- Milestones recorded at the same virtual time are painted together, so sixteen
  requests piling up on one service look like a pile.

## Amendment 1: time to read

Added on 2026-11-13, after the maintainer reported that a replayed step does not
stay long enough to be read. P8 and P9 are proposed and not decided. They are
stated in the terms of this RFC, so they apply to the playhead of P1.

### The problem P1 to P7 leave open

P3 advances the playhead "at the chosen speed". A fixed interval cannot be
right, measured on `retry-unsafe` in Spanish:

- **Slow** paints one movement every 1.8 seconds (`FLIGHT_PACES` in
  `flight.ts`).
- The narration of one movement was about 85 visible words. At 200 words per
  minute that is about 25 seconds of reading.
- Evaluation F6 found the same interval too slow: `cascade-unprotected` takes
  7.5 minutes at **Slow**.

One speed is too fast to read and too slow to watch. No value between them
fixes both, because watching a run and reading one step are different
activities. P4 makes the count larger: it replaces 269 movements with 523
milestones in `cascade-unprotected`.

The narration is also generic. **What to look for** is one question per stored
record type, so it is the same in every lesson. It cannot say what this lesson
wants the student to notice at this record.

### Built with this amendment

These three changes are presentation over the present Replay. They do not
depend on P1 to P7, and they carry over to the playhead unchanged.

- **The narration has three levels.** The stored label and the route, then
  **What to look for**, then **Recorded details**, which is folded and holds
  every other line. A movement now shows about 25 words. See "Architecture
  playback and message flight" in `docs/ui-visual-system.md`.
- **The graph has a background.** A component that is no end of the painted
  movement and has no recorded work or wait is drawn fainter, with its store
  and links.
- **Replay answers to the keyboard.** Left and Right step one movement, and
  Space plays or pauses.
- **Hops in transit stay on the graph.** Replay stands on one record, so of two
  requests sent at the same virtual time only one was drawn, and the other
  seemed to vanish. A hop that left before the cursor's movement and has no
  arrival or drop recorded keeps a resting token on its link, with a count when
  several wait, and the narration names it. This is a first part of P7's
  "painted together": the pile on a link is visible as a count. Milestones are
  still stepped one at a time.

With P2, the keys follow the one control group: Left is `Back`, Right is
`Step`, and Space is `Run` or `Pause`.

### P8. Play stops at key moments

While `Run` plays, the playhead stops by itself at a **key moment** and waits.
`Run` then reads `Continue`, and Space continues. Between two key moments the
routine milestones advance at the chosen speed, as P3 says. `Step` and `Back`
do not change: they move one milestone and never play.

A key moment is a milestone where the outcome of the run is decided. It is a
pure function of the stored record, like the milestone set itself:

| Key moment | Milestone kinds |
| --- | --- |
| Something did not arrive | `drop`, `timeout`, `failure` |
| Something is tried again | `retry` |
| State changed | `commit`, `rollback`, `external` |
| A fault acted | `fault`, once per applied effect: the rule match, the selected effect, and the drop or delay it causes are one stop |
| A check changed its result | `check`, for a change of result. The first evaluation of a check is not a stop |

Requests, responses, messages, key-value reads, and logs are routine.

Raw counts in the packaged lessons, before the fault records of one effect are
merged and before first evaluations of checks are removed, so each is an upper
bound:

| Lesson | Movements today | Milestones (P4) | Key moments, at most |
| --- | --- | --- | --- |
| `retry-unsafe` | 9 | 19 | 8 |
| `saga-compensated` | 23 | 46 | 17 |
| `cache-stale-price` | 36 | 65 | 9 |
| `cascade-breaker` | 215 | 419 | 17 |
| `cascade-unprotected` | 269 | 523 | 59 |

So a short lesson is close to step by step, which is what a first reading
needs, and a long lesson plays its routine traffic and stops where it matters.
One definition serves three places: the stops of P8, and the scrubber marks and
"next" jumps of P7.

A toggle, **Stop at key moments**, sits beside **Animation** and is on by
default. Off gives the continuous play of P3. It is UI state.

Rejected: a longer **Slow**, or an interval computed from the length of the
text. Reading speed differs between students and between languages, and a
student also looks at the graph. Any timer is wrong for someone, and it makes
F6 worse.

### P9. Lesson notes at key moments

A lesson may attach a **lesson note** to a record of its packaged run: one
sentence, shown at level 2 of the narration above the generic question, under
the heading **In this lesson**. Example, on the second commit of
`retry-unsafe`: "Payments now stores `payment-2` for the same `order-1`.
Compare it with the first commit."

A note is authored teaching content, like the goal or a check label. It is not
a reading of the record, so it is marked as the lesson's voice and kept apart
from stored facts. The pattern question stays and keeps its rule: it never
states an outcome.

- **Anchor.** A note names its record by stored type, source component, and
  occurrence, for example the second `database.transaction.committed` from
  `payments`. It never names an observation ID or a sequence number, which
  change with the configuration.
- **Where it lives.** The anchor is data in the catalog module, beside the
  lesson's document. The sentence is in `apps/web/src/i18n/*/lessons.ts`. Adding
  or changing a note raises the lesson revision.
- **Proof.** A catalog test runs each packaged lesson and requires every anchor
  to match exactly one record. `lesson-sheet.ts` prints each note beside its
  record, and the `lesson-authoring` skill gains a section on writing them.
- **A stop.** A record with a lesson note is a key moment for P8.

The open question is the session overlay. With a design choice or a fault
applied, the run differs, and a note written for the packaged run can be false:
with idempotency on there is no second commit, and an anchor can then match a
record that means something else.

| Option | Rule | Cost |
| --- | --- | --- |
| A. Packaged run only | Notes are shown while no overlay is applied | The catalog test proves every note. A student who experiments has no notes, and has already read them on the packaged run |
| B. Pointers only | Notes are shown whenever the anchor matches, and must point ("look at the payments table") and never claim | Nothing proves a pointer still points at the right thing in a changed run |
| C. Conditions | A note carries a condition on stored fields | A small rule language to specify, test, and teach to authors |

Recommendation: A, with the wording rule of B as style guidance.

### Order of work, amended

P8 follows P4, because a commit and a check are not steps until then. P9 is
independent of P1 to P7 and can be built on the present Replay, where a note on
a record that travels no link waits for P4 to be shown.

## How the guarantees hold

- The worker executes the run exactly as today. No command is added or changed.
- The host timer moves the playhead and paints. It does not advance virtual
  time, record an observation, or send a worker command. The rule in
  `AGENTS.md` and `docs/spec/application-boundary.md` is unchanged.
- The playhead, the Animation toggle, and the speed are UI state. They are in
  no projection and no history.
- Narration and activity still read only stored fields of records at or before
  the playhead.
- Golden digests and packaged lesson exports do not change.

## What changes

Stated guarantees that this RFC reverses or rewrites, if accepted:

- `CONTEXT.md`: "Presentation playback" and "Review navigation" become one
  term, and the rule that they share no seam is removed. "Playhead" is a
  proposed name; `CONTEXT.md` decides it.
- `docs/ui-visual-system.md`: the rule about two control groups in two regions,
  the Replay vocabulary row, the run summary rule, and the "Architecture
  playback and message flight" section.
- `docs/spec/application-boundary.md`: the shell action matrix rows for `Run`,
  `Pause`, `Step`, `Play / Restart`, `Pause replay`, and `Previous / Next`.
- `docs/learning-timeline.md`: the non-inference bullet about playback.
- `AGENTS.md`: the paragraphs on architecture playback and review navigation.

Code, all in `apps/web/src/`: `SimulationControls.tsx`,
`ArchitecturePlayback.tsx`, `flight-playback.ts`, `flight.ts`,
`review-navigation.ts`, `TimelineView.tsx`, `ArchitectureView.tsx`,
`lesson-steps.ts`, and the shell in `App.tsx`. The worker, the host client, the
protocol, the kernel, and the catalogs are not touched.

Tests: the browser specs for controls, the top bar, architecture flight,
timeline navigation, and the workspace, and the unit tests for flight and
review navigation, are rewritten against the new behavior.

## Defects found on the way

These are independent of the proposal and can be fixed first. Items 1, 2, and 5
are errors. Items 3 and 4 are the behavior `docs/spec/application-boundary.md`
specifies today, so their issues ask for a change to that specification.

1. **A highlight survives `Reset`** (#189). At virtual time 0 with no history,
   the graph still highlights the last link of the previous run. `App.tsx`
   clears the emphasis only when the projection is null, and `Reset` keeps the
   projection.
2. **The destination is off the canvas** (#190). At 1440×900, with the
   narration column open, Payment Processor is fully outside the canvas while a
   request to it is painted.
3. **`Previous movement` wraps** (#191). With nothing selected it jumps to the
   last movement.
4. **`Play replay` is unavailable with exactly one movement** (#192), while
   `Previous movement` and `Next movement` are available.
5. **The status contradicts itself** for a moment (#193): "COMPLETED · Run in
   progress…".

P1 to P5 remove 3, 4, and the live cue behind 1. If this RFC is accepted, #191
and #192 are closed as superseded. Items 2 and 5 remain either way.

## Order of work

1. Defects 1, 2, and 5 (#189, #190, #193).
2. P1 to P4 together: one position, one control group, the Animation toggle,
   milestone steps. This is the smallest change that removes the two
   timelines, and it cannot be split without leaving a mixed interface.
3. P5: Recorded history and ③ Investigate read the playhead.
4. P6, first step. Then the decision on A, B, or C.
5. P7.

## Alternatives considered

- **Run on load.** Rejected by the maintainer: the student decides when to run.
- **Pace the real simulation.** A host timer would send `step` at the chosen
  speed, so the worker's boundary would be the one position. Rejected: it
  breaks the rule that a host timer sends no worker command, and the kernel
  cannot go back, so `Back` would need a second position again.
- **Keep both groups and auto-start Replay after `Run`** (RFC 0001 P2). It
  removes one click and keeps two vocabularies, two virtual times, and three
  positions.
- **`Step` repeats the worker's `step` until a milestone is recorded** (RFC
  0001 decision 3). Not needed: with P1 the student's `Step` moves the
  playhead and sends nothing.

## Decisions requested

1. Is the first `Run` or `Step` allowed to execute the whole run in the worker,
   with the controls then moving the playhead? P1 depends on it.
2. Does event-by-event stepping leave the browser, or stay behind **Advanced
   diagnostics** for instructors?
3. Do the processed and pending event counts move out of the top bar?
4. P5: is the outcome withheld until the playhead reaches the end, or shown as
   soon as the worker finishes?
5. P6: option A, B, or C for state at the playhead?
6. Does a long run need a student control that stops the worker? The longest
   packaged run takes 1.6 seconds. An imported document is bounded by
   `ScenarioDocumentLimits`, not by time.
7. Is "playhead" the name?
8. P8: does `Run` stop at key moments by default, and is the set in P8 the
   right one?
9. P9: are lesson notes accepted as authored content beside the narration?
10. P9: option A, B, or C for notes under a session overlay? And do notes stay
    in the catalog, or may an instructor's scenario document carry them?

## ADR impact

None for P1 to P5, P7, and P8: they are presentation over published records.
P9 needs none while notes stay in the catalog. Notes in a scenario document
would amend ADR-006. P6
option C adds a projection field and needs an ADR. P6 option B needs the
mapping from a record to an event boundary stated in a specification before it
is built.
