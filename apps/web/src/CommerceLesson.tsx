import type { CanonicalValue, RuntimeProjectionSet } from "@distlab/contracts";

function object(value: CanonicalValue | undefined): Readonly<Record<string, CanonicalValue>> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, CanonicalValue>> : {};
}
function fields(value: CanonicalValue): string {
  const row = object(value);
  return Object.keys(row).length ? Object.entries(row).map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ") : JSON.stringify(value);
}

/** Only authorized student projections are rendered; host/task state stays private. */
export function CommerceFacts({ projection, componentId }: { projection: RuntimeProjectionSet; componentId: string }) {
  const state = object(projection.components.find(entry => entry.componentId === componentId && entry.visibility === "student")?.state);
  const tables = object(object(state.committed).tables);
  const store = Array.isArray(state.store) ? state.store : [];
  const observed = object(state.observed);
  return <div className="commerce-facts">
    {typeof state.lifecycle === "string" ? <p>Lifecycle: {state.lifecycle}</p> : null}
    {Object.entries(tables).map(([table, value]) => <div key={table}><strong>{table}</strong>
      {Object.keys(object(value)).length ? <ul>{Object.entries(object(value)).map(([key, row]) => <li key={key}><code>{key}</code> — {fields(row)}</li>)}</ul> : <p>No committed rows.</p>}
    </div>)}
    {store.map((entry, i) => <p key={i}><strong>{String(object(entry).key)}</strong> — {fields(object(entry).value ?? null)}</p>)}
    {Object.entries(observed).map(([key, value]) => <p key={key}><strong>{key}</strong> — {fields(value)}</p>)}
    {state.role === "commerce-client" && !Object.keys(observed).length ? <p>No response observed yet.</p> : null}
    {state.role === "external-visible" ? <p>{String(state.availability)} · {fields(state.visible ?? {})}</p> : null}
    {Array.isArray(state.records) ? <ul>{state.records.map((row, i) => <li key={i}>{fields(row)}</li>)}</ul> : null}
  </div>;
}

export function CommerceState({ projection }: { projection: RuntimeProjectionSet }) {
  const student = projection.components.filter(entry => entry.visibility === "student");
  const client = student.find(entry => object(entry.state).role === "commerce-client");
  const assertions = object(client?.state).assertions;
  return <section className="commerce-state" aria-label="Commerce lesson state">
    <h3>Service knowledge and committed state</h3>
    <p>These are recorded facts, not predictions. Step to inspect intermediate states; Reset replays the same inputs.</p>
    <div className="commerce-state-grid">{student.map(entry => <section key={entry.componentId} aria-label={`${entry.componentId} state`}>
      <h4>{entry.componentId}</h4><CommerceFacts projection={projection} componentId={entry.componentId} />
    </section>)}</div>
    <h3>Lesson checks</h3>
    <p>A passing unsafe lesson confirms the expected failure, not a safe business outcome.</p>
    <ul aria-label="Lesson checks">{Array.isArray(assertions) ? assertions.map((item, i) => {
      const result = object(item);
      return <li key={i}><strong>{String(result.status)}</strong> — {String(result.id)}{typeof result.time === "number" ? ` at t=${result.time}` : ""}</li>;
    }) : null}</ul>
  </section>;
}
