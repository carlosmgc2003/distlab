# ADR-007: Localization of the browser interface

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-11-12 |
| Scope | Browser application (`apps/web`), its tests, and the glossary. No contract, kernel, scenario, or catalog semantics change. |
| Evidence | [Student evaluation, ITBA 73.40](../../evaluations/2026-11-itba-73-40/README.md) ("English only. The course is taught in Spanish") |
| Related issues | #206, #210, #211, #212, #213 |
| Supersedes | The deferral in [RFC 0001](../../rfc/0001-course-ready-design-module.md) ("Spanish. Later, and only if a pilot shows that language is a barrier"), at the maintainer's request |

## Context

DistLab's interface was English only. The course that evaluated it is taught in
Spanish. An inventory of the code in November 2026 found:

| Where | Messages | Words | Notes |
| --- | --- | --- | --- |
| `apps/web/src/*.tsx` (18 components) | ~580 | ~3,000 | ~45 sentences split around inline elements, 6 hand-made plurals |
| `apps/web/src/*.ts` (23 modules) | ~650 | ~3,900 | 91 sentences assembled from fragments, 23 plurals, the lesson copy |
| `packages/catalogs` | ~70 | ~600 | Check labels, assessment text, two checkout lessons |
| `packages/scenario`, kernel | 48 codes | 0 | Already code-only: `{ path, code }` |
| Playwright suite | ~1,450 English-text selectors | | ~420 text-independent, no `data-testid` |

Facts that shaped the decision:

- The simulation is already language-neutral. `AssertionResult` is
  `{ id, status, time, evidence }`, diagnostics are `{ path, code }`, observation
  types are codes, and golden digests contain no prose.
- Some text in the history is **data**, not copy: business values (`Draft`,
  `report by worker-1`), endpoint names (`POST /pay`), status codes
  (`NETWORK_TIMEOUT`). Translating it would change digests and break
  assertions.
- Several display strings doubled as logic: verdict words used as enum values
  and CSS classes, `"none"` read back as a null sentinel, a label rebuilt by
  stripping an English prefix, filter labels deduplicated by their English text.
- The worker sent English prose in `ApplicationError.message`.
- The main-thread boundary test allows a fixed list of packages and rejects
  dynamic `import()`, so i18n libraries and lazy locale bundles would need an
  exception.

## Decision

### 1. Language is presentation

Text is produced on the main thread, at render time, from codes, ids, stored
fields, and counts. It never enters projections, worker commands, records, or
history, and the worker never imports a catalog (`tests/boundaries.test.ts`,
I18N-AC-9). Switching the language re-renders; it sends no command, resets
nothing, and cannot change a run. This is the same rule that keeps graph layout
out of the simulation.

Never translated: component IDs, endpoint and destination names, observation
types, status and error codes, business data and evidence values, payloads,
the `t=` notation, and kernel concept names (`VirtualClock`, `MessageBus`).

### 2. Typed catalogs, built on `Intl`, with no new dependency

`apps/web/src/i18n/` holds one catalog per locale. `en/` is the source; each
other locale is typed `typeof en`, so a missing key or a changed parameter is a
compile error, and `tests/i18n.test.ts` also rejects extra keys (I18N-AC-1).
Catalogs are split into **areas**, one per screen or module family
(`en/timeline.ts`, `en/faults.ts`, …), so translators and reviewers work file by
file.

A message is a string, or a function of one parameter and the locale's `Fmt`:

```ts
// en/lessonChooser.ts
count: (p: { shown: number; total: number }, f: Fmt) =>
  p.shown === p.total
    ? f.plural(p.total, { one: "1 lesson", other: `${f.number(p.total)} lessons` })
    : `${f.number(p.shown)} of ${f.number(p.total)} lessons`,
```

`messages(locale)` binds the formatter once, so call sites read
`m.lessonChooser.count({ shown, total })`. `Fmt` wraps only platform `Intl`:
`plural` (`Intl.PluralRules`), `number` (`Intl.NumberFormat`), `list`
(`Intl.ListFormat`), and `quote`. The main thread's dependency list is
unchanged, and all locales are imported statically, as the boundary test
requires. At ~7,500 words a locale costs ~15 KB compressed. Revisit lazy
loading if the count of languages grows past three or four.

### 3. Rules for messages

1. **One message per sentence.** Never build a sentence from fragments, never
   splice an article or a verb chosen in code into a sentence. Each shape is its
   own message with parameters.
2. **Plurals through `f.plural`**, with whole phrases per form. No
   `n === 1 ? "" : "s"`.
3. **Lists through `f.list`**, numbers through `f.number`. No hand-written
   `", "` or `" and "` joins in prose.
4. **Inline markup through `<Rich>`.** A message keeps its markup as tags and
   its values as placeholders: `"Seed: <code>{seed}</code>."`, rendered with
   `<Rich text={m.app.seed} tags={{ code: c => <code>{c}</code> }} values={{ seed }} />`.
   Values are inserted as nodes and never parsed, so scenario-file text cannot
   inject markup.
