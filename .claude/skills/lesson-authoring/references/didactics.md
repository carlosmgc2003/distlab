# What makes a lesson teach

The criteria behind a review and a design, with the reasons. They come from the
project's own sources: `docs/vision.md` (§11 learning goals, §18 patterns, §20
invariants, §22 principles), [RFC 0001](../../../../docs/rfc/0001-course-ready-design-module.md),
and the [student evaluation](../../../../docs/evaluations/2026-11-itba-73-40/README.md).
When this file and those disagree, they win.

Contents: [The learner](#the-learner) · [The story](#the-story) ·
[The checks](#the-checks) · [The system and its timeline](#the-system-and-its-timeline) ·
[Design choices and faults](#design-choices-and-faults) ·
[The words](#the-words) · [Spanish](#spanish) ·
[Review questions](#review-questions)

## The learner

A student of a microservices or distributed-systems course, using the tool for
a practice guide: a base situation, a change they make, a conclusion they
write. They know what a service and a database are. They have probably never
watched a response get lost. They read the lesson card, press Run, and look at
what broke.

Two objectives define success: *choose the adequate pattern for a problem*, and
*choose between synchronous and asynchronous interaction*. A lesson that lets
the student flip a named switch and watch a light turn green serves neither. A
lesson that makes them predict, see both sides of a failure, and then find a
case the lesson did not describe serves both.

What the evaluation found students actually learned from:

- seeing **both sides** of a lost response as rows, the two payments beside a
  client that believes it paid once;
- **their own experiment** exposing a case no lesson describes;
- **breaking the fix** and discovering that a compensation is a request too;
- a business invariant that says **what the business lost**, not which test
  failed.

Design for those four moments.

## The story

**Problem before pattern.** Vision §18: "The problem should appear before the
solution pattern." The failing lesson's title and description should put the
student in a situation and leave a question open. The evaluation's finding F9
is that the chooser "gives the answer away": titles name the pattern and
descriptions state the result.

| Gives it away | Sets up the question |
| --- | --- |
| "Retry without idempotency. … Expect two payments after retry." | "A payment response is lost and the client retries. How many times is the order charged?" |
| "Saga: no compensation" | "The shipment fails after the payment was approved. What state is each service left in?" |

The fixed lesson can name the pattern: by then the student has the problem it
answers. Rewording a title is a judgment call for the maintainer, so in a
review propose the new wording and keep the old one until it is agreed.

**One question per lesson.** If the description needs "and also", the lesson is
two lessons, or the second idea is a design choice. The cache pair carries a
second story (the cart TTL) on purpose, as a contrast: a TTL that is wrong for
a price is right for a cart. That is the bar for a second thread, and it is
stated in the lesson's Concept paragraph.

**One difference per pair.** The lesson sheet prints the document difference
between a lesson and its Compare partner. For a fair comparison it is one
configuration field, or the fields of one design decision. Same seed, same
workload, same packaged faults. `commerce.test.ts` pins this; a review should
still read the difference, because "one field" can hide a different story.

**A failure that needs no magic.** The strongest lessons fail through ordinary
behavior: two requests at the same time (`inventory-*`), a price change during
a cache lifetime (`cache-*`), a skewed clock that is plain configuration
(`clock-*`). Use a packaged fault when the idea *is* a failure of the
environment (a lost response, a crash, a slow provider), and then make it the
least fault that tells the story: one drop, one delay.

**A domain the student already holds.** The reference domain is commerce
(`order-1`, a payment, service-owned databases; vision §5 to §9), so each new
lesson costs no new vocabulary. Leave it only when commerce would distort the
idea, as the lease and clock lessons do with a report file and a document
title, and say so.

## The checks

**The finding is a business invariant.** A property the system must keep
*whatever its design*, in the words of the business:

| Mechanism (avoid) | Business property (use) |
| --- | --- |
| "The results table has one row for the key" | "A retried payment request charges the order once" |
| "The breaker opens after two failures" | "No more than 3 payment requests wait on the slow risk provider at once" |
| "The inbox deduplicates the event" | "An approved payment produces exactly one notification" |

The test for the wording: could a student satisfy it with a different design
than the lesson's fix? If the sentence names the fix, it is not an invariant.
This is what lets a student's own design choice read HOLDS honestly, and what
makes Compare show VIOLATED → HOLDS for one sentence.

Write it as a present-tense statement of what always holds, with no time and no
component jargon beyond the display names. Every lesson of the family carries
the identical assertion and label.

**Safety or deadline.** A property that *forbids* a state (a second charge,
negative stock, a stale write accepted) is a safety invariant: `mode:
"always"`, evaluated at every event boundary. A property that must be
*reached* (a failed order is cancelled, the read model converges) keeps `mode:
"at"` with the time by which the lesson's design must have done it. Getting
this wrong is the one defect the evaluation called a release blocker: an `at`
check on a safety property reads HOLDS when a student's timeout moves the
violation past the check time, and the tool then teaches something false. A
predicate used with `always` must hold before the first write, which is why
`commerce.rows` and `commerce.metrics` have `maximum` forms.

For a deadline invariant, state the deadline in the guide and make sure the
design choices cannot push the honest outcome past it: the overlay tests run
every domain edge to catch that.

**Expectations pin the story.** A scenario expectation confirms that the run
reproduced the setup: the moment of inconsistency, the fault taking effect, the
state just before the decisive event. It is past tense, names the packaged
values, and by the catalog's convention ends with its time: "Inventory was
reserved when the shipment failed (t=30)". (The headless runner and the guide
show the label alone; the browser also appends "(checked at t=30)".) Choose the
two or three moments without which this would be a different lesson. An expectation that restates an invariant, or that would
still pass in any run, pins nothing.

Expectations may differ within a pair (`durable-outbox` reads differently in
`dual-write`), and they may read "not reproduced" under a student's change.
That is correct and is explained in the interface.

**Evidence a student can read.** `Show evidence` displays what the predicate
returned as `evidence`. Return the rows that prove the verdict (both payment
rows of a double charge, each order with its charged and valid price), not a
boolean or an internal count.

**A lesson with nothing violated** (`cqrs-delayed`) teaches that a temporary
disagreement is correct behavior. That is a legitimate lesson, and then the
expectations carry the story (PAID against PENDING at t=10) and the invariant
is the convergence. It should still have something to try. When it has not,
recommend in this order, cheapest first: an experiment in the guide that uses a
student fault the policy already allows; a design choice that moves the story;
a partner lesson only when the idea needs a second design, and with RFC 0001's
order of work in mind.

**The label and the predicate say the same thing.** A check labelled "the read
model converges to the write model" must compare the two models, not test one
of them for the packaged value. Under a student's fault the two readings come
apart, and the verdict then contradicts its own sentence. Read each predicate's
parameters against its label.

## The system and its timeline

**Smallest topology.** Vision §22: "Every model should implement only what
supported scenarios require" and "Simple exercises should not require
understanding every available component." For each component ask what the
student would fail to see without it. `retry-*` is a client, a service, and a
database, and it is the lesson the evaluation praised most. Reuse component IDs
and their display names (`client`, `orders`, `payments`, `inventory`,
`notifications`) so the graph reads the same from lesson to lesson.

**A readable run.** Packaged lessons record 19 to 78 Story milestones; the
cascade pair records over 400 because sixteen requests cross four hops, and it
is the hardest to follow. Count the milestones on the sheet. When a story needs
volume to make its point (accumulated waiting), accept it and make sure the
metric that summarizes it is visible in Service state. Otherwise, cut workload
until the story is the run.

**Times that tell the order.** The student reads virtual times in the Story,
in check labels, and in the guide. Help them:

- Put the decisive moments on distinct times with the cause before the effect.
  The inventory pair gives the partner one extra millisecond of latency, so the
  two reads land at t=1 and t=2 and the two writes at t=6 and t=7. The race is
  real, and it is still readable.
- Open the window on purpose. The outbox service waits 10 ms between commit and
  publish so the crash at t=5 has somewhere to land; the consumer holds its
  acknowledgement 5 ms so the duplicate arrives while it is pending. A window
  the student cannot see is a coincidence, not a lesson.
- Keep numbers small and round where the model allows it, and timeouts clearly
  apart from latencies (1 ms links, 20 ms timeouts), so "it timed out" and "it
  was slow" cannot be confused.
- End the run soon after the last event that matters. A check at t=60 over a
  story that ended at t=23 adds idle time the student scrolls past.
- Deterministic does not mean arbitrary: say in the document's comment why each
  non-default number is what it is.

**Name the decisive moment.** A model's `ctx.log.write` becomes a Story
milestone ("Log: payment.previous-result", "Log: storage.fenced") and the
anchor the guide quotes. Log the decision the lesson is about, where it is
taken, with the fields that explain it (`lease.checked` carries `validUntil`,
`now`, and `valid`). Names are `<noun>.<event>`, lowercase, stable. Do not log
what a network or database record already states.

**Both sides inspectable.** Whatever disagreement the lesson is about must be
two visible facts: the client's stored outcome and the service's rows, the two
replicas' rows, the cache entry and the database row. Service state shows
committed rows, live key-value entries with their expiry, client outcomes, and
external services' declared visible state. A fact kept only in a handler's
local variable does not exist for the student. Row fields and status codes are
student-visible, so choose business words (`NEEDS_COMPENSATION`,
`CART_EXPIRED`).

## Design choices and faults

**The pair's switch is a design choice.** Setting it to the partner's value
gives the partner's architecture while the checks stay this lesson's. The hint
says what the switch changes and makes no claim about the outcome ("Payments
stores each result by idempotency key and returns it for a repeated key").
The outcome is the student's to find, and under another choice the claim may be
false: the evaluation's F8 is copy that contradicts the applied experiment.

**Give the student a second thing to turn.** One boolean is "a pattern as a
checkbox". A numeric choice that moves the story is worth more than its cost:
`timeout` in `retry-*` moves the second charge to t=42; `lease-ttl` at 40 keeps
the lease live so the second worker is refused; `clock-skew` at 0 makes
last-writer-wins look correct by luck. Each of those is a conversation in a
classroom.

Read the `--matrix` output as a teacher:

- every row identical: the choice changes nothing, so it should not be offered;
- only the packaged failure and the packaged fix differ: a checkbox;
- a mixed row (one invariant holds, another does not): the best material. The
  notifications pair's two choices are independent, and each decides different
  invariants. Describe such rows in the guide.
- "Setup reproduced: 1 of 3" under a choice is fine; a run that does not
  COMPLETE is not.

RFC 0001's P6 asks for lessons stated as a problem with several choices where
only some combinations keep every invariant. Prefer that shape when a family
has two independent decisions.

Domains: a boolean, an integer with inclusive bounds, or a choice of strings.
Bound an integer to values that all give a run worth reading. The matrix runs
only the edges and the default; `--sweep key` runs every value and shows where
the outcome changes. That threshold is the teaching value (a cached price that
lives 23 ms is gone before checkout reads it, one that lives 24 ms is not), so
name it in the guide with the reason. Include values on both sides of the
default even when one side only repeats the story: a student who cannot try
"longer" cannot find out that longer changes nothing. A parameter targets a component configuration field, a link policy
field, a destination field, or a client action's data, by stable identity.

**Student faults.** The policy offers only fault points the architecture has
and scheduled faults the models survive. A model that scripts its own crash and
restart cannot also take a student crash. Before offering a kind, run it: the
catalog tests run every offered kind to completion. Then use the guide to
suggest one experiment that breaks the fix, as the cache section does ("delay
Orders' price request … a checkout that saw a live cart can commit after the
cart expired"). Breaking the fix is where the next design question comes from.

## The words

What the student reads, and the job of each piece:

| Text | Job | Rules |
| --- | --- | --- |
| **Title** | Name the situation, within its family | `<Family>: <situation>`; short enough for the lesson trigger, which truncates |
| **Description** | The ① Goal and the chooser card: set the scene and the question | Two or three sentences. Concrete values (`order-1`, t=10) are good when they match the run. Describes the packaged run only, so do not promise an outcome a design choice can change without saying it is the packaged one |
| **Topic and concepts** | Place the lesson in a course and make it searchable | Concepts are terms a syllabus or textbook index would list; reuse existing ids; two to four per lesson |
| **Invariant label** | The property, in the business's words | Present tense, no time, no mechanism, identical across the family |
| **Expectation label** | What the setup reproduced | Past tense, packaged values, ends with `(t=N)` |
| **Design-choice label and hint** | What the switch is and what it changes | Label is the pattern or setting name; hint is one sentence with the component as subject; no outcome |
| **Component names** | Who is who on the graph | A role a student recognizes ("Shipping Carrier"), stable across lessons |
| **Guide section** (`docs/commerce-lessons.md`) | The instructor's and the curious student's full account | Pattern, Problem, Topology, Initial state, Injected fault, Expected timeline, Expected checks, Concept. The Concept paragraph states the idea in one or two sentences and then the limits: what the lesson does not model |

Style, from the existing copy: short declarative sentences; the component is
the subject and the verb is what it does; no "simply", no exclamation, no
second-person cheerleading. Exact over vague: "the order placed at t=25 is
charged the old price", not "pricing may be inconsistent". Do not explain the
simulator to the student ("the projection", "the worker session"): the
evaluation found that copy exact about the tool and unhelpful to the reader.

Every number in every text must be one the sheet prints. The sheet flags a
time named in the copy at which the run recorded nothing (often a fault bound,
sometimes a stale number). It cannot tell a time that is recorded but wrong for
the sentence, so read each one against the Story list: prefer the times of the
story's events to the times of its checks.

Name a component by its display name in that language
(`apps/web/src/i18n/<lang>/components.ts`), because that is what the graph, the
Story lanes, and Service state show. Much of the existing Spanish copy says
"Orders" where the Spanish screen says "Pedidos"; raise that once, as a
catalog-wide finding, rather than per lesson.

The in-app text for one lesson is the description, the check labels, and the
design-choice copy. The pattern explanation and the "what to look for" prompts
during replay are shared by all lessons, keyed by observation type
(`i18n/*/playback.ts`). The Concept paragraph is in the guide only; showing a
takeaway in the Lesson panel is RFC 0001's P3 and is not decided. Do not add
panel sections for one lesson.

## Spanish

The interface is English and Spanish (ADR-007), and the course that uses it is
taught in Spanish, so the Spanish copy is not secondary.

- Voice: Rioplatense voseo, short and direct ("Elegí", "Ejecutá").
- Use the terms table in `docs/glossary.md` ("Spanish Terms"): lección, falla,
  reintento, clave de idempotencia, invariante de negocio, se cumple, violado.
- Pattern names engineers say in English stay in English: Saga, Outbox, Circuit
  breaker, CQRS, timeout, dead letter, lease, checkout.
- Never translate component IDs, endpoints, observation types, codes, business
  data (`Draft`, `sku-1`), or `t=`.
- Translate the sentence, not the words. Reread the Spanish text alone and ask
  whether a student in Buenos Aires would say it that way.
- Lesson search matches the active language and English, so a concept does not
  need both words in one string.

## Review questions

Use these to read a group. Each "no" is a finding; say which surface it belongs
to and how much it costs the student.

Story

- Can you state the lesson's question in one sentence, and is that question
  what the title and description set up?
- Does the failing lesson fail for the reason the lesson is about, with the
  least machinery?
- Does the pair differ in one design decision and nothing else?
- Is there a moment in the run where the disagreement exists and is visible on
  both sides?

Checks

- Is each invariant a business property a different design could satisfy?
- Is every state-forbidding invariant `always`, and does every deadline have a
  stated reason?
- Do the expectations pin the moments that make this the story, and no more?
- Does the evidence show the rows that prove each verdict?

System and timeline

- Does every component earn its place? Could a first-time reader follow the
  Story milestones in order?
- Are the decisive moments on distinct times, with a named log at the decision?
- Does the run end soon after the story does?

Experiment

- Does every design-choice value produce a run worth reading? Is there a mixed
  row in the matrix, and does the guide discuss it?
- Is there a student fault that breaks the fix and teaches the next question?

Words

- Does every number in the description, labels, and guide match the sheet?
- Does the copy describe what happens and leave the outcome to the checks?
- Is the Spanish complete, in the glossary's terms, and natural?
- Does the guide's Concept paragraph say what the lesson does not model?
