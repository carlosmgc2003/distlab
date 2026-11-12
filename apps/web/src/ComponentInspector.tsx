import type { ReactNode } from "react";
import { useMessages } from "./i18n/react.tsx";
import type { ArchitectureNode, ResourceNode } from "./architecture-view.ts";
import { categoryLabel, resourceTitle, symbolLabel } from "./architecture-view.ts";

export function ComponentInspector({ node, children }: {
  readonly node: ArchitectureNode | ResourceNode | undefined;
  readonly children?: ReactNode;
}) {
  const m = useMessages();
  return <aside id="component-inspector" className="inspector" aria-labelledby="inspector-heading" tabIndex={0}>
    <h3 id="inspector-heading">Component inspector</h3>
    {node ? node.type === "component" ? <>
      <h4>{node.data.title}</h4>
      {node.data.emptySlot ? <p className="inspector-empty-slot"><strong>{m.designChoices.emptySlot.label}.</strong> {m.designChoices.emptySlot.description}</p> : null}
      {children}<details className="inspector-metadata">
        <summary>Static architecture metadata</summary>
      <dl>
        <dt>Component ID</dt><dd>{node.id}</dd>
        <dt>Category</dt><dd>{node.data.symbol === "kvstore" ? symbolLabel("kvstore", m) : categoryLabel(node.data.component.kind, m)}</dd>
        <dt>Model</dt><dd>{node.data.component.model ?? "Not declared"}</dd>
        <dt>Version</dt><dd>{node.data.component.version ?? "Not declared"}</dd>
      </dl>
      <h4>Configuration</h4>
      {node.data.configuration === undefined ? <p>Not declared in packaged metadata.</p> : <pre>{JSON.stringify(node.data.configuration, null, 2)}</pre>}
      <h4>Resource ownership</h4>
      {node.data.resources.length ? <ul>{node.data.resources.map(resource => <li key={resource}>{resource}</li>)}</ul> : <p>No database or store declared for this component.</p>}
      </details>
    </> : <>
      <h4>{resourceTitle(node.data.kind, node.data.owner, m)}</h4>
      <ResourceFacts node={node} />
    </> : <p>Select a component to inspect its metadata.</p>}
  </aside>;
}

function ResourceFacts({ node }: { readonly node: ResourceNode }) {
  const { owner, definition } = node.data;
  const database = "tables" in definition ? definition : undefined;
  const store = "tables" in definition ? undefined : definition;
  return <dl className="resource-facts">
    <dt>Owner</dt><dd>{owner}</dd>
    {database ? <>
      <dt>Tables</dt><dd>{database.tables.length ? <ul>{database.tables.map(table => <li key={table.name}>{table.name}</li>)}</ul> : "None declared"}</dd>
      <dt>Initial keys</dt><dd>{database.tables.some(table => Object.keys(database.initial[table.name] ?? {}).length > 0)
        ? <ul>{database.tables.flatMap(table => Object.keys(database.initial[table.name] ?? {}).map(key => <li key={`${table.name}:${key}`}>{table.name}: {key}</li>))}</ul>
        : "None declared"}</dd>
    </> : <>
      <dt>Initial keys</dt><dd>{store && store.initial.length ? <ul>{store.initial.map(entry => <li key={entry.key}>{entry.key}</li>)}</ul> : "None declared"}</dd>
    </>}
  </dl>;
}
