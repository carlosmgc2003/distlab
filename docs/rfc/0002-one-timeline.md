# RFC 0002: One timeline — a run the student can watch

| Field | Value |
| --- | --- |
| Status | Proposed. The direction is set (see [Decisions already taken](#decisions-already-taken)); the details are not decided. |
| Date | 2026-11-11 |
| Evidence | [Student evaluation, ITBA 73.40](../evaluations/2026-11-itba-73-40/README.md), F5 and F6; measurements in [Problem](#problem) |
| Refines | [RFC 0001](0001-course-ready-design-module.md), P2 "One timeline". It answers that RFC's decision 3. |
| Related issues | #136, #103, #189, #190, #191, #192, #193 |
| Decides | How a student runs and watches a lesson. It changes no contract and no worker command. |

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

## ADR impact

None for P1 to P5 and P7: they are presentation over published records. P6
option C adds a projection field and needs an ADR. P6 option B needs the
mapping from a record to an event boundary stated in a specification before it
is built.
