# Assessment Specification

| Field | Value |
| --- | --- |
| Status | Accepted 2026-11-10: decisions **D-1** to **D-8** take their recommendations; D-8 amends ADR-004. Implementation follows the plan below. |
| Owner | DistLab maintainers |
| Last updated | 2026-11-10 |
| Related issues | #97 (this view), #104 (epic), #95 (design choices, done by #89), #96 (lesson checks), #163 (safety invariants), #112 (Design editor) |

## Responsibility

An **assessment** runs one student design against a fixed suite of fault
scenarios and reports, for each scenario, which business invariants the design
kept. It is the exam-style activity of [vision §21](../vision.md#21-assessment):
different designs may pass if they preserve the required properties.

The assessment is an application-layer orchestration on the main thread. It
sends only the commands the worker already accepts: one ordinary `load` of a
packaged base lesson with a session overlay per suite row, followed by `run`
([ADR-004](adr/004-session-overlays.md), "Assessment (#97)"). It never runs a
simulation itself, never evaluates a predicate, and never reads runtime state
that the projections do not publish.

It does not grade, store, or submit anything.

## Architectural alignment and decisions

| Requirement / source | Section | Acceptance criteria |
| --- | --- | --- |
| Vision §21: run a design against a suite, report PASS/FAIL per scenario | [Running a suite](#running-a-suite), [Result](#result) | ASSESS-AC-1, ASSESS-AC-4 |
| Vision §20: assess properties, not implementation choices | [Rows and invariants](#rows-and-invariants) | ASSESS-AC-3 |
| ADR-004: each row is a fresh `load` of a base lesson with an overlay; no new command | [Running a suite](#running-a-suite) | ASSESS-AC-2 |
| ADR-005: a row carries the student's architecture edits | [Configuration](#configuration) | ASSESS-AC-9 (deferred with #112) |
| ADR-001: equal inputs give equal runs | [Determinism](#determinism) | ASSESS-AC-5 |
| #163: a business invariant cannot read HOLDS while the final state violates it | [Rows and invariants](#rows-and-invariants) | ASSESS-AC-3 |

This specification refines ADR-004 and ADR-005 and changes no simulation
semantics. Two consequences of ADR-004 shape it:

1. **The base lesson carries no packaged fault.** An overlay only adds faults;
   it cannot remove a packaged one. A suite's "happy path" row is therefore the
   base lesson with no added fault. Every packaged lesson with design choices
   today ships with its own fault (`retry-*` drops a response, `saga-*` drops a
   shipment request, and so on), so none of them can be a base lesson. The
   suite needs a new packaged base lesson: see
   [Reliable Checkout](#the-reliable-checkout-base-lesson).
2. **Row faults are overlay faults.** The overlay validator requires every
   overlay fault ID to start with `student-`. Row faults therefore carry that
   prefix (**D-3**).

## Public API

New shapes in `@distlab/contracts`, module `src/assessment.ts`. They reuse the
overlay and fault types instead of redeclaring them.

```ts
import type { ArchitectureEdits, OverlayScheduledFault, ParameterOverride } from "./overlay.js";
import type { FaultRule } from "./fault.js";
import type { ObservationId, RunId } from "./kernel/identities.js";
import type { SimulationStatus } from "./kernel/simulation.js";
import type { SimulationTime } from "./kernel/time.js";

/** A packaged, data-only assessment. The main thread may import it, as it imports lesson data. */
export interface AssessmentDefinition {
  readonly version: 1;
  /** Stable identity, for example "reliable-checkout-assessment@1". */
  readonly id: string;
  readonly title: string;
  /** Plain-text requirement lines shown to the student (vision §21). */
  readonly requirements: readonly string[];
  /** The packaged base lesson's scenario name, for example "reliable-checkout@1". */
  readonly base: string;
  /** Rows run in this order. */
  readonly rows: readonly AssessmentRow[];
  /**
   * The base lesson's business invariants, by assertion ID, in column order, with a
   * student-facing label. Every row checks every invariant.
   */
  readonly invariants: readonly { readonly id: string; readonly label: string }[];
}

export interface AssessmentRow {
  /** Stable within the definition, for example "processor-response-lost". */
  readonly id: string;
  readonly label: string;
  /** Added to the student's overlay for this row only. IDs start with `student-`. */
  readonly faults: readonly FaultRule[];
  readonly scheduledFaults: readonly OverlayScheduledFault[];
}

/** The student's design, applied unchanged to every row. */
export interface AssessmentConfiguration {
  readonly parameters: readonly ParameterOverride[];
  /** Absent until the Design editor (#112) exists. */
  readonly architecture?: ArchitectureEdits;
}

export type AssessmentVerdict = "HOLDS" | "VIOLATED" | "INCOMPLETE";

export interface AssessmentCell {
  /** An `AssessmentDefinition.invariants[].id`. */
  readonly invariant: string;
  readonly verdict: AssessmentVerdict;
  /** Virtual time of the stored verdict. */
  readonly time: SimulationTime;
  /** The row run's latest `scenario.assertion.evaluated` record for this invariant, when visible. */
  readonly evidence: ObservationId | null;
}

export interface AssessmentRowResult {
  readonly row: string;
  /** The row's `runId`. Replaying the row with the same inputs reproduces it. */
  readonly runId: RunId;
  readonly status: SimulationStatus;
  readonly cells: readonly AssessmentCell[];
}

/** The exported result: enough for an instructor to reproduce every row. */
export interface AssessmentResult {
  readonly format: "distlab.assessment-result";
  readonly formatVersion: 1;
  readonly assessment: string;
  readonly base: string;
  readonly seed: string;
  readonly configuration: AssessmentConfiguration;
  readonly rows: readonly AssessmentRowResult[];
}
```

`AssessmentResult` is canonical data: it holds no wall-clock time, no browser
or user identity, and no free text beyond what the definition holds.

### Operation semantics and errors

#### Definition validation

A definition is valid when, for its base lesson's packaged document and data-only
overlay policy:

- `base` names a packaged lesson, and `rows` and `invariants` are non-empty with
  unique IDs;
- every invariant ID names an assertion of the base document that the lesson's
  check classification marks as a business invariant (#96);
- for every row, the overlay `{ faults: row.faults, scheduledFaults:
  row.scheduledFaults, parameters: [] }` composes with the base document under
  its policy. This also bounds each row by the policy's `maxEntries`, which must
  leave room for the student's own entries if a later increment allows them
  (**D-6**).

Packaged definitions are validated by a catalog test. They are never accepted
from a command or a file in this increment.

#### Running a suite

1. The student sets a configuration with the base lesson's design choices. The
   configuration form is the existing Design choices section, bound to the base
   lesson's parameters.
2. **Run assessment** is available only while no command is outstanding and no
   simulation runs, like **Apply and restart**.
3. For each row, in definition order, the main thread sends `load` with the base
   document and the overlay `{ version: 1, faults: row.faults, scheduledFaults:
   row.scheduledFaults, parameters: configuration.parameters }`, then `run`
   until `run.finished`. Each row is therefore a fresh session at `startTime`
   with the base seed.
4. After each row it reads the client projection's stored verdicts and the
   history's assertion records into an `AssessmentRowResult`. It re-evaluates
   nothing: PASS reads HOLDS, FAIL reads VIOLATED, and PENDING or INCOMPLETE at
   `run.finished` reads INCOMPLETE.
5. A polite live region announces each row as it starts and finishes, for
   example "Row 3 of 6: Processor response lost — 1 of 4 invariants violated".
   Focus does not move.

Errors:

- A rejected `load` (`INVALID_OVERLAY`) stops the suite. The view names the row
  and the diagnostics, and keeps the rows already finished. With validated
  packaged definitions this happens only when the student's parameters are out
  of range, and the Design choices form already prevents that.
- A row whose run ends FAILED keeps going: its cells read INCOMPLETE where no
  verdict settled, and the suite continues with the next row.
- **Stop** ends the suite after the current row. Partial results are shown and
  can be exported, marked `status` per row as they stand.

The suite replaces the worker session row by row. Afterwards the worker holds
the last row's session (**D-5**).

#### Opening evidence

Each cell links to its evidence record. Only the last row's history is in the
worker, so opening a cell of another row first reloads that row: the same base
document, overlay, and seed give the same `runId` and the same history
(ADR-001). The view checks that the reloaded `runId` equals the stored one, then
opens Recorded history at `evidence`, as **Show evidence** does (#165). A
mismatch is reported and opens nothing.

#### Export

**Export result** downloads the `AssessmentResult` as canonical JSON, named
`<assessment id>-result.json`. Running the same definition with the same
configuration twice gives byte-identical files.

## Owned state

UI state on the main thread only: the selected definition, the draft
configuration, the row results so far, and the suite's progress. It is lost on
reload. Nothing is persisted (vision §21 out of scope: accounts, persistence).

## Emitted events

None. Every simulation record comes from the worker sessions the suite loads,
and the assessment adds no observation type.

## Invariants

- **ASSESS-INV-1:** The assessment sends only `load`, `run`, and the existing
  control commands, and each `load` carries an exact packaged document and an
  overlay the base lesson's policy allows.
- **ASSESS-INV-2:** A cell's verdict is the stored verdict of that row's run. The
  main thread never evaluates a predicate.
- **ASSESS-INV-3:** Equal definition, configuration, and catalog versions give
  equal `AssessmentResult` values.
- **ASSESS-INV-4:** The configuration is identical across rows; only the row's
  faults differ.

## Explicit non-responsibilities

- Grading, scoring weights, deadlines, identity, persistence, or submission.
- Authoring assessments in the browser or importing them from files.
- Running rows in parallel or in more than one worker.
- Comparing two designs side by side (RFC 0001, P4, is separate).

## The Reliable Checkout base lesson

The suite of vision §21 needs one fault-free base lesson whose design choices
change the outcome of each row. No packaged lesson fits, so this specification
proposes one. It is catalog work: new versioned models and one packaged document
(**D-1**).

### Architecture

```text
customer-app ──▶ orders ──▶ inventory
                   │  └───▶ payments ──▶ payment-processor (external)
                   │
             OrderConfirmed (topic) ──▶ notifications ──▶ messaging (external)
```

- **orders** runs the checkout as an orchestrated saga: reserve inventory,
  authorize payment, confirm the order, publish `OrderConfirmed`. On a failed or
  ambiguous step it either leaves the order `NEEDS_COMPENSATION` or compensates
  in reverse order (release, void), by option.
- **payments** authorizes against the processor. By option it sends an
  idempotency key and, after a timeout, retries a bounded number of times with
  the same key.
- **payment-processor** records authorizations by idempotency key when one is
  sent, and supports `void`.
- **notifications** consumes `OrderConfirmed` and sends through **messaging**.
  By option it keeps an inbox keyed by the event ID. It treats an error reply
  from messaging as a failed send and NACKs the delivery, so the bus redelivers
  it. (The current `commerce.notify-sender` NACKs only a send timeout; see #126.)
- **orders** also exposes `POST /relay`, which publishes unsent outbox events.
  The base document packages one relay request late in the run, which does
  nothing when the outbox is empty.
- Each service owns its database.

### Design choices (student configuration)

| Key | Domain | Default | Effect |
| --- | --- | --- | --- |
| `retries` | integer 0–3 | 0 | Payments retries an authorization that timed out |
| `idempotency` | boolean | off | Payments sends the order ID as idempotency key; the processor deduplicates by it |
| `compensation` | boolean | off | Orders compensates a failed checkout: release inventory, void payment, cancel |
| `outbox` | boolean | off | Orders writes `OrderConfirmed` to an outbox in its confirming transaction and relays it |
| `consumer-idempotency` | boolean | off | Notifications ignores an event ID it already processed |

The defaults are the unsafe design, so the unchanged lesson fails rows and the
student has decisions to make (**D-2**).

### Rows and invariants

Every row checks every invariant. A row passes when all its invariants hold
(**D-4**).

| Row | Added fault |
| --- | --- |
| Happy path | none |
| Duplicate OrderConfirmed | `message.delivery` duplicate on `OrderConfirmed` to notifications |
| Inventory unavailable | `network.request` drop, orders → inventory, first `POST /reserve` |
| Processor response lost | `network.response` drop, processor → payments, first `POST /authorize` |
| Notification provider down | scheduled `external-availability` on messaging: UNAVAILABLE at the start, AVAILABLE again before the deadline |
| Crash after local commit | scheduled `crash` of orders between its confirming commit and publication, then a restart (**D-8**) |

| Invariant | Kind (#163) | Holds when |
| --- | --- | --- |
| The customer is charged at most once | safety | The processor never holds more than one approved, unvoided authorization per order |
| A failed order keeps no charge | deadline | Every order not `CONFIRMED` by the deadline has no approved, unvoided authorization |
| A confirmed order is notified exactly once | safety + deadline | Never more than one notification per order; one by the deadline for each confirmed order |
| Every order reaches a final state | deadline | Every order is `CONFIRMED` or `CANCELLED` by the deadline |

Expected outcomes, which the catalog tests would pin:

| Design | Happy | Duplicate | Inventory | Response lost | Provider down | Crash |
| --- | --- | --- | --- | --- | --- | --- |
| Defaults (unsafe) | PASS | FAIL | FAIL | FAIL | PASS | FAIL |
| All protections on, `retries` 1 | PASS | PASS | PASS | PASS | PASS | PASS |

A design passes "Notification provider down" because the notification is not on
the checkout's critical path, and the bus redelivers it once the provider is back
before the deadline; vision §21 lists it as PASS for the same reason. "Crash
after local commit" passes with `outbox` only if orders restarts and the relay
runs, which **D-8** makes possible.

## Minimal examples

### A row's load

```ts
const overlay = {
  version: 1,
  faults: [{ id: "student-row-lost-response", point: "network.response", source: "payment-processor",
    target: "payments", name: "POST /authorize", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
  scheduledFaults: [],
  parameters: [{ key: "idempotency", value: true }, { key: "retries", value: 1 }],
};
// worker.postMessage({ version: 1, requestId, type: "load", scenario: reliableCheckout, overlay })
```

### An incomplete row

A row whose run ends FAILED before the deadline of "Every order reaches a final
state" exports that cell as `{ invariant: "order-final", verdict: "INCOMPLETE",
time: <failure time>, evidence: null }`, and the suite continues.

## Acceptance criteria

- **ASSESS-AC-1:** Given a valid definition and a configuration, when the suite
  runs, then each row is one `load` of the exact base document with the row's
  faults and the configuration's parameters, followed by `run`, and no other
  command type is sent.
- **ASSESS-AC-2:** Every packaged definition validates: base lesson, unique IDs,
  invariants that are business invariants of the base, and every row's overlay
  composing under the base policy.
- **ASSESS-AC-3:** A cell's verdict equals the stored verdict of its row's run;
  PENDING or INCOMPLETE at the end of a run reads INCOMPLETE.
- **ASSESS-AC-4:** Given the defaults and given every protection on with
  `retries` 1, the Reliable Checkout matrix equals the expected-outcomes table.
- **ASSESS-AC-5:** Running the same definition and configuration twice gives
  byte-identical exported results, and every row's `runId` is reproduced by
  reloading that row.
- **ASSESS-AC-6:** Opening a cell of any row shows that row's evidence record in
  Recorded history, after a reload that reproduces the stored `runId`.
- **ASSESS-AC-7:** Rows run one at a time, each start and finish is announced in
  a polite live region, and Run assessment is unavailable while a row runs.
- **ASSESS-AC-8:** A rejected row load stops the suite and names the row and its
  diagnostics; a FAILED row run does not stop it.
- **ASSESS-AC-9 (deferred with #112):** A configuration with architecture edits
  applies the same edits to every row.

## Acceptance coverage

| Invariant / operation | Acceptance criteria |
| --- | --- |
| ASSESS-INV-1 | ASSESS-AC-1 |
| ASSESS-INV-2 | ASSESS-AC-3 |
| ASSESS-INV-3 | ASSESS-AC-5 |
| ASSESS-INV-4 | ASSESS-AC-1, ASSESS-AC-9 |
| Definition validation | ASSESS-AC-2 |
| Running a suite, errors, Stop | ASSESS-AC-1, ASSESS-AC-7, ASSESS-AC-8 |
| Opening evidence | ASSESS-AC-6 |
| Export | ASSESS-AC-5 |
| Reliable Checkout outcomes | ASSESS-AC-4 |

## Decisions

Each was open with a recommendation. The maintainer accepted every
recommendation on 2026-11-10; the alternatives are kept for the record.

- **D-1. Where the Reliable Checkout models live.** Recommended: new versioned
  models in the commerce catalog (`commerce.lessons`), so the existing catalog
  reference, descriptors, and hosting apply. Alternative: a new hosted catalog,
  which adds a registry entry and a catalog reference.
- **D-2. The configuration keys.** Recommended: the five above. `retries` without
  `idempotency` is a deliberate trap (it doubles the charge). A circuit breaker
  or a dead-letter budget would need more rows and is left out.
- **D-3. Row fault IDs.** Recommended: keep the `student-` prefix
  (`student-row-…`), which needs no change to ADR-004; Recorded history then
  lists row faults as overlay faults. Alternative: an `assessment-` prefix,
  which amends ADR-004's overlay validation.
- **D-4. Row verdict.** Recommended: a row passes when every invariant holds,
  matching vision §21's one PASS/FAIL per row; the matrix still shows each cell.
- **D-5. The session after a suite.** Recommended: leave the last row loaded, so
  Recorded history works without a reload for that row. Alternative: reload the
  base lesson with the configuration.
- **D-6. Student faults in an assessment.** Recommended: none in this increment;
  the rows are the faults. A later increment may allow them within the policy's
  `maxEntries`.
- **D-7. Where the view lives.** Recommended: an **Assessment** group in the
  Lesson chooser; choosing it shows the requirements, the Design choices form,
  Run assessment, the matrix, and Export in the Lesson panel and workspace. This
  is a layout decision for review in the preview.
- **D-8. Restarting a crashed service in a row.** A service cannot move from
  RUNNING to STARTING ([service runtime](service-runtime.md)), so the base
  lesson cannot package an unconditional restart, and ADR-004 says restoring a
  crashed service is not an overlay capability. Without a restart, "Crash after
  local commit" fails for every design. Recommended: amend ADR-004 so an
  overlay may pair a scheduled `crash` with a later restart of the same
  component (STARTING, then RUNNING), validated statically as a pair. That also
  lets student crash faults tell a recovery story in other lessons.
  Alternative: drop the crash row and the `outbox` key from this increment, and
  add them when restarts are decided. Accepted: the ADR-004 amendment
  "Crash with restart" and OVL-AC-7.

## Implementation plan

Three pull requests, each with its tests:

1. Contracts and validation: `src/assessment.ts`, definition validation, and the
   catalog test for ASSESS-AC-2. The ADR-004 amendment and the crash/restart
   pair validation (D-8) come first, in their own pull request.
2. The Reliable Checkout models, document, policy, check classification, and
   catalog tests for ASSESS-AC-4.
3. The browser view: suite runner, matrix, evidence, export, and the browser
   tests for ASSESS-AC-1, -3, -5 to -8.

## References

- [DistLab vision](../vision.md), §20 and §21
- [ADR-004: Session overlays](adr/004-session-overlays.md)
- [ADR-005: Architecture editor](adr/005-architecture-editor.md)
- [Scenario Engine](scenario-engine.md) (assertion modes)
- [Commerce lessons](../commerce-lessons.md) (lesson checks)
- [RFC 0001](../rfc/0001-course-ready-design-module.md), P6 and P7
