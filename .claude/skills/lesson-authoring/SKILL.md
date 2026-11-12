---
name: lesson-authoring
description: Review, adjust, or create DistLab lessons - the teaching content (titles, goals, check labels, concepts, the lesson guide), the configuration (scenario document, faults, workload, lesson checks, design choices, allowed student faults), and the visualization (graph, component names, Story milestones, business logs). Use this skill whenever the user asks to review, audit, improve, fix, reword, translate, or create a lesson, a lesson pair, lesson copy or explanations, a business invariant or lesson check, a design choice, or an instructor scenario file, including requests in Spanish such as "revisar la lección", "crear una lección", "mejorar la explicación", or "ajustar la visualización", and whenever a change touches packages/catalogs/src/commerce/scenarios.ts, a lesson model, apps/web/src/i18n/*/lessons.ts, lesson-topics.ts, or docs/commerce-lessons.md.
---

# Lesson authoring

A DistLab lesson is a small deterministic experiment that lets a student watch
one distributed-systems idea fail and then hold. This skill reviews lessons and
writes them: what the student reads, what the simulation runs, and what the
screen shows.

Read `CONTEXT.md` first if you have not: it fixes the vocabulary used below
(packaged lesson, lesson check, business invariant, scenario expectation,
design choice, session overlay, slot). Use those words exactly, in code, copy,
and conversation.

## What a lesson is made of

A lesson has three surfaces. A change to one usually forces a change to the
others, because all three describe the same recorded run.

| Surface | What it is | Where it lives |
| --- | --- | --- |
| **Teaching content** | Title, goal description, topic and concepts, check labels, design-choice labels and hints, and the lesson's section in the guide (pattern, problem, timeline, concept) | `apps/web/src/i18n/{en,es}/`, `apps/web/src/lesson-topics.ts`, `commerceChecks` in the catalog, `docs/commerce-lessons.md` |
| **Configuration** | The scenario document (architecture, initial state, workload, packaged faults, seed), the lesson checks, the overlay policy (design choices, allowed student faults, architecture allowance), and the models behind it | `packages/catalogs/src/commerce/` |
| **Visualization** | The architecture graph (nodes, names, symbols), the Story milestones and business logs, Service state, and evidence | Derived from the configuration by `apps/web/src/`; an author shapes it mostly through IDs, names, logs, and stored fields |

The unit of teaching is the **group**, not the single lesson: a failing lesson
beside its fix, loaded one after the other with Compare. Review and design
groups whole.

## Choose the mode

- **Review** ("revisá la lección X", "is this lesson any good?"). Produce a
  report. Do not edit files unless the user asked for fixes.
- **Adjust** ("mejorá la explicación", "the timeout should be tunable", "the
  graph is hard to read"). Make the smallest change that fixes it, then carry
  it through the other surfaces.
- **Create** ("agregá una lección sobre X"). Design first, agree on the design,
  then build.
- **Scenario file** (an instructor's JSON document, ADR-006). No code: compose
  existing catalog models and predicates. See
  [touchpoints](references/touchpoints.md#instructor-scenario-files).

When the request does not say which lesson, list them with the sheet's
`--list` and ask, or review the group the user's words point at.

## Start from the facts

Copy drifts from behavior. Before judging or writing anything, print the lesson
sheet: every string the student reads, in English and Spanish, beside what the
run recorded.

```sh
npm run build:packages --silent
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts --list
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts retry-unsafe
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts retry-unsafe --set timeout=40
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts notifications-dlq --matrix
```

The sheet shows the copy, the architecture with display names, the packaged
faults and workload, the design choices with their labels, the Story milestones
exactly as the Story table lists them, the business logs, each check's verdict
and time, the document difference against the Compare partner, and a short list
of automatic findings. `--matrix` runs every combination of the design choices'
domain edges, which is how you learn whether a choice changes anything. The
script reads and runs; it never edits.

Its findings cover wiring and consistency only. They are a starting list, not
the review.

To see the screen, build and capture it:

```sh
npm run build
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts lease-unfenced --out <scratch dir>
node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-shot.ts lease-unfenced --lang es --size 1534x897 --out <scratch dir>
```

It writes four images: loaded, after Run, the graph alone, and Recorded
history. Look at them; do not describe a screen you have not seen. `npm run
lesson -- <name>` remains the plain headless run, and `--step` walks it one
scheduler event at a time.

## What makes a lesson teach

These are the judgments the review rests on. The reasons and worked examples
are in [didactics](references/didactics.md); read it before a review or a new
design.

1. **The problem comes before the pattern.** The student should meet a
   situation ("a payment response is lost") and feel the question before a
   named solution appears. A title that is only a pattern name, or a
   description that announces the result, takes the discovery away.
2. **One question per lesson, one difference per pair.** The two documents of a
   pair differ in the design under comparison and nothing else: same seed, same
   workload, same faults. Otherwise the student cannot attribute the change.
3. **The finding is a violated business invariant.** It is stated as a property
   the business needs whatever the design ("charges the order once"), worded
   identically across the family, so Compare reads VIOLATED → HOLDS for the
   same sentence. A check that only confirms the story is a scenario
   expectation and says so.
4. **Verdicts must be trustworthy.** A property that forbids a state is checked
   at every boundary (`always`); a property that must be reached keeps a
   deadline (`at`). A student's choice or fault must never turn a real
   violation into HOLDS.
5. **The smallest system that shows it.** Every component earns its place in
   the story. Fewer nodes, fewer milestones, and distinct virtual times for the
   moments that matter make the run something a first-time reader can follow.
6. **Both sides are visible.** The lesson's point is usually a disagreement:
   what the caller believes against what the receiver stored. Both must be
   inspectable as recorded facts, and the decisive moment should be a milestone
   with a name.
7. **The student has something to decide.** A design choice should change what
   happens. The best lessons have a setting that is neither the packaged
   failure nor the packaged fix and still teaches something.
8. **The words are true.** Every number, time, and name in the copy matches the
   recorded run, in both languages. Copy describes what the system does and
   leaves the outcome to the checks.
9. **The limits are stated.** Each lesson's guide section ends by saying what
   the lesson does not model.

## Review

1. Print the sheet for every lesson of the group, with `--matrix` when the
   group has design choices. Capture the screen when the review covers
   visualization.
2. Read the group's section in `docs/commerce-lessons.md` and its row in
   `docs/modules/catalogs.md`. Compare each stated time, count, and final state
   with the sheet.
3. Read the models (`packages/catalogs/src/commerce/<family>.ts`) far enough to
   know what the student's Story is made of: which logs exist, what the rows
   and replies contain.
4. Judge the group against [didactics](references/didactics.md), surface by
   surface, and the graph and Story against
   [visualization](references/visualization.md).
5. Write the report.

Report in the user's language, in this shape:

```markdown
# Review: <group>

**Verdict.** Two or three sentences: does it teach its idea, and what most stands in the way.

## Findings
For each, most important first:
- **<short title>** (content | configuration | visualization; blocks learning | misleads | polish)
  What the student meets, with the evidence (a quoted string, a time from the sheet, a file and line).
  What to change, concretely. Say when the fix is a judgment call for the maintainer.

## What works
What to keep, briefly, so a rewrite does not lose it.

## Proposed changes
The edits you would make, grouped by surface, with the files. Mark which change packaged exports or digests.
```

Separate what is wrong (a stale number, an untranslated label, a pair that
differs in its workload) from what is a matter of taste (a better title). The
project sends copy and visual judgment to a human, so present taste as a
proposal with your reasoning, not as a defect.

## Adjust

1. Find every place the thing appears with
   [touchpoints](references/touchpoints.md). A check label lives in the
   catalog and in the Spanish `content` area; a time lives in the document, the
   description, a check label, the guide, and often a test.
2. Change the source of truth first (the document or model), rerun the sheet,
   then make the copy match what the run now records.
3. Keep the pair fair: a change to one lesson's workload, faults, seed, or
   invariants goes into every lesson of the family.
4. A change to a packaged document changes its export and `runId`. That is
   expected for an intended behavior change and must be said in the pull
   request; it is a stop sign when you only meant to change words.
5. Verify (below).

Copy-only changes touch no document: lesson titles and descriptions, topics,
concepts, design-choice labels and hints, and component names live in
`apps/web/src/i18n/`. Check labels are the exception. Their English source is
catalog data in `commerceChecks`, outside the document, so rewording one
changes no export, but it does need the Spanish entry updated.

## Create

Design before code. A lesson costs a few hundred lines across two packages and
several documents, and most of the value is decided in the brief.

1. **Place it.** Which topic, which course need? RFC 0001 (P5) lists the
   lessons the course lacks, in order of value; `docs/vision.md` §18 and §26
   list target concepts. Check that no existing group already teaches the idea:
   a new design choice on an existing group is often the better answer.
2. **Write the brief** and show it to the user before building, unless the
   session is unattended and the issue already fixes these points:
   - the question the student should be able to answer afterwards;
   - the business invariant, in one sentence that never mentions the mechanism;
   - the smallest topology, in existing vocabulary and component names;
   - the story as a timeline of virtual times, for the failing and the fixed
     run, and what makes it fail (a packaged fault, or ordinary timing);
   - the design choices, with what each non-default value shows;
   - what the lesson deliberately leaves out.
3. **Reuse before modeling.** Compose existing models when they can tell the
   story; a new document with existing models is data only. Add a model only
   for behavior no model has, and follow "Extending a catalog or lesson" in
   `docs/modules/catalogs.md`.
4. **Build in this order**, running the sheet as you go: document and checks,
   models and predicates if needed, overlay policy, catalog tests; then the web
   copy in English and Spanish, pairs, topic and concepts, component names;
   then the guide and the counts in prose. The full list, with the guard that
   fails when a step is missed, is in [touchpoints](references/touchpoints.md).
5. **Tune the story.** Run the sheet and the matrix. Adjust latencies, delays,
   and check times until the key moments fall on distinct virtual times, the
   run ends soon after the last one, and every design-choice value gives a run
   worth reading.
6. **Look at it.** Capture the screen at 1366×768 in both languages.
7. Verify, then write the guide section last, from the final sheet.

## Rules that are not negotiable here

They come from `AGENTS.md` and the ADRs; a lesson is the easiest place to break
them by accident.

- **Determinism.** Models use the virtual clock and seeded randomness, never
  `Date.now()`, timers, or `Math.random()`. Components talk only through the
  modeled network or message bus and touch only their own storage.
- **Data-only boundary.** `scenarios.ts` and `descriptors.ts` import contract
  types only; the main thread never imports a model factory. Runtime
  construction stays in the worker.
- **Peers, not literal IDs.** A model reads the components it calls through
  `peer()`. Presentation derives from the declared model or kind, never from a
  component ID.
- **The spec names things.** Do not invent a contract type, an alias, or a
  shape. When the specs do not settle something, ask.
- **Interface text lives in the catalogs** (`apps/web/src/i18n/`), one message
  per sentence, English as the source and Spanish in Rioplatense voseo with the
  terms of `docs/glossary.md`. IDs, endpoints, codes, business data, and `t=`
  are never translated.
- **Stored facts only.** Narration, labels, and checks read recorded fields.
  Nothing reconstructs a redacted payload or infers causation, order, or
  duration that the history does not state.
- **No new mechanism for one lesson.** A new assertion mode, command,
  projection field, or graph symbol is a specification change. Propose it and
  ask before building it.

## Verify

For catalog or model changes:

```sh
npm run typecheck
npm test -w @distlab/catalogs
(cd apps/web && node --test --experimental-strip-types tests/*.test.ts)
npm run lesson -- <name> --replay
git diff --check
```

For anything a student can see, also run the browser tests that load every
lesson, and look at the screenshots yourself:

```sh
npm exec -w @distlab/web -- playwright test commerce-lessons.spec.ts lesson-chooser.spec.ts graph-legibility.spec.ts i18n.spec.ts --trace off
```

`npm test` runs everything and is what the pull request reports. Never weaken,
skip, or loosen a test to make a lesson pass: several of them pin exactly the
properties this skill cares about (paired inputs, classified checks, shared
invariants, translated copy), so a failure is usually the review finding.

Finish by rerunning the sheet for each lesson you touched and reading its
findings. Report what you changed by surface, what the run now records, which
packaged exports changed, and anything you left as a proposal for the
maintainer.
