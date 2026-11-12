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
    <h3 id="inspector-heading">{m.architecture.inspector.heading}</h3>
    {node ? node.type === "component" ? <>
      <h4>{node.data.title}</h4>
      {node.data.emptySlot ? <p className="inspector-empty-slot"><strong>{m.designChoices.emptySlot.label}.</strong> {m.designChoices.emptySlot.description}</p> : null}
      {children}<details className="inspector-metadata">
        <summary>{m.architecture.inspector.metadata}</summary>
      <dl>
        <dt>{m.architecture.inspector.componentId}</dt><dd>{node.id}</dd>
        <dt>{m.architecture.inspector.category}</dt><dd>{node.data.symbol === "kvstore" ? symbolLabel("kvstore", m) : categoryLabel(node.data.component.kind, m)}</dd>
        <dt>{m.architecture.inspector.model}</dt><dd>{node.data.component.model ?? m.architecture.inspector.notDeclared}</dd>
        <dt>{m.architecture.inspector.version}</dt><dd>{node.data.component.version ?? m.architecture.inspector.notDeclared}</dd>
      </dl>
      <h4>{m.architecture.inspector.configuration}</h4>
      {node.data.configuration === undefined ? <p>{m.architecture.inspector.configurationNone}</p> : <pre>{JSON.stringify(node.data.configuration, null, 2)}</pre>}
      <h4>{m.architecture.inspector.resources}</h4>
      {node.data.resources.length ? <ul>{node.data.resources.map(resource => <li key={resource}>{resource}</li>)}</ul> : <p>{m.architecture.inspector.resourcesNone}</p>}
      </details>
    </> : <>
      <h4>{resourceTitle(node.data.kind, node.data.owner, m)}</h4>
      <ResourceFacts node={node} />
    </> : <p>{m.architecture.inspector.select}</p>}
  </aside>;
}

function ResourceFacts({ node }: { readonly node: ResourceNode }) {
  const m = useMessages();
  const copy = m.architecture.inspector;
  const { owner, definition } = node.data;
  const database = "tables" in definition ? definition : undefined;
  const store = "tables" in definition ? undefined : definition;
  return <dl className="resource-facts">
    <dt>{copy.owner}</dt><dd>{owner}</dd>
    {database ? <>
      <dt>{copy.tables}</dt><dd>{database.tables.length ? <ul>{database.tables.map(table => <li key={table.name}>{table.name}</li>)}</ul> : copy.noneDeclared}</dd>
      <dt>{copy.initialKeys}</dt><dd>{database.tables.some(table => Object.keys(database.initial[table.name] ?? {}).length > 0)
        ? <ul>{database.tables.flatMap(table => Object.keys(database.initial[table.name] ?? {}).map(key => <li key={`${table.name}:${key}`}>{table.name}: {key}</li>))}</ul>
        : copy.noneDeclared}</dd>
    </> : <>
      <dt>{copy.initialKeys}</dt><dd>{store && store.initial.length ? <ul>{store.initial.map(entry => <li key={entry.key}>{entry.key}</li>)}</ul> : copy.noneDeclared}</dd>
    </>}
  </dl>;
}
