import { useState, useSyncExternalStore } from "react";
import type { SimulationHost } from "./host.ts";
import { scenarios } from "./scenarios.ts";

export function App({ host }: { readonly host: SimulationHost }) {
  const { projection, error, loading } = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const [selected, setSelected] = useState<string>(scenarios[0].id);

  const load = () => {
    const choice = scenarios.find(item => item.id === selected)!;
    // The host publishes structured failures; the event handler owns no simulation state.
    void host.load(choice.scenario).catch(() => {});
  };

  return <main>
    <h1>DistLab</h1>
    <label htmlFor="scenario">Scenario </label>
    <select id="scenario" value={selected} onChange={event => setSelected(event.target.value)}>
      {scenarios.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
    </select>{" "}
    <button onClick={load}>Load scenario</button>
    <p role="status">{loading ? "Loading…" : projection?.simulation.status ?? "Choose a scenario to begin."}</p>
    {error ? <p role="alert">{error.code}: {error.message}</p> : null}
    {projection ? <>
      <section aria-labelledby="architecture-heading">
        <h2 id="architecture-heading">Architecture</h2>
        <ul>{projection.architecture.components.map(component => <li key={component.id}>{component.label} ({component.kind})</li>)}</ul>
        <p>{projection.architecture.links.length} links</p>
      </section>
      <section aria-labelledby="execution-heading">
        <h2 id="execution-heading">Execution</h2>
        <dl>
          <dt>Virtual time</dt><dd>{projection.simulation.time}</dd>
          <dt>Pending events</dt><dd>{projection.simulation.pendingEvents}</dd>
          <dt>Processed events</dt><dd>{projection.simulation.processedEvents}</dd>
          <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
          <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
        </dl>
      </section>
    </> : null}
  </main>;
}