5. **Codes stay codes.** Logic compares codes and ids, never display text. A
   module that needs a label for a code looks it up in a code-keyed table
   (`byCode(m.errors.application, code)`), with a visible fallback to the raw
   code.
6. **State stores descriptors, not sentences.** Reducer state and derived
   objects keep the code and parameters of a message; text is produced when it
   is rendered, so a language switch never leaves stale English behind.
7. **Pure modules receive `m: Messages` as a parameter.** They stay pure and
   testable; tests pass `messages("en")`. Components get `m` from
   `useMessages()`.

### 4. Choosing the language

`?lang=<id>` wins, then the stored choice (`localStorage` key
`distlab.locale`), then the first browser language whose primary subtag matches
a selectable locale, then English (I18N-AC-3). The switcher in the top bar names
each language in itself. `document.documentElement.lang` follows the choice, so
assistive technology and axe read the real language.

### 5. Lesson and catalog text

Text a lesson author writes in `packages/catalogs` (check labels, checkout
lesson titles, the assessment's requirements and labels) stays there as the
English source, because the command-line lesson runner and the catalog tests
use it and the contracts carry it. The browser renders the English source for
`en`, and the `content` area of other locales translates it **by stable id**:
lesson name, check id, assessment row and invariant id. A test enumerates every
catalog id and fails when a locale lacks it, so a new lesson or check cannot
ship untranslated.

Lesson copy written in `apps/web` (titles, descriptions, topics, concepts) moves
into the `lessons` area. Lesson search matches the active language **and**
English, because the course bibliography is in English.

Imported scenario documents (ADR-006) carry their author's language and are
shown as written. A per-language `presentation` needs a new format version and
is follow-up work.

### 6. Guards

| Guard | What it catches |
| --- | --- |
| `typeof en` on every locale (tsc) | Missing keys, changed parameters |
| I18N-AC-1 shape test | Extra keys, changed arity or list length |
| I18N-AC-2 untranslated test | A Spanish string left identical to English |
| I18N-AC-8 scanner budget (`tests/i18n-scan.ts`) | New hard-coded English in `src/` outside the catalogs |
| I18N-AC-9 boundary test | The worker or a catalog reaching simulation code |
| Pseudo-locale `en-XA` (`?lang=en-XA`), `e2e/i18n.spec.ts` | Text that bypasses the catalogs; labels that overflow when text grows ~30% |
| `e2e/i18n.spec.ts` in Spanish, with axe | Switching, persistence, `lang`, and accessibility in another language |

The existing Playwright suite runs in English (`locale: "en-US"`). Role-plus-name
selectors are good accessibility practice and stay as they are.

## Adding a language

1. Copy `apps/web/src/i18n/es/` to `apps/web/src/i18n/<id>/` and translate it.
   `npm run typecheck` lists every missing or mistyped message.
2. Add the locale to `LOCALES` and `SELECTABLE_LOCALES` in `i18n/locales.ts`,
   and to `catalogs` in `i18n/catalog.ts`.
3. Add a terms section to `docs/glossary.md`, following "Spanish Terms".
4. Run `npm test`. Then open `?lang=<id>` and walk the states listed in
   `e2e/i18n.spec.ts`.

## Alternatives considered

- **i18next, react-intl, or Lingui.** Mature, with ICU MessageFormat and
  extraction tooling. Rejected for now: each widens the main thread's dependency
  list, and lazy locale loading would need the `import()` rule relaxed. The
  typed-function catalog gets compile-time completeness, which string-keyed ICU
  catalogs only get through extra tooling. If translators outside the team need
  a translation platform, the catalogs can be exported to ICU messages later.
- **Replace English selectors in tests with `data-testid`.** Rejected: 1,450
  edits, and role-plus-name selectors test the accessible names students rely on.
- **Translate in the worker.** Rejected: the language would become a simulation
  input and could change digests.
- **Move catalog-authored English into the web catalogs.** Rejected: it would
  change contract shapes (`AssessmentDefinition`, the commerce check
  classification) and the command-line runner's output.

## Consequences

- Every user-visible string in `apps/web` is a catalog entry, so copy changes are
  reviewed in `i18n/en/` and their translations sit next to them.
- English wording is unchanged except where the old text was ungrammatical for
  a count of one; those assertions were updated.
- Text-producing modules take `m: Messages`; their unit tests pass
  `messages("en")`.

## Follow-up work

- Translate the student-facing documents (`docs/commerce-lessons.md`,
  `docs/glossary.md`, `docs/learning-timeline.md`, ~10,000 words): #210.
- Check labels that hard-code run facts ("5 risk calls, 3 failures … (t=120)")
  should take those facts as parameters from the scenario: #211.
- A per-language `presentation` in scenario documents (ADR-006 format version 2): #212.
- A native-speaker review of the Spanish catalogs: #213.
