# RFC 0001: Make DistLab ready for a microservices design module

| Field | Value |
| --- | --- |
| Status | Proposed. Nothing here is decided. |
| Date | 2026-11-09 |
| Evidence | [Student evaluation, ITBA 73.40](../evaluations/2026-11-itba-73-40/README.md) |
| Related issues | #97, #103, #104, #112, #124, #136, #147, #163, #164, #165, #166 |
| Decides | Positioning, and the order of the next work. It changes no contract. |

## Summary

The evaluation found that DistLab is worth continuing: it fits the design
module of a real course and the format of its weekly practice guides. It also
found that the tool is not ready for students. One defect teaches something
false, the interface costs more effort than the concepts, and the student has
too little to decide.

This RFC proposes a position and an order of work. It asks the maintainer for
five decisions, listed at the end.

## Position

**DistLab is the lab for the design module of a microservices course.** It is
where a student tests a design decision against failure before building it with
real tools. It does not teach containers, Kubernetes, CI/CD, or a cloud
provider, and it should say so on its first screen.

Consequences of taking this position:

- Success is measured against two learning objectives: *select the adequate
  pattern for a problem*, and *choose between synchronous and asynchronous
  interaction*. Catalog breadth is not a goal by itself.
- The unit of use is a **practice guide**: a base situation, a change the
  student makes, and a conclusion the student writes. Features that serve that
  unit come first.
- The non-goals of vision §23 stay as they are.

## Proposals

