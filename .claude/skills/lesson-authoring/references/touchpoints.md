# Where a lesson lives

Every place a packaged lesson touches, in build order, with the guard that
fails when a step is missed. Read the row you need; use the whole list as the
checklist for a new lesson.

Contents: [Catalog](#catalog-packagescatalogs) ·
[Browser](#browser-appsweb) · [Documents](#documents) ·
[Pinned lists and counts](#pinned-lists-and-counts) ·
[What a change costs](#what-a-change-costs) ·
[Instructor scenario files](#instructor-scenario-files)

The lesson name is `<family>-<variant>` (`retry-unsafe`, `lease-fenced`). The
family prefix is load-bearing: `commerceScenario`, `commerceChecks`,
`commerceOverlayPolicy`, and several tests dispatch on `name.split("-")[0]` or
`startsWith`. Pick a prefix no other family starts with.

## Catalog (`packages/catalogs`)

| Step | File | What to write | Guard |
| --- | --- | --- | --- |
| Name | `src/commerce/scenarios.ts`, `commerceLessonNames` | Add the names, grouped with their family. Order is catalog order and chooser order. | The `CommerceLessonName` union makes every `Record<CommerceLessonName, …>` fail to typecheck until it has the entry |
| Document | same file, a `<family>Scenario(name)` builder and its dispatch line in `commerceScenario` | `version: 1`, `name: "<lesson>@1"`, seed `commerce-classroom-1`, `startTime: 0`, explicit `start-<service>` actions at t=0, architecture, faults, workload, assertions. Use the file's helpers (`component`, `link`, `database`, `request`, `assertion`, `always`, `fault`). One boolean derived from the name selects the variant. Open with a comment that tells the story with its times. | `engine.validate` in `commerce.test.ts`; fresh, reset, and stepped exports must be equal |
| Checks | same file, `commerceChecks` | One entry per assertion, in document order: `invariant(id, label)` or `expectation(id, label)`. The label is the English source of what the student reads. | `commerce.test.ts`: every assertion classified, label non-empty and not containing the id, at least one invariant, the family's invariants identical |
| Overlay policy | same file, `commerceOverlayPolicy` and `commerceParameters` | The family's allowed fault rules and scheduled faults; its design choices, each default equal to the packaged value at every target. The pair's distinguishing switch is always a declared parameter. | `overlay.test.ts` (OVL-AC-6): targets resolve, defaults match, no shared target; every offered fault kind runs to completion; no invariant reads HOLDS over a violating final state at any domain edge |
| Architecture allowance | same file, `commerceArchitecture` | Only for a "fill the gap" design lesson (ADR-005): slots, bindings, resources, subscriptions, `maxEdits`. | `design.test.ts` (ARCH-AC-6) |
| Descriptor | `src/commerce/descriptors.ts` | Only for new behavior. A data-only `ModelDescriptor`: kind, endpoints or operations, consumers, publishes, peers with defaults, storage, options. Lesson data that is not a behavior option goes in `lessonData`. Add it to `commerceDescriptors`. | `descriptors.test.ts`: each model equals its descriptor; declared peers, storage, and subscriptions match every packaged document |
| Model | `src/commerce/<family>.ts` | `{ ...descriptor, checks: {}, instantiate }`. Read peers with `peer()`. Mutable state inside `instantiate`. Business logs with `ctx.log.write(level, "<noun>.<event>", data)`. Register it in `models` in `src/commerce/index.ts`. | `tests/boundaries.test.ts` keeps factories out of the main thread |
| Predicate | `src/commerce/index.ts`, `commerceAssessment` | Only when no existing predicate states the invariant. A stable `commerce.<name>` id added to the `find` list, a comment that states the property in one sentence, and evidence a student can read. A predicate used with `always` must pass before the first write. | Catalog tests for the lesson; document the predicate in `docs/modules/catalogs.md` |
| Tests | `tests/commerce.test.ts`, `tests/overlay.test.ts` | See [Pinned lists and counts](#pinned-lists-and-counts), plus behavior assertions for what the lesson is about (the log sequence, the final rows). | — |

Existing predicates, before writing a new one: `commerce.rows` (exact count
and row fields, or `maximum` rows for `always`), `commerce.metrics`,
`commerce.attempts`, `commerce.dead-letters`, `commerce.pricing`,
`commerce.live-carts`, `commerce.stock`, `commerce.reservations`,
`commerce.fencing`, `commerce.kv-entries`, `commerce.converged`,
`commerce.charges`, `commerce.unconfirmed-charges`, `commerce.notifications`,
`commerce.final-orders`. Their parameters are in `docs/modules/catalogs.md`.

Design-choice targets: ADR-004 lets a parameter target any component
configuration field, link policy field, destination field, or client action
data. Whether a configuration field is a descriptor `option` or `lessonData`
is a separate question that matters for slots (ADR-005): a slot edit replaces
the configuration with options, so a model with lesson data cannot fill a slot.
A parameter on a `lessonData` field is allowed and changes no descriptor. Moving
a field from `lessonData` to `options` changes what the model is; do not do it
to add a design choice, and ask if you think it is needed.

Storage rule: a cache, counter, expiring marker, or lease uses a
`KeyValueStore` (the service's own, or `commerce.kv-server` when several
services share it). State that must commit with a business row (an idempotency
result, an inbox or outbox row) stays in the service's database.

Admission is automatic: the worker (`apps/web/src/worker/adapter.ts`), the
hosted registry's reserved names (`src/hosted.ts`), the headless runner, and the
starter-file tests all iterate `commerceLessonNames`.

## Browser (`apps/web`)

| Step | File | What to write | Guard |
| --- | --- | --- | --- |
| Title and description | `src/i18n/en/lessons.ts` and `src/i18n/es/lessons.ts`, `commerce` | `{ title, description }` by lesson name. The description is the ① Goal text and the chooser card. | `typeof en` (tsc); CONTENT-6: keys equal `commerceLessonNames`, Spanish title differs from English |
| Compare partner | `src/scenarios.ts`, `commercePairs` | The lesson Compare loads, or `""`. Groups are the transitive closure of these. | `satisfies Record<CommerceLessonName, string>` |
| Topic and concepts | `src/lesson-topics.ts`, `classification` | One topic, and the course vocabulary the lesson exercises. All lessons of a group share the topic. | `satisfies Record<PackagedScenario["id"], …>`; `lesson-topics.test.ts` |
| New concept or topic | `src/i18n/{en,es}/lessons.ts`, `concepts` or `topics`; `lessonTopics` for a topic | A concept is a term a course would index. Reuse existing ids first. | CONTENT-6: every concept used, every used concept worded |
| Spanish check labels | `src/i18n/es/content.ts`, `checks` | Keyed by check id. A check worded differently in one lesson of the family is keyed `<lesson>/<id>` and listed in `lessonSpecificChecks` in `src/lesson-checks.ts`. | CONTENT-1, CONTENT-2, CONTENT-5 |
| Component names | `src/i18n/{en,es}/components.ts`, `names` | A display name for every new component ID. An ID is shared by every lesson that uses it, so reuse `orders`, `payments`, `client` and their names. | `component-display.test.ts` |
| Design-choice copy | `src/i18n/{en,es}/designChoices.ts`, `choices` | `{ label, hint }` by parameter key. `lessonChoices` when a key means something different in one lesson. | `design-choices.test.ts`: every declared parameter has copy |
| Browser checks | `e2e/commerce-lessons.spec.ts` | The per-lesson loop covers a new name by itself. Add a focused test only for what is new on screen. | — |

English check labels are not in `apps/web`: they are the catalog's
`commerceChecks` labels, and `content.checks` is empty in English by design
(ADR-007 section 5).

Nothing else in the browser should need a lesson's name. If you find yourself
adding `if (lesson.id === …)` or reading a component ID in presentation code,
stop: derive from the declared model, the kind, or the policy instead.

## Documents

| Document | What changes |
| --- | --- |
| `docs/commerce-lessons.md` | The lesson's section: **Pattern**, **Problem**, **Topology**, **Initial state**, **Injected fault**, **Expected timeline**, **Expected checks** table (one row per lesson with its `npm run lesson` command), what the browser shows, **Design choices**, **Concept** with the limits. Also the *Design choices* and *Faults* tables near the top, and the opening count. |
| `docs/modules/catalogs.md` | Source map row for a new file, the models table, the *Packaged commerce documents* table row, the safety or deadline invariant lists, the expectations paragraph, any new predicate, and the counts. |
| `README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/spec/architecture-visualization.md` | The lesson and model counts in prose. |
| `docs/glossary.md` | A new domain term, and its Spanish term under "Spanish Terms". |
| `CONTEXT.md` | Only when the change adds vocabulary or a seam. |

Find the counts with:

```sh
rg -n 'twenty-one|twenty-five|21 commerce' README.md AGENTS.md docs/
```

## Pinned lists and counts

Tests that hold an explicit list or number. Each is a deliberate tripwire:
update it knowingly, and read what it protects first.

| Test | Pinned |
| --- | --- |
| `packages/catalogs/tests/commerce.test.ts` | The pairs with equal seed, faults, and actions; `families`; `violated` (the invariants each lesson is meant to violate; everything else must pass); `safety` (invariants that use `always`); the families that record no fault (`cache-`, `inventory-`, `clock-`) |
| `packages/catalogs/tests/overlay.test.ts` | The pairs, and the design choices that turn each lesson into its partner (setting them must give the partner's invariant verdicts) |
| `packages/catalogs/tests/descriptors.test.ts` | The number of peer rebindings across packaged documents, which grows with every declared peer a new document uses |
| `packages/catalogs/tests/document.test.ts` | The number of packaged documents |
| `apps/web/tests/content-translations.test.ts` | The number of distinct check ids and of concepts; the lesson-specific check keys |
| `apps/web/tests/lesson-topics.test.ts` | Every topic's groups, in order |
| `apps/web/tests/commerce-worker.test.ts` | Per-family facts of the student projection, and for some lessons the exact list of design-choice keys |
| `apps/web/tests/lesson-pairs.test.ts`, `component-display.test.ts` | The number of packaged lessons; the display-name table |
| `apps/web/e2e/lesson-chooser.spec.ts` | The chooser's lesson count |

## What a change costs

| Change | Exports and `runId` | Also update |
| --- | --- | --- |
| Title, description, topic, concept, component name, design-choice label or hint | Unchanged | Both languages |
| Check label | Unchanged | Spanish `content.checks`; the guide if it quotes the label |
| Check time, new or removed check, invariant ↔ expectation | Changed (assertions are part of the document) | `commerceChecks`, every lesson of the family for an invariant, Spanish label, guide, catalogs.md, `violated` / `safety` lists |
| Latency, timeout, delay, workload time, fault | Changed | Every time quoted in descriptions, check labels, the guide, catalogs.md; the paired lesson |
| New design choice | Unchanged while its default is the packaged value | Copy in both languages; the guide's *Design choices* table and the lesson section's **Design choices** paragraph; `docs/modules/catalogs.md` when the target is not a descriptor option; an overlay test for what the values do; any test that pins the lesson's parameter keys (`rg -n "parameters.map" apps/web/tests packages/catalogs/tests`) |
| Model behavior or log | Changed for every lesson using the model | Those lessons' tests and guide sections |

Golden digests (`npm run golden:0x`) belong to the kernel and must not move
because of a lesson. If one does, the change reached below the catalog: stop
and say so.

## Instructor scenario files

An instructor's lesson without code (ADR-006): a JSON document that composes
catalog models and references catalog predicates by id. Use it when the request
is "a scenario for my class" rather than a lesson shipped with the product.

- Shape: `format: "distlab.scenario"`, `formatVersion: 1`, a `catalog`
  reference (`mvp.checkout@1.0.0`, `mvp.checkout@1.1.0` when components are
  renamed, or `commerce.lessons@1.0.0`), `presentation` (plain-text `title`,
  `summary`, and a label per assertion id), `scenario`, and an optional
  `overlayPolicy`. The fixture is `examples/scenarios/processor-response-lost.json`.
- Fastest start: **Save as scenario file** on a packaged lesson, or copy the
  fixture, then edit. The name must not be a reserved packaged name.
- Check it headlessly: `npm run scenario -- check <file>`. Each diagnostic is a
  path and a code. A failing assertion is the document's finding, not an error.
- It has no invariant/expectation classification, no display names, and one
  language: the author's. Checks read PASS or FAIL beside the author's label,
  so write labels as full sentences that state the property.
- Everything in [didactics](didactics.md) about the story, the topology, and
  the timeline applies unchanged.
