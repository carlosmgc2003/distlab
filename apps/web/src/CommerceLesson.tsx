import type { CanonicalValue, RuntimeProjectionSet } from "@distlab/contracts";
import type { CommerceCheck } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { lessonChecks, verdictLabel, verdictMark, verdictTone } from "./lesson-checks.ts";
import type { Messages } from "./i18n/catalog.ts";
import { useMessages } from "./i18n/react.tsx";
import type { CheckRow, LessonCheckView } from "./lesson-checks.ts";
import { HelpHint } from "./ui-hint.tsx";

/** What the two lists of lesson checks mean (#96) is `m.commerceLesson.invariantsHelp` and `expectationsHelp`; ③ Investigate shows them behind its one hint (#147). */

function object(value: CanonicalValue | undefined): Readonly<Record<string, CanonicalValue>> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, CanonicalValue>> : {};
}
function fields(value: CanonicalValue): string {
  const row = object(value);
  return Object.keys(row).length ? Object.entries(row).map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ") : JSON.stringify(value);
}

/** Only authorized student projections are rendered; host/task state stays private. */
export function CommerceFacts({ projection, componentId }: { projection: RuntimeProjectionSet; componentId: string }) {
  const c = useMessages().commerceLesson;
  const state = object(projection.components.find(entry => entry.componentId === componentId && entry.visibility === "student")?.state);
  const tables = object(object(state.committed).tables);
  const store = Array.isArray(state.store) ? state.store : [];
  const observed = object(state.observed);
  return <div className="commerce-facts">
    {typeof state.lifecycle === "string" ? <p>{c.lifecycle(state.lifecycle)}</p> : null}
    {Object.entries(tables).map(([table, value]) => <div key={table}><strong>{table}</strong>
      {Object.keys(object(value)).length ? <ul>{Object.entries(object(value)).map(([key, row]) => <li key={key}><code>{key}</code> — {fields(row)}</li>)}</ul> : <p>{c.noCommittedRows}</p>}
    </div>)}
    {store.map((entry, i) => <p key={i}><strong>{String(object(entry).key)}</strong> — {fields(object(entry).value ?? null)}
      {typeof object(entry).expiresAt === "number" ? <> · {c.expiresAt(object(entry).expiresAt as number)}</> : null}</p>)}
    {Object.entries(observed).map(([key, value]) => <p key={key}><strong>{key}</strong> — {fields(value)}</p>)}
    {state.role === "commerce-client" && !Object.keys(observed).length ? <p>{c.noResponseYet}</p> : null}
    {state.role === "external-visible" ? <p>{String(state.availability)} · {fields(state.visible ?? {})}</p> : null}
    {Array.isArray(state.records) ? <ul>{state.records.map((row, i) => <li key={i}>{fields(row)}</li>)}</ul> : null}
    {Array.isArray(state.deadLetters) ? <div><strong>{c.deadLetterQueue}</strong>
      {state.deadLetters.length ? <ul aria-label={c.deadLetterQueueOf(componentId)}>{state.deadLetters.map((row, i) => <li key={i}>{fields(row)}</li>)}</ul> : <p>{c.noDeadLetters}</p>}
    </div> : null}
  </div>;
}

// Verdicts are carried by words and a glyph; colour only reinforces them. All three come from the verdict code.
export function CheckItem({ row, onShowEvidence }: { row: CheckRow<string>; onShowEvidence: (observationId: string) => void }) {
  const m = useMessages();
  const c = m.commerceLesson;
  return <li className={`lesson-check is-${verdictTone(row.verdict)}`}>
    <strong className="lesson-check-verdict"><span aria-hidden="true">{verdictMark(row.verdict)} </span>{verdictLabel(row, m)}</strong>
    <span> — {row.label}{row.time !== undefined ? <>{" "}{c.checkedAt(row.time)}</> : null}</span>
    {row.evidenceId ? <button type="button" aria-controls="timeline-rows" aria-label={c.showEvidenceFor(row.label)}
      onClick={() => onShowEvidence(row.evidenceId!)}>{c.showEvidence}</button> : null}
  </li>;
}

/**
 * The packaged lesson's checks, mapped from the `commerce-client` projection's stored verdicts. The
 * client is found by its role, never by a component ID.
 */
export function commerceLessonChecks(projection: RuntimeProjectionSet, lesson: string, checks: readonly CommerceCheck[], m: Messages): LessonCheckView {
  const client = projection.components.find(entry => entry.visibility === "student" && object(entry.state).role === "commerce-client");
  return lessonChecks(lesson, object(client?.state).assertions, checks, projection.history.observations, m);
}

/**
 * The two lists of lesson checks (#96), shown in the Lesson panel's ③ Investigate (#141). An
 * imported session lists its own checks with `ImportedChecks` instead. What the lists mean is in
 * ③ Investigate's one hint (`INVARIANTS_HELP`, `EXPECTATIONS_HELP`), not in the lists.
 */
export function LessonChecks({ view, onShowEvidence }: { view: LessonCheckView; onShowEvidence: (observationId: string) => void }) {
  const c = useMessages().commerceLesson;
  return <div className="lesson-checks-view" role="region" aria-label={c.lessonChecks}>
    <section className="lesson-checks" aria-labelledby="business-invariants-heading">
      <h4 id="business-invariants-heading">{c.businessInvariants}</h4>
      <ul aria-label={c.businessInvariants}>{view.invariants.map(row => <CheckItem key={row.id} row={row} onShowEvidence={onShowEvidence} />)}</ul>
    </section>
    {view.reproduced ? <section className="lesson-checks is-secondary" aria-labelledby="scenario-expectations-heading">
      <h4 id="scenario-expectations-heading">{c.setupReproduced(c.reproducedSummary[view.reproduced])}</h4>
      <ul aria-label={c.scenarioExpectations}>{view.expectations.map(row => <CheckItem key={row.id} row={row} onShowEvidence={onShowEvidence} />)}</ul>
    </section> : null}
  </div>;
}

/** Every student-visible component's facts, shown in the Service state dialog (#142). Its one hint holds the reasoning (#147). */
export function ServiceStateGrid({ projection }: { projection: RuntimeProjectionSet }) {
  const c = useMessages().commerceLesson;
  const student = projection.components.filter(entry => entry.visibility === "student");
  return <section className="commerce-state" aria-labelledby="service-state-heading">
    <h3 id="service-state-heading">{c.serviceStateHeading}</h3>
    <HelpHint label={c.aboutServiceState} bodyId="service-state-help">{c.serviceStateHelp}</HelpHint>
    <div className="commerce-state-grid">{student.map(entry => <section key={entry.componentId} aria-label={c.serviceStateOf(entry.componentId)}>
      <h4>{entry.componentId}</h4><CommerceFacts projection={projection} componentId={entry.componentId} />
    </section>)}</div>
  </section>;
}
