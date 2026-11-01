# ADR-005: Instructor scenario documents and import

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-11-01 |
| Scope | Scenario document format, application boundary, worker protocol; contracts and implementation follow in the issues listed under [Follow-up work](#follow-up-work) |
| Related issues | #99, #93, #96, #97, #98, #104 |

## Context

An instructor can define a scenario with an architecture, initial state, client
actions, external-service behavior, failures, configuration, a seed, and
invariants ([vision §19](../../vision.md#19-scenarios)). Scenarios support course
material and examinations ([vision §4](../../vision.md#4-target-audience),
[§21](../../vision.md#21-assessment)), and the browser keeps "local persistence
when needed" ([vision §24](../../vision.md#24-browser-first)).

Today every scenario is TypeScript in `packages/catalogs/src/`. The worker
accepts only the packaged lessons, optionally with a session overlay
([ADR-004](004-session-overlays.md)). An instructor cannot write an exercise or
an exam without changing code. The application boundary lists "YAML authoring
format, save/load persistence" as deferred
([application boundary](../application-boundary.md#deferred-capabilities)).

Two facts shape the decision:

- `ScenarioEngine.validate` already takes a `CanonicalValue`, rejects unsupported
  fields, and returns diagnostics with JSON-pointer paths
  ([scenario engine](../scenario-engine.md)). A packaged lesson is already a
  JSON-shaped `ScenarioDefinition`.
- `RunInputs.modelVersions` already records the catalog ID and version, the
  assessment version, and each assertion's predicate as `id@version`. So
  `runId` already changes when a catalog, model, or predicate version changes.

Architecture §40 requires an ADR because the change touches the host's accepted
inputs, the worker protocol, and how a run's inputs are identified.

## Decision

### Summary

An instructor writes a **scenario document**: a JSON file that wraps an
unchanged `ScenarioDefinition` in a small envelope. The envelope names the
catalog the scenario runs against and carries presentation text. Invariants are
assertions that reference predicates of that catalog by ID. A student opens the
file with a file picker. The main thread sends the file's text in a `load`
command. The worker parses, bounds, and validates it, and then runs it through
the unchanged `ScenarioEngine`. Nothing in a document runs as code. The browser
does not store documents in the first increment.

### Format: JSON first

Version 1 of the format is JSON ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)),
encoded as UTF-8. YAML is deferred. If YAML is added later, it is a pure import
adapter that turns a restricted subset into the same JSON value before
validation. The subset excludes anchors, aliases, tags, merge keys, multiple
documents, and non-string keys, and it requires seeds and IDs to be strings.
There is never a second schema. The vision and architecture examples are written
in YAML to show content, not syntax.

JSON was chosen for these reasons:

- The engine already validates canonical JSON values. JSON needs no parser
  dependency in the worker bundle.
- YAML's implicit typing changes meaning silently. For example, `seed: 1234`
  becomes a number, and `no` can become `false`. The scenario engine already
  requires that a numeric YAML seed be converted explicitly.
- YAML aliases can expand a small file into a very large value. JSON size is
  bounded by its byte length.

There is one canonical shape. The format adds no shorthand, such as the vision's
map-shaped `external:` block. A packaged lesson is therefore already a valid
document body, so an instructor can start from one.

### Document envelope

```json
{
  "format": "distlab.scenario",
  "formatVersion": 1,
  "catalog": { "id": "mvp.checkout", "version": "1.0.0" },
  "presentation": { "title": "…", "summary": "…", "assertions": { "<assertion id>": "…" } },
  "scenario": { "version": 1, "name": "…", "seed": "…", "architecture": { } },
  "overlayPolicy": { }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | Yes | The constant `"distlab.scenario"`. |
| `formatVersion` | Yes | The envelope version, `1`. See [Versioning](#versioning-and-compatibility). |
| `catalog` | Yes | A **catalog reference**: the exact `id` and `version` of a hosted catalog. |
| `presentation` | Yes | Plain-text copy: a `title`, an optional `summary`, and optional labels keyed by assertion ID. |
| `scenario` | Yes | A `ScenarioDefinition` input, with the engine's normal defaults and validation. |
| `overlayPolicy` | No | A `LessonOverlayPolicy` for this document. Without it, the document accepts only the empty overlay. |

Only `scenario` and the resolved catalog enter `RunInputs`. Presentation text and
the envelope fields do not. Two files that differ only in their title therefore
produce the same `runId`.

A **hosted catalog** is a model catalog paired with the assessment catalog the
worker uses with it. Today there are two: `mvp.checkout@1.0.0` (checkout models
and `mvp.*` predicates) and `commerce.lessons@1.0.0` (commerce models and
`commerce.*` predicates). The worker resolves the reference from its own
registry. A document cannot name a model or predicate outside the catalog it
references. The worker never infers the catalog from model names, because that
would hide which catalog was used.

### Invariants reference catalog predicates only

A document states invariants and scenario expectations as `scenario.assertions`.
Each assertion names a predicate by its catalog ID and passes canonical
`parameters`. The `always`, `at`, and `eventually` modes and their deadlines are
unchanged. The vision's `expect: invariants:` list maps to these assertions.

- A document cannot contain inline code, expressions, a query language, or a
  path into state. A predicate is trusted catalog code that has been reviewed
  and tested.
- A predicate's version is fixed by the catalog version. A hosted catalog
  version is immutable. If a model's or predicate's behavior changes, the model
  or predicate gets a new version and the catalog gets a new version.
  `RunInputs.modelVersions` records each assertion's predicate as `id@version`,
  so a run states exactly which predicate judged it.
- If an exercise needs a property that no predicate expresses, the property is
  added to a catalog as a new, versioned, parameterized predicate. Parameterized
  predicates such as `commerce.rows` and `commerce.metrics` already cover many
  checks.

Separating business invariants from scenario expectations is decided in #96. A
document carries whatever classification #96 defines, in the same place #96
puts it for packaged lessons, under a new format version if the shape changes.

### Import path

The first increment has one import path: a **local file**. The student chooses a
`.json` file with a file picker or drops it on the scenario chooser.

1. The main thread checks `File.size` against the byte limit before reading.
   A file that is too large is not read.
2. The main thread reads the file as text and sends it, unparsed, in a `load`
   command. It does not parse, validate, or interpret the document.
3. The worker validates the document as described in
   [Validation](#validation) and constructs the session.

The other paths in the issue are decided as follows:

- **URL import is rejected for now.** Fetching a document from any origin
  reveals the student's address to that host, depends on CORS, and lets the
  content behind a link change. Sharing and hosting documents are out of scope.
  If a URL path is added later, the link must carry the document's digest, and
  the worker must reject content whose digest differs.
- **Local storage is deferred.** The file is the durable artifact that an
  instructor distributes. Reloading the page returns to the packaged lesson
  chooser. If browser storage is added later, it stores the original text only,
  revalidates that text on every load, and never stores a validation result or
  a normalized document.
- **Pasting text** may use the same path as a file, because it sends the same
  string. It is optional in the first increment.

### Trust model

A document is untrusted data from anyone. The worker treats it as follows:

- **No code execution.** The worker never evaluates document content. Model
  names, actions, operations, and predicates resolve only to trusted catalog
  entries by exact ID and version. Unknown names are diagnostics.
- **Strict parsing.** The parser accepts only RFC 8259 JSON. It rejects
  duplicate object keys, because `JSON.parse` would silently keep the last one.
  It rejects the key `__proto__` at any depth. It rejects nesting deeper than
  the depth limit. The result is a `CanonicalValue`: finite numbers, dense
  arrays, and plain objects.
- **Bounded size.** The limits below are checked before the scenario is
  validated. They bound worker memory and validation time. They are contract
  constants, so the main thread, the worker, and tests share them.
- **Plain text only.** The UI renders presentation text as text nodes. It never
  renders it as HTML or Markdown, and it never follows links in it.
- **Reserved names.** An imported `scenario.name` must not equal a packaged
  lesson name, so an export cannot pass an imported run off as a packaged
  lesson. No ID in an imported document may start with `student-`, so
  ADR-004's provenance rule stays true.
- **Identification, not tamper-proofing.** DistLab does not sign documents. A
  student who edits an exam file gets a different digest and, if the scenario
  changes, a different `runId`. An instructor checks integrity by comparing the
  digest shown in the run header or export with the digest of the distributed
  file.

| Limit | Initial value |
| --- | --- |
| Document size | 262,144 bytes of UTF-8 |
| Nesting depth | 32 |
| Components | 32 |
| Links | 128 |
| Actions | 2,000 |
| Fault rules | 64 |
| Assertions | 64 |
| `configuration.historyLimit` | 100,000 (the packaged value) |
| `presentation.title` | 120 characters |
| `presentation.summary` | 2,000 characters |
| Each assertion label | 200 characters |

Every packaged lesson is well inside these limits. Changing a limit is a contract
change with its own tests. It does not need a new ADR.

### Validation

`load` carries either a packaged `scenario` or an imported `document`, never
both. The worker validates an imported document in stages and stops at the
first stage that fails. Each stage reports all of its diagnostics.

1. **Command shape.** Exactly one of `scenario` and `document` is present, and
   `document` is a string. Otherwise the result is `INVALID_WORKER_COMMAND`.
2. **Text.** Byte size, JSON syntax, duplicate keys, the reserved `__proto__`
   key, and nesting depth.
3. **Envelope.** `format`, `formatVersion`, required fields and their types,
   unknown keys at every level, presentation lengths, and the catalog
   reference. An unknown catalog ID and an unhosted version of a known catalog
   are separate diagnostics.
4. **Scenario.** The count and `historyLimit` limits, reserved names and IDs,
   and the unchanged `ScenarioEngine.validate` against the referenced catalog.
   Engine paths are prefixed with `/scenario`. Each presentation label must
   name an existing assertion.
5. **Overlay policy.** If `overlayPolicy` is present, its `lesson` equals
   `scenario.name`. Each target resolves to exactly one location. Each default
   lies in its domain and equals the document's value at every target. No two
   parameters share a target. These are the checks that ADR-004's OVL-AC-6 runs
   on packaged policies, applied at import.

Failures in stages 2 to 5 return `INVALID_DOCUMENT` with context
`{ diagnostics: ScenarioDiagnostic[] }`. Paths are JSON pointers into the
document, for example `/catalog/version`, `/scenario/actions/2/target`, or
`/overlayPolicy/parameters/0/targets/1`. A syntax error has the path `""`.
Diagnostics are sorted by path, then code. Scenario codes keep their existing
names. The document codes are `DOCUMENT_SIZE`, `DOCUMENT_SYNTAX`,
`DOCUMENT_DEPTH`, `DUPLICATE_KEY`, `RESERVED_KEY`, `FORMAT`, `FORMAT_VERSION`,
`UNKNOWN_CATALOG`, `CATALOG_VERSION`, `DOCUMENT_LIMIT`, `RESERVED_NAME`,
`RESERVED_ID`, `POLICY_TARGET`, and `POLICY_DEFAULT`. The envelope also uses the
existing `REQUIRED`, `TYPE`, `UNSUPPORTED`, and `REFERENCE` codes.

After the document is valid, an overlay is validated and applied exactly as in
ADR-004. The policy comes from the validated document that the worker holds. A
rejected overlay returns `INVALID_OVERLAY`.

Validation is pure. It creates no model, uses no simulation identity, and draws
no randomness. A rejected `load` follows the existing atomic rule, so no earlier
session stays exposed. The main thread keeps the file text, so the student can
choose a corrected file without losing anything else.

The parser, the envelope validation, and the policy checks are pure functions in
`@distlab/scenario`. The hosted catalog registry lives in `@distlab/catalogs`,
because it pairs runtime model catalogs with assessments. Only the worker
composition root and headless tools call them.

### Versioning and compatibility

- **Envelope.** `formatVersion` is an integer. The worker supports a declared
  set of versions, initially `{1}`. Unknown keys are rejected at every level, so
  a newer document opened in an older app fails with a diagnostic. It never
  loses an assertion or a fault silently. Adding a field creates a new format
  version.
- **Older documents.** When a version 2 exists, the worker keeps accepting
  version 1 through a pure, tested upgrade function that runs before
  validation. An upgrade must not change the `scenario` member unless the
  `ScenarioDefinition` shape itself changed. A document that ran in an older
  app therefore gives the same `runId` when its catalog version is still
  hosted.
- **Scenario body.** `scenario.version` is the `ScenarioDefinition` version that
  the scenario engine owns. It is versioned independently of the envelope.
- **Catalogs.** A document names an exact catalog version, and its components
  name exact model versions, as they do today. A hosted catalog version stays in
  the registry until an explicit, recorded deprecation. A document that names a
  removed version fails with `CATALOG_VERSION`. It is never silently run on
  another version.

### Deterministic identity

An imported run is identified by its inputs, as every run is. `RunInputs` holds
the applied scenario and the catalog, assessment, model, and predicate versions.
So the existing input-derived `runId` distinguishes imported runs, and the same
document, overlay, and catalog versions reproduce the same history across fresh
loads and Reset.

A **document digest** identifies the file: the SHA-256 of the canonical encoding
of the parsed document value. The digest ignores whitespace and key order and
changes with any value, including presentation text. It does not depend on the
app version. The digest says which file was distributed. The `runId` says what
ran.

`SessionIdentity` gains an `origin`. Packaged sessions report
`{ kind: "packaged" }`. Imported sessions report the document digest and the
catalog reference. `lesson` is `scenario.name` in both cases. No observation type
is added, because inputs are not modeled execution.

### Worker protocol

The protocol keeps version 1. Both ends ship in one bundle, as in ADR-004.

```ts
type WorkerCommand =
  | { version: 1; requestId: string; type: "load"; scenario: CanonicalValue;
      overlay?: CanonicalValue }
  | { version: 1; requestId: string; type: "load"; document: string;
      overlay?: CanonicalValue }
  | /* run, pause, step, reset: unchanged */;

type WorkerEvent =
  | { version: 1; requestId: string; type: "loaded";
      projection: RuntimeProjectionSet; session: SessionIdentity;
      document?: ScenarioDocument }
  | /* other events: unchanged */;
```

`document` in `load` is the raw file text. `loaded.document` is present only for
imported sessions. It is the normalized document that the worker validated. The
main thread renders the title, summary, assertion labels, presentation-only
resource nodes, and the Break panel's choices from that value, not from its own
reading of the file. `reset` reconstructs the same normalized document and
overlay. No new command is added.

Student projections are chosen by catalog reference and derived from the
normalized architecture. They are never keyed to a lesson name or to fixed
component IDs.

### How imported documents differ in the UI

- **Entry.** The scenario chooser has an "Open scenario file…" action next to
  the packaged lessons. It is available only when Load is available.
- **Run header.** The header shows an "Imported" label in text, not only color,
  with the document title, `scenario.name`, seed, catalog reference, a short
  document digest, and a short `runId`. It says that the checks in this scenario
  were written by the file's author and judged by DistLab catalog predicates.
- **Lesson copy.** Packaged lesson copy is not shown. The summary and assertion
  labels come from `presentation`. An assertion without a label shows its ID.
  Evidence navigation works as it does for packaged lessons.
- **Compare and presets.** These are unavailable, because an imported document
  has no paired lesson.
- **Break panel.** The panel is available when the document declares
  `overlayPolicy`. Otherwise it explains that this scenario accepts no student
  changes.
- **Failed import.** The UI lists each diagnostic with its path and a plain
  explanation of its code. The explanations are a main-thread table keyed by
  code. The file text stays in UI state until the student chooses another
  scenario.
- **Choosing another scenario** discards the imported document.

## Vision §19 example in this format

The vision's example runs against the current checkout catalog without new code.
The names follow that catalog: its client action is `checkout`, and the orders
service assigns order IDs itself. The `cartId` therefore carries the example's
`42`.

| Vision §19 | Scenario document |
| --- | --- |
| `name: processor-response-lost` | `scenario.name: "processor-response-lost@1"` |
| `actions: client customer-app, place-order, orderId, amount` | A `client` action on `customer-app`, action `checkout`, with `amount: 15000`, after the two service start actions |
| `external: payment-processor: authorize: result: success, response: drop` | An `external` entry for `POST /authorize` with `dropResponse: true`. The processor commits the approval, and the response is suppressed |
| `expect: invariants: [order-not-charged-twice]` | An `eventually` assertion `order-not-charged-twice` on predicate `mvp.processor-authorized-once` |
| (implicit) catalog, seed | `catalog: mvp.checkout@1.0.0`, `seed: "processor-response-lost-1"` |

```json
{
  "format": "distlab.scenario",
  "formatVersion": 1,
  "catalog": { "id": "mvp.checkout", "version": "1.0.0" },
  "presentation": {
    "title": "Processor response lost",
    "summary": "The processor approves the payment, but its response never reaches Payments.",
    "assertions": { "order-not-charged-twice": "The customer is charged at most once." }
  },
  "scenario": {
    "version": 1,
    "name": "processor-response-lost@1",
    "seed": "processor-response-lost-1",
    "architecture": {
      "components": [
        { "id": "customer-app", "kind": "client", "model": "distlab.customer-app", "version": "1.0.0", "configuration": {} },
        { "id": "orders", "kind": "service", "model": "distlab.orders", "version": "1.0.0", "configuration": {} },
        { "id": "payments", "kind": "service", "model": "distlab.payments", "version": "1.0.0", "configuration": {} },
        { "id": "payment-processor", "kind": "external", "model": "distlab.payment-processor", "version": "1.0.0", "configuration": {} }
      ],
      "links": [
        { "source": "customer-app", "target": "orders",
          "policy": { "requestLatency": 20, "responseLatency": 20, "jitter": 0, "timeout": 1000, "failureRate": 0 } },
        { "source": "payments", "target": "payment-processor",
          "policy": { "requestLatency": 0, "responseLatency": 0, "jitter": 0, "timeout": 1000, "failureRate": 0 } }
      ],
      "databases": [
        { "owner": "orders",
          "tables": [{ "name": "orders", "unique": [["orderId"]], "checks": [] },
                     { "name": "outbox", "unique": [["messageId"]], "checks": [] }],
          "initial": { "orders": {}, "outbox": {} } },
        { "owner": "payments",
          "tables": [{ "name": "payments", "unique": [["paymentId"]], "checks": [] },
                     { "name": "inbox", "unique": [["messageId"]], "checks": [] }],
          "initial": { "payments": {}, "inbox": {} } }
      ],
      "stores": [],
      "destinations": [{ "id": "OrderCreated", "kind": "topic", "deliveryDelay": 5, "ackTimeout": 1000,
                         "retryDelay": 0, "maxAttempts": 3, "capacity": 10000 }],
      "subscriptions": [{ "destination": "OrderCreated", "consumer": "payments" }]
    },
    "external": [
      { "target": "payment-processor", "operation": "POST /authorize",
        "behavior": { "latency": 30, "degradedExtraLatency": 0, "dropResponse": true, "parameters": {} } }
    ],
    "actions": [
      { "id": "start-orders", "at": 0, "kind": "service", "target": "orders", "state": "RUNNING" },
      { "id": "start-payments", "at": 0, "kind": "service", "target": "payments", "state": "RUNNING" },
      { "id": "place-order", "at": 0, "kind": "client", "target": "customer-app", "action": "checkout",
        "data": { "cartId": "cart-42", "customerId": "customer-42", "amount": 15000 } }
    ],
    "assertions": [
      { "id": "order-not-charged-twice", "predicate": "mvp.processor-authorized-once",
        "parameters": { "orderId": "order-1", "amount": 15000 }, "mode": "eventually", "deadline": 2000 }
    ]
  }
}
```

`startTime`, `faults`, and `configuration` are omitted and take the engine's
defaults. The `scenario` member of this example was checked against the current
engine and checkout catalog. It validates with no diagnostics and runs to
`COMPLETED` at virtual time 1030. The processor records one approval,
`external.response.suppressed` and `network.request.timedout` appear in
history, and `order-not-charged-twice` passes. Two fresh runs give equal
exports. DOC-AC-1 makes this example a permanent fixture.

## Contract types

The follow-up implementation adds these shapes to `@distlab/contracts` in a new
module, `packages/contracts/src/scenario-document.ts`, exported from the package
index. It extends `WorkerCommand`, `WorkerEvent`, and `SessionIdentity` as shown
above. The shapes reuse `ScenarioDefinition`, `LessonOverlayPolicy`, and
`ScenarioDiagnostic` instead of redeclaring them.

```ts
const SCENARIO_DOCUMENT_FORMAT = "distlab.scenario";

interface CatalogReference {
  readonly id: string;
  readonly version: string;
}

interface ScenarioDocumentPresentation {
  readonly title: string;
  readonly summary?: string;
  /** Plain-text labels keyed by assertion ID. */
  readonly assertions?: Readonly<Record<string, string>>;
}

/**
 * Normalized form. As with ScenarioDefinition, an input may omit the
 * scenario's optional lists, startTime, and configuration.
 */
interface ScenarioDocument {
  readonly format: typeof SCENARIO_DOCUMENT_FORMAT;
  readonly formatVersion: 1;
  readonly catalog: CatalogReference;
  readonly presentation: ScenarioDocumentPresentation;
  readonly scenario: ScenarioDefinition;
  readonly overlayPolicy?: LessonOverlayPolicy;
}

type SessionOrigin =
  | { readonly kind: "packaged" }
  | { readonly kind: "imported"; readonly digest: string;
      readonly catalog: CatalogReference };

interface SessionIdentity {
  readonly lesson: string;
  readonly seed: string;
  readonly overlay: SessionOverlay;
  readonly origin: SessionOrigin;
}
```

`ScenarioDocumentLimits` (the limits table) and `ScenarioDocumentDiagnosticCodes`
(the document codes) are exported as constants beside these types. The hosted
catalog registry is a worker-side value in `@distlab/catalogs`, not a contract
type. The data-only scenario modules may export each packaged lesson's
`CatalogReference`, so the main thread can build a starter document from a
packaged lesson without importing runtime code.

## Required tests

The implementation must pass these tests:

- **DOC-AC-1 Vision example.** The vision §19 document above is a fixture. It
  validates against `mvp.checkout@1.0.0` with no diagnostics, runs to
  completion, and records one processor approval, a suppressed response, a
  payments timeout, and a passing `order-not-charged-twice`.
- **DOC-AC-2 Packaged lessons as starters.** For every packaged lesson, a
  document that wraps the packaged scenario with a new name and the lesson's
  catalog reference validates with no diagnostics. Its assertion results equal
  the packaged run's results.
- **DOC-AC-3 Replay and identity.** Two fresh worker loads of the same document
  and overlay give equal `runId` and equal exports. So do Reset and a run under
  different `maxEvents` and step cadence. A change in whitespace or key order
  keeps both the digest and `runId`. A presentation-only change changes the
  digest and keeps `runId`. Any change to `scenario` or `catalog` changes
  `runId`.
- **DOC-AC-4 Untrusted input.** Each document diagnostic code has a rejection
  test. An oversized document is rejected before parsing. Duplicate keys, a
  `__proto__` key, and excess depth are rejected. A rejected load creates no
  session and draws no randomness. Its diagnostics are document-relative and
  sorted by path, then code. Strings that look like code stay inert data.
- **DOC-AC-5 Boundary.** The main thread sends the file text unparsed. It
  imports no document parser, validator, or catalog registry.
  `tests/boundaries.test.ts` enforces this. The worker resolves catalogs only
  from its registry.
- **DOC-AC-6 Imported overlays.** A document with `overlayPolicy` accepts an
  allowed overlay and rejects a disallowed one with `INVALID_OVERLAY`. A
  document without a policy accepts only the empty overlay. Each policy
  integrity code has a rejection test.
- **DOC-AC-7 Versioning.** An unsupported `formatVersion` returns
  `FORMAT_VERSION`. An unknown key at any level returns `UNSUPPORTED`. An
  unknown catalog returns `UNKNOWN_CATALOG`, and an unhosted version of a known
  catalog returns `CATALOG_VERSION`.

## Alternatives considered

- **YAML first.** Rejected for version 1 because of implicit typing, aliases,
  and a parser dependency. It stays possible as an adapter onto the same JSON
  value.
- **Add catalog and presentation fields to `ScenarioDefinition`.** Rejected. It
  would change every packaged document and golden digest, and presentation text
  would enter `RunInputs`. ADR-004 rejected a similar change for the same
  reasons.
- **Infer the catalog from model names.** Rejected. It hides which catalog
  version judged the run, and it breaks when two catalogs share a model name.
- **Inline invariant expressions.** Rejected. An expression language is code
  that runs in the worker. It would also be a second assessment model beside
  the reviewed, versioned predicates.
- **Parse on the main thread and send a `CanonicalValue`.** Rejected. Parsing
  untrusted input would happen in two places. `JSON.parse` hides duplicate
  keys, and the byte limit could not be checked on the text that was actually
  validated.
- **A separate `import` command.** Rejected. It would be a second construction
  path beside `load`, with a separate Reset meaning. A `document` variant of
  `load` keeps one atomic construction rule.
- **A validate-only command, so a bad file keeps the current session.**
  Deferred. Every failed load currently clears the session, and the main thread
  keeps the file text for recovery.
- **Import from a URL, or keep documents in browser storage.** Deferred, with
  the constraints listed under [Import path](#import-path).
- **Signed documents for exams.** Rejected for now. Signing needs key
  distribution, which is out of scope. The digest supports a manual integrity
  check.

## Consequences

- Instructors can write exercises and exams as files, without changing code,
  using any model and predicate a hosted catalog provides. New behavior still
  needs a reviewed catalog change.
- The host rule changes from "an exact packaged document plus an allowed
  overlay" to "that, or a valid scenario document against a hosted catalog plus
  an overlay its own policy allows". Kernel and runtime packages are unchanged.
  The dependency direction is unchanged.
- This refines ADR-004 on one point. For an imported document, the overlay
  policy comes from the validated document, not from the worker's catalog. The
  ADR-004 rule still holds in its intent: a `load` never carries a policy apart
  from the document it governs, and a packaged lesson's policy is never taken
  from a command.
- Hosted catalog versions become a compatibility promise. Changing a released
  model or predicate requires a new version.
- The checkout student projection is keyed to fixed component IDs today. It
  must become architecture-driven, like the commerce projection, before checkout
  documents with other component IDs can be imported.
- A document can fail its own assertions. The UI must not present this as a
  broken simulator. The presentation from #96 applies.

## Follow-up work

These issues implement the decision. They are linked to #104.

1. **Contracts:** add `scenario-document.ts`, the `load` document variant,
   `loaded.document`, and `SessionIdentity.origin`.
2. **Scenario layer:** add the strict parser, envelope and limit validation,
   policy integrity checks, the hosted catalog registry, the vision §19 fixture,
   and a headless `npm run scenario -- check <file>` for instructors.
   This covers DOC-AC-1 to DOC-AC-4, DOC-AC-6, and DOC-AC-7.
3. **Browser import:** add the worker load path, "Open scenario file…", the
   imported run header, the diagnostics list, an architecture-driven checkout
   projection, and the Break panel from the document policy. This covers
   DOC-AC-5 and an end-to-end import.
4. **Starter files (optional):** add "Save as scenario file" for a packaged
   lesson. It builds the document from data-only modules.

## Verification and traceability

DOC-AC-1 to DOC-AC-7, APP-AC-8 and APP-AC-9, and the existing SCENARIO-AC-1,
SCENARIO-AC-5, and OVL-AC-1 to OVL-AC-6 verify this decision. It serves
instructor-defined scenarios (§19), examinations (§4, §21), reproducibility
(§15), and browser-first execution (§24). It adds no simulation semantics.

## References

- [Scenario Engine](../scenario-engine.md), [Application boundary](../application-boundary.md)
- [ADR-001](001-deterministic-execution.md), [ADR-002](002-runtime-model-semantics.md),
  [ADR-004](004-session-overlays.md)
- [Architecture: change policy](../../architecture.md#40-architectural-change-policy)
- [Vision](../../vision.md)