Each proposal names its cost and what it touches. They are ordered by the
sequence in [Order of work](#order-of-work), not by size.

### P1. Verdicts a student can trust

Problem: evaluation F1, tracked in #163. Every packaged assertion is `mode: "at"` with a time
that fits the packaged story. A design choice or a student fault can move the
violation past that time, and the panel then reads HOLDS.

Proposal, in two steps:

1. **Guard, now.** When a business invariant was checked before the run's last
   state change, the panel does not say HOLDS without qualification. It says
   when the check ran and that the run continued. This is presentation over
   stored records.
2. **Restate safety invariants.** "Charges the order once" and "stock is never
   negative" are safety properties: they must hold at every boundary. The
   Scenario Engine already has `mode: "always"`. The predicates need an "at
   most" form, because `commerce.rows` asserts an exact count that is false
   before the first commit. #124 asks for the same kind of bound on
   `commerce.metrics`. Properties that must *become* true ("a failed order is
   cancelled") stay bounded and keep their stated time.

Touches: catalog predicates and lesson documents. Packaged lesson exports and
digests change, intentionally. No new assertion mode is needed, so no ADR. If a
"final boundary" mode turns out to be necessary, that is an ADR.

### P2. One timeline

Problem: evaluation F5 and F6. Run completes at once and nothing moves; Replay
is a second control group; Step advances a scheduler event.

Proposal:

- After Run completes, replay starts from the first movement by default. The
  student presses one button and sees the story.
- The student-facing Step advances to the next recorded movement or milestone,
  and the graph shows it. Stepping one scheduler event moves to an advanced
  control.
- Replay gets a scrubber over virtual time with fault and timeout marks, and
  concurrent movements at the same virtual time are drawn together.

Touches: presentation only for the first and third points, within the rule that
a host timer may move a cursor and must not advance virtual time. The second
point needs a decision: the host can repeat the existing `step` command until a
milestone record is published, or the worker can gain a way to do it. The first
keeps the protocol unchanged.

### P3. Problem first, then prediction, then the takeaway

Problem: evaluation F8, F9, and "pattern as a checkbox". The chooser names the
pattern and the result. The app never states the concept; the excellent
"Concept" paragraphs and sequence diagrams live only in
`docs/commerce-lessons.md`.

Proposal, all as data-only lesson presentation:

- Chooser cards state the problem ("A payment response is lost"), grouped under
  a heading, in a suggested order.
- ① Goal asks a prediction before Run ("How many payments will exist at the
  end?"). The answer is not stored or graded.
- After the run, ③ Investigate shows the takeaway, a short description of what
  the pattern's handler does in steps, what the pattern costs, and one line on
  where the idea appears in real systems.
- Lesson copy follows the applied experiment instead of contradicting it.

Touches: catalogs' data-only descriptors and the Lesson panel. It overlaps the
copy pass in #103 and should be planned with it.

### P4. A comparison that compares

Problem: evaluation F10. Compare replaces the session.

Proposal: when a paired run completes, the panel shows the previous run's
checks and final service state beside the new ones, with the differences
marked. The main thread already holds the projections of the run it is about to
replace; it keeps a summary as UI state.

Touches: presentation only. `docs/commerce-lessons.md` currently states that
Compare retains no side-by-side result, so this reverses a documented choice.

### P5. Lessons the course needs and the catalog lacks

In order of value for the design module:

1. **Monolith baseline.** The same checkout with one service and one local
   transaction, then split in two. It shows what splitting costs, which is the
   first topic of the course.
2. **Choreographed saga**, paired with the orchestrated one over the same
   workload: who knows the state of the workflow, and what each failure leaves
   behind.
3. **Synchronous or asynchronous**, one workflow both ways: latency and coupling
   against eventual consistency.
4. **Compensation that fails**, extending the saga family with a retryable,
   idempotent compensation.
5. **Composition at a gateway**: a read assembled from two services when one is
   slow.

Replicas, load balancing, and service discovery need more than one instance of
a component. That changes component identity in the kernel and needs an ADR. It
is not proposed now.

### P6. Choose the pattern

Problem: objective 3 asks the student to select a pattern, and no lesson asks
for a selection. The Design editor (#112) answers this fully, and it is large.

Proposal, as a cheaper first step: a lesson stated as a problem, with every
relevant design choice off and three or four choices offered, where only some
combinations keep all invariants. The outbox and notifications families already
have two independent choices each. This uses the existing overlay and needs no
editor.

### P7. Fit the practice guide

- **Links.** A URL that opens a lesson with an overlay, so a guide can say
  "open this". The worker still validates the overlay; the link carries no
  document.
- **Something to hand in.** The run identity and a short result summary the
  student can paste into an answer, so a teacher can reproduce the run.
- **Seeds.** Let the student change the seed, and run a design against several
  seeds with a summary. This gives probability faults a meaning and prepares
  #97.
- **More to tune.** Breaker threshold and cooldown, retry count and backoff.
- **Spanish.** Later, and only if a pilot shows that language is a barrier.

## Order of work

1. **Before any student sees it.** P1 step 1 and step 2 (#163); remove or mark
   the design lesson that cannot be completed (F2, #164); make Show evidence
   show the evidence (F3, #165); keep the graph legible at 1366×768 with panels
   open (F4, #166).
2. **Pilot.** Three to five students of the course, one guide, two lessons,
   three written questions before and after. The pilot decides whether the
   order below is right.
3. **The experience.** P2, P3, P4.
4. **The course.** P5 items 1 to 3, P6, and the links of P7.
5. **Later.** The rest of P5 and P7, the Design editor (#112), replicas.

## What not to do now

- Do not model products or infrastructure to get closer to the rest of the
  course.
- Do not add lessons outside P5 before the experience work. The evaluation
  found the interface, not the number of lessons, to be the limit today.
- Do not add another Recorded history view. Four exist, and the default one
  needs to become a sequence diagram (evaluation F7).

## Alternatives considered

- **Cover the whole course.** Rejected: it contradicts vision §23, and real
  tools already teach containers and Kubernetes well.
- **Stay a kernel and CLI for instructors.** The headless runner is solid, and a
  teacher could use it for demonstrations. It gives up the student, who is the
  reason for the project.
- **Build the Design editor first.** It is the largest item and depends on
  verdicts being trustworthy. P6 tests the same learning goal at a fraction of
  the cost.

## Decisions requested

1. Is the position accepted: the lab for the design module, a complement and
   not a replacement?
2. Are the four items in step 1 release blockers?
3. P2: may the host repeat `step` until a milestone, or must stepping to a
   milestone be a worker capability?
4. P4: may the main thread keep a summary of the previous run for comparison?
5. Is a pilot with real students the gate before the work in step 3?

## ADR impact

None now. ADR candidates if the proposals are accepted: a final-boundary
assertion mode (P1, only if `always` with bounds is not enough), a worker-side
step-to-milestone (P2, only if decision 3 goes that way), and component
replicas (deferred).
