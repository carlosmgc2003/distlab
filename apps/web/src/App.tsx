import { useState, useSyncExternalStore } from "react";
import { ArchitectureView } from "./ArchitectureView.tsx";
import type { PackagedScenario } from "./scenarios.ts";
import type { SimulationHost } from "./host.ts";
import { packagedMetadata, scenarios } from "./scenarios.ts";

export function App({ host }: { readonly host: SimulationHost }) {
  const { projection, error, loading } = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const [selected, setSelected] = useState<string>(scenarios[0].id);

  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);

  const load = () => {
    const choice = scenarios.find(item => item.id === selected)!;
    setLoadedChoice(choice);
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
        <ArchitectureView architecture={projection.architecture}
          {...(loadedChoice ? { metadata: packagedMetadata(loadedChoice).architecture, scenarioName: packagedMetadata(loadedChoice).name } : {})} />
      </section>
      <section className="execution" aria-labelledby="execution-heading">
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
